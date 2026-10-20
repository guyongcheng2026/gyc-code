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

/** 可注入的定时器句柄：只要求具备 unref 能力。 */
export interface TerminalTimer {
  unref(): void
}

/**
 * 平台相关依赖的注入点。
 *
 * 为什么要注入：本文件的 win32 行为只在 Windows 上生效，而 CI 跑在
 * ubuntu-latest，直接调用真实 setInterval / 控制台无法在测试中观察
 * 定时器的创建与销毁。注入后测试可用假定时器断言生命周期。
 */
export interface TerminalWin32Deps {
  isWindows: () => boolean
  isConsoleAttached: () => boolean
  isStdinTTY: () => boolean
  loadKernel: () => Win32Kernel | undefined
  setInterval: (callback: () => void, ms: number) => TerminalTimer
  clearInterval: (timer: TerminalTimer) => void
  /** 终端关闭诊断日志；未提供时写入默认日志文件。 */
  writeLog?: (line: string) => void
}

const defaultDeps: TerminalWin32Deps = {
  isWindows: () => process.platform === "win32",
  isConsoleAttached: () => process.stdout.isTTY || process.stderr.isTTY,
  isStdinTTY: () => process.stdin.isTTY,
  loadKernel: () => {
    if (process.platform !== "win32") return undefined
    try {
      k32 ??= win32KernelLoader.load()
      return k32 ?? undefined
    } catch {
      return undefined
    }
  },
  setInterval: (callback, ms) => setInterval(callback, ms),
  clearInterval: (timer) => clearInterval(timer as unknown as ReturnType<typeof setInterval>),
}

function load(deps?: TerminalWin32Deps): boolean {
  return resolveKernel(deps) !== undefined
}

/** 取 kernel32 句柄：注入 deps 时用注入源，否则走平台默认加载。 */
function resolveKernel(deps?: TerminalWin32Deps): Win32Kernel | undefined {
  if (deps) return deps.loadKernel()
  return defaultDeps.loadKernel()
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
export function win32EnableUtf8Console(deps?: TerminalWin32Deps): boolean {
  const d = deps ?? defaultDeps
  if (!d.isWindows()) return false
  if (!d.isConsoleAttached()) return false
  const kernel = resolveKernel(d)
  if (!kernel) return false
  // 始终显式强制设置为 UTF-8（65001），无论当前状态如何。
  // 这样可防止控制台状态在两次 guard interval 间持久化腐化，
  // 尤其是OpenTUI 渲染层长时间运行后的状态异常问题。
  kernel.SetConsoleOutputCP(CP_UTF8)
  kernel.SetConsoleCP(CP_UTF8)
  // 读回校验：确认输出代码页确实切到 65001。返回 false 表示设置未生效
  // （句柄失效/被外部程序持续篡改），供守护计数诊断。
  try {
    return kernel.GetConsoleOutputCP() === CP_UTF8
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
export function win32GetConsoleCodePage(deps?: TerminalWin32Deps): number {
  const d = deps ?? defaultDeps
  if (!d.isWindows()) return -1
  if (!d.isConsoleAttached()) return -1
  const kernel = resolveKernel(d)
  if (!kernel) return -1
  return kernel.GetConsoleOutputCP()
}

/**
 * 低频率轮询重断言控制台输出/输入代码页为 UTF-8（65001）。
 *
 * 与 win32InstallCtrlCGuard 同理：控制台代码页是控制台全局状态，运行期间
 * 被子进程/外部程序（工具执行 chcp、GBK 原生程序等）复位后，TUI 的 UTF-8
 * 输出会重新变成乱码——表现为"运行一段时间后突然乱码"。轮询幂等且开销极小
 * （仅 kernel32 的 Get/Set 调用，无 IO），作为 TUI 渲染期间的后备保障。
 *
 * 实现要点：
 * 1. 保留 unref()：unref 只解除"事件循环空闲时吊住进程"的作用，不改变
 *    定时器的触发节奏（事件循环繁忙时定时器照常到期）。移除它会让丢弃
 *    uninstall 句柄的常驻调用方（如 CLI 入口）永不退出。
 * 2. 包装回调捕获异常，防止单次失败导致定时器永久停止
 * 3. 默认间隔 2000ms：代码页被外部程序改回是低频事件，200ms 会在 TUI
 *    运行期恒定做 5Hz kernel32 FFI 调用，纯属空转烧 CPU
 * 4. 每次回调前重新 load()，应对 kernel32 句柄失效场景
 *
 * 已知局限：定时器回调无法抢占长同步块。若 TUI 正处在一段长同步计算中，
 * 代码页被外部程序复位后，恢复动作会推迟到事件循环重新空闲为止。
 */
let utf8GuardTimer: TerminalTimer | undefined
/** 销毁 utf8GuardTimer 时使用的 clearInterval：必须与创建时的依赖同源。 */
let utf8GuardClear: ((timer: TerminalTimer) => void) | undefined
let utf8GuardRefs = 0
// 守护回调中"设置后读回校验失败"的累计次数：持续增长说明有外部程序
// 在反复复位代码页（如 GBK 原生工具），供诊断定位乱码来源。
let utf8GuardMismatchCount = 0

/** UTF-8 代码页守护的读回失败累计次数（仅诊断用）。 */
export function utf8GuardMismatches(): number {
  return utf8GuardMismatchCount
}

/** 仅测试用：重置 UTF-8 守护的模块级状态（定时器 / 引用计数 / 失配计数）。 */
export function resetUtf8GuardForTest(): void {
  if (utf8GuardTimer) utf8GuardClear?.(utf8GuardTimer)
  utf8GuardTimer = undefined
  utf8GuardClear = undefined
  utf8GuardRefs = 0
  utf8GuardMismatchCount = 0
}

// 2000ms：代码页被外部程序改回是低频事件（用户手动切代码页 / 调起 GBK 原生工具），
// 2 秒响应足够；而 200ms 会在 TUI 运行期恒定做 5Hz kernel32 FFI 调用，纯属空转烧 CPU。
export function win32InstallUtf8ConsoleGuard(intervalMs = 2000, deps?: TerminalWin32Deps): () => void {
  const d = deps ?? defaultDeps
  if (!d.isWindows()) return () => {}
  if (!d.isConsoleAttached()) return () => {}
  // 不在这里提前 load()，改为在每次回调中重试，避免句柄失效导致后续无效
  if (!utf8GuardTimer) {
    // 首次启用失败会直接抛出（控制台不可用属致命环境问题）。此时定时器尚未
    // 创建、引用计数尚未自增，不会留下半安装状态。
    win32EnableUtf8Console(d)
    const interval = d.setInterval(() => {
      try {
        // 每次回调都尝试重新加载kernel32，应对句柄失效
        if (load(d)) {
          if (!win32EnableUtf8Console(d)) utf8GuardMismatchCount += 1
        }
      } catch {
        // 可忽略（纯诊断旁路）：load() 失败时下一轮会重试；这里抛出只会终止守护，
        // 反而让乱码失去唯一的自愈来源，故刻意吞掉以保证定时器持续运行。
      }
    }, intervalMs)
    // unref()：只解除"事件循环空闲时吊住进程"的作用，不改变触发节奏；
    // 缺少它会让丢弃 uninstall 句柄的调用方（如 CLI 入口）永不退出。
    interval.unref()
    utf8GuardTimer = interval
    utf8GuardClear = d.clearInterval
  }
  utf8GuardRefs += 1
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    utf8GuardRefs -= 1
    if (utf8GuardRefs === 0 && utf8GuardTimer) {
      utf8GuardClear?.(utf8GuardTimer)
      utf8GuardTimer = undefined
      utf8GuardClear = undefined
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
export function win32InstallCtrlCGuard(deps?: TerminalWin32Deps) {
  const d = deps ?? defaultDeps
  if (!d.isWindows()) return
  if (!d.isStdinTTY()) return
  const kernel = resolveKernel(d)
  if (!kernel) return
  if (unhook) return unhook

  const stdin = process.stdin as ReadStream
  const original = stdin.setRawMode

  const handle = kernel.GetStdHandle(STD_INPUT_HANDLE)
  const buf = [0]

  if (kernel.GetConsoleMode(handle, buf) === 0) return
  const initial = buf[0]!

  const enforce = () => {
    if (kernel.GetConsoleMode(handle, buf) === 0) return
    const mode = buf[0]!
    if ((mode & ENABLE_PROCESSED_INPUT) === 0) return
    kernel.SetConsoleMode(handle, mode & ~ENABLE_PROCESSED_INPUT)
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

  const interval = d.setInterval(() => {
    try {
      if (load(d)) enforce()
    } catch {
      // 静默吞掉异常，保证定时器持续运行
    }
  }, 2000)
  // unref()：只解除"事件循环空闲时吊住进程"的作用，不改变触发节奏。
  interval.unref()

  let done = false
  unhook = () => {
    if (done) return
    done = true

    d.clearInterval(interval)
    if (wrapped && stdin.setRawMode === wrapped) {
      stdin.setRawMode = original
    }

    kernel.SetConsoleMode(handle, initial)
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
function win32HasConsole(deps?: TerminalWin32Deps): boolean {
  const kernel = resolveKernel(deps)
  if (!kernel) return false
  const win = kernel.GetConsoleWindow()
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
export function watchTerminalClose(onClose: () => void, intervalMs = 2000, deps?: TerminalWin32Deps): () => void {
  const d = deps ?? defaultDeps
  if (!d.isWindows()) {
    process.on("SIGHUP", onClose)
    return () => process.off("SIGHUP", onClose)
  }
  // 如果没有真实控制台（如重定向输出），直接返回空操作，避免误报
  if (!d.isConsoleAttached()) return () => {}

  let consecutiveFailures = 0
  const REQUIRED_FAILURES = 3 // 连续 3 次失败才判定终端关闭，防止启动瞬态误报
  // 启动宽限期：前 5 秒不检测，给 OpenTUI alternate screen 切换留出缓冲。
  // 用时间戳判定而非 setTimeout 回调：卸载后不残留定时器，且可被测试推进。
  const startedAt = Date.now()
  const STARTUP_GRACE_MS = 5000
  let closed = false

  // 不提前 load()，改为在回调中重试
  const timer = d.setInterval(() => {
    if (closed) return
    try {
      if (Date.now() - startedAt < STARTUP_GRACE_MS) return
      if (!load(d)) return
      if (!d.isConsoleAttached()) return // 运行期间控制台被分离，不再检测
      if (!win32HasConsole(d)) {
        consecutiveFailures += 1
        if (consecutiveFailures >= REQUIRED_FAILURES) {
          // 判定成立：停止轮询并只回调一次，避免每 2s 重复触发 onClose
          closed = true
          d.clearInterval(timer)
          writeTerminalCloseLog(d, consecutiveFailures)
          onClose()
        }
      } else {
        consecutiveFailures = 0 // 重置计数器
      }
    } catch {
      // 静默吞掉异常，保证定时器持续运行
    }
  }, intervalMs)
  // unref()：只解除"事件循环空闲时吊住进程"的作用，不改变触发节奏。
  timer.unref()
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    d.clearInterval(timer)
  }
}

/** 终端关闭诊断日志：优先走注入的 sink，否则写默认日志文件（失败不影响检测逻辑）。 */
function writeTerminalCloseLog(deps: TerminalWin32Deps, consecutiveFailures: number): void {
  const line = `timestamp=${new Date().toISOString()} level=Info run=main terminal-close-detected consecutive=${consecutiveFailures}\n`
  if (deps.writeLog) {
    deps.writeLog(line)
    return
  }
  const logDir = Global.Path.log
  void mkdir(logDir, { recursive: true })
    .then(() => appendFile(join(logDir, "gyccode.log"), line))
    // 写日志本身失败不能再抛，忽略
    .catch(() => {
      // 终端关闭检测日志属诊断旁路：失败不影响关闭检测逻辑。
    })
}
