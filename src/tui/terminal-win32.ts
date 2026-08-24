import { win32KernelLoader } from "#win32-kernel"
import type { Win32Kernel } from "./win32-kernel"
import type { ReadStream } from "node:tty"

const STD_INPUT_HANDLE = -10
const ENABLE_PROCESSED_INPUT = 0x0001

let k32: Win32Kernel | undefined

const CP_UTF8 = 65001

function isConsoleAttached(): boolean {
  return process.stdout.isTTY || process.stderr.isTTY
}

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
  if (!isConsoleAttached()) return false
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
 * 低频率轮询重断言控制台输出/输入代码页为 UTF-8（65001）。
 *
 * 与 win32InstallCtrlCGuard 同理：控制台代码页是控制台全局状态，运行期间
 * 被子进程/外部程序（工具执行 chcp、GBK 原生程序等）复位后，TUI 的 UTF-8
 * 输出会重新变成乱码——表现为"运行一段时间后突然乱码"。轮询幂等且开销极小
 * （仅 kernel32 的 Get/Set 调用，无 IO），作为 TUI 渲染期间的后备保障。
 */
let utf8GuardTimer: ReturnType<typeof setInterval> | undefined
let utf8GuardRefs = 0

export function win32InstallUtf8ConsoleGuard(intervalMs = 1000): () => void {
  if (process.platform !== "win32") return () => {}
  if (!isConsoleAttached()) return () => {}
  if (!load()) return () => {}
  if (!utf8GuardTimer) {
    win32EnableUtf8Console()
    const interval = setInterval(() => {
      win32EnableUtf8Console()
    }, intervalMs)
    interval.unref?.()
    utf8GuardTimer = interval
  }
  utf8GuardRefs += 1
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    utf8GuardRefs -= 1
    if (utf8GuardRefs === 0 && utf8GuardTimer) {
      clearInterval(utf8GuardTimer)
      utf8GuardTimer = undefined
    }
  }
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

  const interval = setInterval(enforce, 2000)
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

/**
 * 判断当前进程是否仍附加到某个控制台（仅 Windows）。
 *
 * GetConsoleWindow 返回调用进程附加的控制台窗口句柄；进程没有附加
 * 到任何控制台（终端窗口已关闭）时返回 NULL/0。
 */
function win32HasConsole(): boolean {
  if (!load()) return false
  const win = k32!.GetConsoleWindow()
  if (win == null) return false
  // bun:ffi "ptr" 在有控制台时返回 number（句柄值），无控制台返回 null；
  // koffi 统一转成 number。兼容两种返回。
  return typeof win === "number" ? win !== 0 : true
}

/**
 * 终端关闭检测：终端窗口/标签页关闭时触发 onClose。
 *
 * 为什么需要：Windows 关闭终端窗口时不会向子进程可靠传播 SIGHUP
 * （Node/Bun 下 SIGHUP 仅 Unix 有效），TUI/CLI/mini 可能残留为孤儿进程
 * 持续占用内存。此处提供跨运行时统一的检测：
 * - Windows：轮询 GetConsoleWindow()，进程不再附加到控制台即判定终端已关闭；
 * - 其他平台：监听 SIGHUP。
 *
 * 返回取消函数；检测不可用（如无法加载 kernel32）时返回空操作。
 */
export function watchTerminalClose(onClose: () => void, intervalMs = 2000): () => void {
  if (process.platform !== "win32") {
    process.on("SIGHUP", onClose)
    return () => process.off("SIGHUP", onClose)
  }
  if (!load()) return () => {}
  const timer = setInterval(() => {
    if (!win32HasConsole()) onClose()
  }, intervalMs)
  timer.unref?.()
  return () => clearInterval(timer)
}
