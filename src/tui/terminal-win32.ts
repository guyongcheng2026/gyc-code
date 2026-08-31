import { win32KernelLoader } from "#win32-kernel"
import type { Win32Kernel } from "./win32-kernel"
import type { ReadStream } from "node:tty"
import { mkdir, appendFile } from "node:fs/promises"
import { join } from "node:path"
import { Global } from "@gyccode/core/global"

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
export function win32EnableUtf8Console(): boolean {
  if (process.platform !== "win32") return false
  if (!isConsoleAttached()) return false
  if (!load()) return false
  // 始终显式强制设置为 UTF-8（65001），无论当前状态如何。
  // 这样可防止控制台状态在两次 guard interval 间持久化腐化，
  // 尤其是OpenTUI 渲染层长时间运行后的状态异常问题。
  k32!.SetConsoleOutputCP(CP_UTF8)
  k32!.SetConsoleCP(CP_UTF8)
  // 读回校验：确认输出代码页确实切到 65001。返回 false 表示设置未生效
  // （句柄失效/被外部程序持续篡改），供守护计数诊断。
  try {
    return k32!.GetConsoleOutputCP() === CP_UTF8
  } catch {
    return false
  }
}

/**
 * 读取当前控制台输出代码页（仅 Windows）。
 *
 * 用于验收/诊断：直接调用 kernel32 GetConsoleOutputCP，比 spawnSync("chcp.com")
 * 更可靠（后者在 bun 下不返回 stdout，且会引入额外子进程复位代码页的副作用）。
 * 无控制台或 kernel32 不可用时返回 -1。
 */
export function win32GetConsoleCodePage(): number {
  if (process.platform !== "win32") return -1
  if (!isConsoleAttached()) return -1
  if (!load()) return -1
  return k32!.GetConsoleOutputCP()
}

/**
 * 低频率轮询重断言控制台输出/输入代码页为 UTF-8（65001）。
 *
 * 与 win32InstallCtrlCGuard 同理：控制台代码页是控制台全局状态，运行期间
 * 被子进程/外部程序（工具执行 chcp、GBK 原生程序等）复位后，TUI 的 UTF-8
 * 输出会重新变成乱码——表现为"运行一段时间后突然乱码"。轮询幂等且开销极小
 * （仅 kernel32 的 Get/Set 调用，无 IO），作为 TUI 渲染期间的后备保障。
 *
 * 修复要点：
 * 1. 移除 unref()，确保定时器在事件循环繁忙时也能准时触发
 * 2. 包装回调捕获异常，防止单次失败导致定时器永久停止
 * 3. 缩短默认间隔至 200ms，更快恢复被子进程篡改的代码页
 * 4. 每次回调前重新 load()，应对 kernel32 句柄失效场景
 */
let utf8GuardTimer: ReturnType<typeof setInterval> | undefined
let utf8GuardRefs = 0
// 守护回调中"设置后读回校验失败"的累计次数：持续增长说明有外部程序
// 在反复复位代码页（如 GBK 原生工具），供诊断定位乱码来源。
let utf8GuardMismatchCount = 0

/** UTF-8 代码页守护的读回失败累计次数（仅诊断用）。 */
export function utf8GuardMismatches(): number {
  return utf8GuardMismatchCount
}

export function win32InstallUtf8ConsoleGuard(intervalMs = 200): () => void {
  if (process.platform !== "win32") return () => {}
  if (!isConsoleAttached()) return () => {}
  // 不在这里提前 load()，改为在每次回调中重试，避免句柄失效导致后续无效
  if (!utf8GuardTimer) {
    win32EnableUtf8Console()
    const interval = setInterval(() => {
      try {
        // 每次回调都尝试重新加载kernel32，应对句柄失效
        if (load()) {
          if (!win32EnableUtf8Console()) utf8GuardMismatchCount += 1
        }
      } catch {
        // 静默吞掉异常，保证定时器持续运行
      }
    }, intervalMs)
    // 添加 unref()：防止定时器阻塞进程正常退出
    interval.unref()
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

  const interval = setInterval(() => {
    try {
      if (load()) enforce()
    } catch {
      // 静默吞掉异常，保证定时器持续运行
    }
  }, 2000)
  // 添加 unref()：防止定时器阻塞进程正常退出
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
  // 如果没有真实控制台（如重定向输出），直接返回空操作，避免误报
  if (!isConsoleAttached()) return () => {}
  
  let consecutiveFailures = 0
  const REQUIRED_FAILURES = 3 // 连续 3 次失败才判定终端关闭，防止启动瞬态误报
  let startupGracePeriod = true
  
  // 启动宽限期：前 5 秒不检测，给 OpenTUI alternate screen 切换留出缓冲
  setTimeout(() => { startupGracePeriod = false }, 5000).unref()
  
  // 不提前 load()，改为在回调中重试
  const timer = setInterval(() => {
    try {
      if (startupGracePeriod) return
      if (!load()) return
      if (!isConsoleAttached()) return // 运行期间控制台被分离，不再检测
      if (!win32HasConsole()) {
        consecutiveFailures += 1
        if (consecutiveFailures >= REQUIRED_FAILURES) {
          const logDir = Global.Path.log
          void mkdir(logDir, { recursive: true })
            .then(() =>
              appendFile(
                join(logDir, "gyccode.log"),
                `timestamp=${new Date().toISOString()} level=Info run=main terminal-close-detected consecutive=${consecutiveFailures}\n`,
              ),
            )
            // 写日志本身失败不能再抛，忽略
            .catch(() => {})
          onClose()
        }
      } else {
        consecutiveFailures = 0 // 重置计数器
      }
    } catch {
      // 静默吞掉异常，保证定时器持续运行
    }
  }, intervalMs)
  // 添加 unref()：防止定时器阻塞进程正常退出
  timer.unref()
  return () => clearInterval(timer)
}
