import { afterEach, describe, expect, setSystemTime, test } from "bun:test"
import type { Win32Kernel } from "./win32-kernel"
import {
  resetUtf8GuardForTest,
  utf8GuardMismatches,
  win32EnableUtf8Console,
  win32GetConsoleCodePage,
  win32InstallCtrlCGuard,
  win32InstallUtf8ConsoleGuard,
  watchTerminalClose,
  type TerminalTimer,
  type TerminalWin32Deps,
} from "./terminal-win32"

describe("terminal-win32 UTF-8 代码页", () => {
  test("启用后输出代码页读回为 65001（有控制台时）", () => {
    const enabled = win32EnableUtf8Console()
    if (!enabled) {
      // 无控制台环境（如 CI 管道）：函数应返回 false 而非抛错
      expect(win32GetConsoleCodePage()).toBe(-1)
      return
    }
    expect(win32GetConsoleCodePage()).toBe(65001)
  })

  test("守护失配计数器可用且非负", () => {
    expect(utf8GuardMismatches()).toBeGreaterThanOrEqual(0)
  })
})

/** 假定时器：记录是否被 unref / 被销毁。 */
interface FakeTimer extends TerminalTimer {
  delay: number
  callback: () => void
  unrefCount: number
  cleared: boolean
}

function createFakeKernel(overrides: Partial<Win32Kernel> = {}) {
  const setConsoleModeCalls: number[] = []
  const kernel: Win32Kernel = {
    GetStdHandle: () => 1234,
    GetConsoleMode: (_handle, out) => {
      out[0] = 0x0001
      return 1
    },
    SetConsoleMode: (_handle, mode) => {
      setConsoleModeCalls.push(mode)
      return 1
    },
    FlushConsoleInputBuffer: () => 1,
    SetConsoleOutputCP: () => 1,
    GetConsoleOutputCP: () => 65001,
    SetConsoleCP: () => 1,
    GetConsoleCP: () => 65001,
    // 默认表示「终端窗口已关闭」：GetConsoleWindow 返回 0 即无控制台窗口
    GetConsoleWindow: () => 0,
    ...overrides,
  }
  return { kernel, setConsoleModeCalls }
}

function createFakeDeps(loadKernel?: () => Win32Kernel | undefined) {
  const timers: FakeTimer[] = []
  const logLines: string[] = []
  const deps: TerminalWin32Deps = {
    isWindows: () => true,
    isConsoleAttached: () => true,
    isStdinTTY: () => true,
    loadKernel: loadKernel ?? (() => createFakeKernel().kernel),
    setInterval: (callback, ms) => {
      const timer: FakeTimer = {
        delay: ms,
        callback,
        unrefCount: 0,
        cleared: false,
        unref() {
          timer.unrefCount += 1
        },
      }
      timers.push(timer)
      return timer
    },
    clearInterval: (timer) => {
      for (const t of timers) if (t === timer) t.cleared = true
    },
    writeLog: (line) => {
      logLines.push(line)
    },
  }
  return { deps, timers, logLines }
}

afterEach(() => {
  resetUtf8GuardForTest()
  setSystemTime()
})

describe("terminal-win32 守护定时器生命周期", () => {
  test("UTF-8 守护：轮询定时器被 unref，不阻塞进程退出", () => {
    const { deps, timers } = createFakeDeps()
    const stop = win32InstallUtf8ConsoleGuard(2000, deps)
    expect(timers.length).toBe(1)
    expect(timers[0]!.unrefCount).toBe(1)
    stop()
  })

  test("UTF-8 守护：默认轮询间隔为 2000ms", () => {
    const { deps, timers } = createFakeDeps()
    const stop = win32InstallUtf8ConsoleGuard(undefined, deps)
    expect(timers[0]!.delay).toBe(2000)
    stop()
  })

  test("UTF-8 守护：多次 install 复用同一��时器，引用计数归零才销毁", () => {
    const { deps, timers } = createFakeDeps()
    const stop1 = win32InstallUtf8ConsoleGuard(2000, deps)
    const stop2 = win32InstallUtf8ConsoleGuard(2000, deps)
    const stop3 = win32InstallUtf8ConsoleGuard(2000, deps)
    expect(timers.length).toBe(1)
    stop1()
    expect(timers[0]!.cleared).toBe(false)
    stop2()
    expect(timers[0]!.cleared).toBe(false)
    stop3()
    expect(timers[0]!.cleared).toBe(true)
  })

  test("UTF-8 守护：同一个卸载函数重复调用不会把引用计数减成负数", () => {
    const { deps, timers } = createFakeDeps()
    const stop1 = win32InstallUtf8ConsoleGuard(2000, deps)
    const stop2 = win32InstallUtf8ConsoleGuard(2000, deps)
    stop1()
    stop1()
    stop2()
    expect(timers[0]!.cleared).toBe(true)
  })

  test("UTF-8 守护：install 抛错不泄漏引用计数，后续卸载仍能销毁定时器", () => {
    const boom = createFakeKernel({
      SetConsoleOutputCP: () => {
        throw new Error("kernel32 boom")
      },
    })
    const failing = createFakeDeps(() => boom.kernel)
    expect(() => win32InstallUtf8ConsoleGuard(2000, failing.deps)).toThrow("kernel32 boom")
    expect(failing.timers.length).toBe(0)

    const ok = createFakeDeps()
    const stop = win32InstallUtf8ConsoleGuard(2000, ok.deps)
    stop()
    expect(ok.timers[0]!.cleared).toBe(true)
  })

  test("UTF-8 守护：卸载后重新 install 会新建定时器", () => {
    const { deps, timers } = createFakeDeps()
    win32InstallUtf8ConsoleGuard(2000, deps)()
    const stop = win32InstallUtf8ConsoleGuard(2000, deps)
    expect(timers.length).toBe(2)
    stop()
    expect(timers[1]!.cleared).toBe(true)
  })

  test("Ctrl+C 守护：轮询定时器被 unref，卸载时销毁并恢复原控制台模式", () => {
    const { kernel, setConsoleModeCalls } = createFakeKernel()
    const { deps, timers } = createFakeDeps(() => kernel)
    const unguard = win32InstallCtrlCGuard(deps)
    expect(timers.length).toBe(1)
    expect(timers[0]!.unrefCount).toBe(1)
    unguard?.()
    expect(timers[0]!.cleared).toBe(true)
    expect(setConsoleModeCalls).toEqual([0x0000, 0x0001])
  })

  test("终端关闭检测：轮询定时器被 unref，卸载时销毁", () => {
    const { deps, timers } = createFakeDeps()
    let closed = 0
    const stop = watchTerminalClose(
      () => {
        closed += 1
      },
      2000,
      deps,
    )
    expect(timers.length).toBe(1)
    expect(timers[0]!.unrefCount).toBe(1)
    stop()
    expect(timers[0]!.cleared).toBe(true)
    expect(closed).toBe(0)
  })

  test("终端关闭检测：终端仍存活时永不触发 close", () => {
    const kernel = createFakeKernel({ GetConsoleWindow: () => 4321 }).kernel
    const { deps, timers } = createFakeDeps(() => kernel)
    let closed = 0
    const stop = watchTerminalClose(
      () => {
        closed += 1
      },
      2000,
      deps,
    )
    setSystemTime(new Date(Date.now() + 6000))
    for (let i = 0; i < 10; i++) timers[0]!.callback()
    expect(closed).toBe(0)
    stop()
  })

  test("终端关闭检测：启动宽限期内不判定，宽限期后连续失败才触发一次", () => {
    const { deps, timers, logLines } = createFakeDeps()
    let closed = 0
    const stop = watchTerminalClose(
      () => {
        closed += 1
      },
      2000,
      deps,
    )
    const tick = () => timers[0]!.callback()

    // 宽限期（5s）内：即使探测失败也不判定
    for (let i = 0; i < 5; i++) tick()
    expect(closed).toBe(0)

    // 宽限期后：连续 3 次失败判定终端关闭，且只触发一次
    setSystemTime(new Date(Date.now() + 6000))
    tick()
    tick()
    expect(closed).toBe(0)
    tick()
    expect(closed).toBe(1)
    // 判定后停止轮询，不再重复触发
    expect(timers[0]!.cleared).toBe(true)
    tick()
    expect(closed).toBe(1)
    // 诊断日志走注入的 sink，不写用户目录
    expect(logLines.length).toBe(1)
    expect(logLines[0]).toContain("terminal-close-detected")
    stop()
  })
})
