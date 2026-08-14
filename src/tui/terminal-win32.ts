import { win32KernelLoader } from "#win32-kernel"
import type { Win32Kernel } from "./win32-kernel"
import type { ReadStream } from "node:tty"

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001

let k32: Win32Kernel | undefined

const CP_UTF8 = 65001

function load() {
  if (process.platform !== "win32") return false
  try {
    k32 ??= win32KernelLoader.load()
    return k32 != null
  } catch {
    return false
  }
}

/**
 * 将 Windows 控制台输出/输入代码页切换为 UTF-8（65001）。
 *
 * TUI 通过原始 UTF-8 字节流渲染（Braille spinner、CJK 文本），而 conhost
 * 默认使用系统 ANSI 代码页（如 936/GBK），会把 UTF-8 字节解码成乱码，
 * 表现为底部 spinner 与状态文本不断闪烁乱码。Windows Terminal 本身即为
 * UTF-8，调用后无副作用。输入代码页同步切换，避免命令行中文输入/粘贴
 * 在 936 代码页下被按 GBK 解码而产生乱码。
 *
 * 退出时不恢复原代码页：恢复会重新引入乱码（同一控制台后续运行的
 * bun/node/git 均输出 UTF-8）。
 */
export function win32EnableUtf8Console() {
  if (process.platform !== "win32") return false
  if (!process.stdout.isTTY) return false
  if (!load()) return false
  let changed = false
  if (k32!.GetConsoleOutputCP() !== CP_UTF8) {
    changed = k32!.SetConsoleOutputCP(CP_UTF8) !== 0
  }
  if (k32!.GetConsoleCP() !== CP_UTF8) {
    changed = k32!.SetConsoleCP(CP_UTF8) !== 0 || changed
  }
  return changed
}

/**
 * Clear ENABLE_PROCESSED_INPUT on the console stdin handle.
 */
export function win32DisableProcessedInput() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return

  const handle = k32!.GetStdHandle(STD_INPUT_HANDLE)
  const buf = [0]
  if (k32!.GetConsoleMode(handle, buf) === 0) return

  const mode = buf[0]!
  if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
  k32!.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
}

/**
 * Discard any queued console input (mouse events, key presses, etc.).
 */
export function win32FlushInputBuffer() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return

  const handle = k32!.GetStdHandle(STD_INPUT_HANDLE)
  k32!.FlushConsoleInputBuffer(handle)
}

let unhook: (() => void) | undefined

/**
 * Keep ENABLE_PROCESSED_INPUT disabled.
 *
 * On Windows, Ctrl+C becomes a CTRL_C_EVENT (instead of stdin input) when
 * ENABLE_PROCESSED_INPUT is set. Various runtimes can re-apply console modes
 * (sometimes on a later tick), and the flag is console-global, not per-process.
 *
 * We combine:
 * - A `setRawMode(...)` hook to re-clear after known raw-mode toggles.
 * - A low-frequency poll as a backstop for native/external mode changes.
 */
export function win32InstallCtrlCGuard() {
  if (process.platform !== "win32") return
  if (!process.stdin.isTTY) return
  if (!load()) return
  if (unhook) return unhook

  const stdin = process.stdin as ReadStream
  const original = stdin.setRawMode

  const handle = k32!.GetStdHandle(STD_INPUT_HANDLE)
  const buf = [0]

  if (k32!.GetConsoleMode(handle, buf) === 0) return
  const initial = buf[0]!

  const enforce = () => {
    if (k32!.GetConsoleMode(handle, buf) === 0) return
    const mode = buf[0]!
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    k32!.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
  }

  // Some runtimes can re-apply console modes on the next tick; enforce twice.
  const later = () => {
    enforce()
  }

  let wrapped: ReadStream["setRawMode"] | undefined

  if (typeof original === "function") {
    wrapped = (mode: boolean) => {
      const result = original.call(stdin, mode)
      later()
      return result
    }

    stdin.setRawMode = wrapped
  }

  // Ensure it's cleared immediately too (covers any earlier mode changes).
  later()

  const interval = setInterval(enforce, 1000)
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) {
      stdin.setRawMode = original
    }

    k32!.SetConsoleMode(handle, initial)
    unhook = undefined
  }

  return unhook
}
