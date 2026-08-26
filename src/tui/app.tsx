import { render, TimeToFirstDraw, useRenderer, useTerminalDimensions } from "@opentui/solid"
import { registerGyccodeSpinner } from "./component/register-spinner"
import { useVimKeymap } from "./vim"
import { createDefaultOpenTuiKeymap } from "@opentui/keymap/opentui"
import { Deferred, Effect } from "effect"
import { Global } from "@gyccode/core/global"
import { Flag } from "@gyccode/core/flag/flag"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { ClipboardProvider, useClipboard } from "./context/clipboard"
import { ExitProvider, useExit } from "./context/exit"
import { EpilogueProvider } from "./context/epilogue"
import * as Selection from "./util/selection"
import { createCliRenderer, MouseButton } from "@opentui/core"
import { backendChoice, claimFallbackOnce, isExplicitFallback, shouldUseFallback } from "./fallback/safe-mode"
import { tuiTiming } from "./util/timing"
import { RouteProvider, useRoute } from "./context/route"
import {
  Switch,
  Match,
  createEffect,
  createMemo,
  ErrorBoundary,
  createSignal,
  onMount,
  onCleanup,
  batch,
  Show,
  on,
} from "solid-js"
import { TuiPathsProvider, TuiStartupProvider, TuiTerminalEnvironmentProvider, useTuiStartup } from "./context/runtime"
import { DialogProvider, useDialog } from "./ui/dialog"
import { DialogProvider as DialogProviderList } from "./component/dialog-provider"
import { ErrorComponent } from "./component/error-component"
import { PluginRouteMissing } from "./component/plugin-route-missing"
import { ProjectProvider, useProject } from "./context/project"
import { EditorContextProvider } from "./context/editor"
import { useEvent } from "./context/event"
import { SDKProvider, useSDK } from "./context/sdk"
import { StartupLoading } from "./component/startup-loading"
import { SyncProvider, useSync } from "./context/sync"
import { DataProvider } from "./context/data"
import { LocationProvider } from "./context/location"
import { LocalProvider, useLocal } from "./context/local"
import { PermissionProvider } from "./context/permission"
import { DialogModel } from "./component/dialog-model"
import { useConnected } from "./component/use-connected"
import { DialogMcp } from "./component/dialog-mcp"
import { DialogStatus } from "./component/dialog-status"
import { DialogDebug } from "./component/dialog-debug"
import { DialogDoctor } from "./component/dialog-doctor"
import { DialogConfig } from "./component/dialog-config"
import { DialogUsage } from "./component/dialog-usage"
import { DialogPermissions } from "./component/dialog-permissions"
import { DialogVim } from "./component/dialog-vim"
import { DialogLogin } from "./component/dialog-login"
import { DialogLogout } from "./component/dialog-logout"
import { DialogHooks } from "./component/dialog-hooks"
import { DialogCommit } from "./component/dialog-commit"
import { DialogMemory } from "./component/dialog-memory"
import { DialogUpgrade } from "./component/dialog-upgrade"
import { DialogReleaseNotes } from "./component/dialog-release-notes"
import { DialogFeedback } from "./component/dialog-feedback"
import { DialogThemeList } from "./component/dialog-theme-list"
import { DialogHelp } from "./ui/dialog-help"
import { DialogAgent } from "./component/dialog-agent"
import { DialogSessionList } from "./component/dialog-session-list"
import { DialogWorkspaceList } from "./component/dialog-workspace-list"
import { DialogConsoleOrg } from "./component/dialog-console-org"
import { ThemeProvider, useTheme } from "./context/theme"
import { Home } from "./routes/home"
import { Session } from "./routes/session"
import { PromptHistoryProvider } from "./component/prompt/history"
import { FrecencyProvider } from "./component/prompt/frecency"
import { PromptStashProvider } from "./component/prompt/stash"
import { DialogAlert } from "./ui/dialog-alert"
import { DialogConfirm } from "./ui/dialog-confirm"
import { ToastProvider, useToast } from "./ui/toast"
import { isDefaultTitle } from "./util/session"
import { KVProvider, useKV } from "./context/kv"
import * as Model from "./util/model"
import { ArgsProvider, useArgs, type Args } from "./context/args"
import open from "open"
import { PromptRefProvider, usePromptRef } from "./context/prompt"
import { TuiConfigProvider, useTuiConfig, type TuiConfig } from "./config"
import { createTuiApiAdapters } from "./plugin/adapters"
import { createTuiApi } from "./plugin/api"
import { createPluginRuntime, PluginRuntimeProvider, usePluginRuntime, type TuiPluginHost } from "./plugin/runtime"
import { CommandPaletteDialog } from "./component/command-palette"
import {
  COMMAND_PALETTE_COMMAND,
  GYCCODE_BASE_MODE,
  GyccodeKeymapProvider,
  registerGyccodeKeymap,
  useBindings,
  useGyccodeKeymap,
} from "./keymap"

import type { EventSource } from "./context/sdk"
import { DialogVariant } from "./component/dialog-variant"
import { createTuiAttention } from "./attention"
import * as TuiAudio from "./audio"
import {
  watchTerminalClose,
  win32DisableProcessedInput,
  win32EnableUtf8Console,
  win32FlushInputBuffer,
  win32InstallUtf8ConsoleGuard,
} from "./terminal-win32"
import { destroyRenderer } from "./util/renderer"
import { appendFile, mkdir, readdir, rm } from "node:fs/promises"
import { writeHeapSnapshot } from "node:v8"
import { join } from "node:path"
import os from "node:os"
import { cliErrorMessage, errorFormat } from "./util/error"

registerGyccodeSpinner()

const appGlobalBindingCommands = [
  "session.list",
  "session.new",
  "session.quick_switch.1",
  "session.quick_switch.2",
  "session.quick_switch.3",
  "session.quick_switch.4",
  "session.quick_switch.5",
  "session.quick_switch.6",
  "session.quick_switch.7",
  "session.quick_switch.8",
  "session.quick_switch.9",
] as const

const appBindingCommands = [
  "command.palette.show",
  "model.list",
  "model.cycle_recent",
  "model.cycle_recent_reverse",
  "model.cycle_favorite",
  "model.cycle_favorite_reverse",
  "agent.list",
  "mcp.list",
  "agent.cycle",
  "agent.cycle.reverse",
  "variant.cycle",
  "variant.list",
  "provider.connect",
  "console.org.switch",
  "gyccode.status",
  "gyccode.debug",
  "theme.switch",
  "theme.switch_mode",
  "theme.mode.lock",
  "help.show",
  "diff.open",
  "workspace.list",
  "app.debug",
  "app.console",
  "app.heap_snapshot",
  "terminal.suspend",
  "terminal.title.toggle",
  "app.toggle.animations",
  "app.toggle.file_context",
  "app.toggle.diffwrap",
  "app.toggle.paste_summary",
  "app.toggle.session_directory_filter",
  "gyccode.doctor",
  "gyccode.config",
  "gyccode.usage",
  "gyccode.permissions",
  "gyccode.vim",
  "gyccode.login",
  "gyccode.logout",
  "gyccode.hooks",
  "gyccode.commit",
  "gyccode.memory",
  "gyccode.upgrade",
  "gyccode.release_notes",
  "gyccode.feedback",
] as const

export type TuiInput = {
  url: string
  args: Args
  /** 配置以 Promise 注入：首帧骨架屏不等配置，就绪后由 <Show> 切换完整应用树 */
  config: Promise<TuiConfig.Resolved>
  onSnapshot?: () => Promise<string[]>
  directory?: string
  fetch?: typeof fetch
  headers?: RequestInit["headers"]
  events?: EventSource
  pluginHost: TuiPluginHost
}

// 骨架启动屏：零 Provider 依赖（此阶段 config/theme/KV 均未就绪），
// 仅覆盖 TuiConfig 获取窗口，配置到达后由 <Show> 卸载、完整树接管。
const BOOT_SPIN = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

function BootSplash() {
  const [frame, setFrame] = createSignal(0)
  const timer = setInterval(() => setFrame((f) => (f + 1) % BOOT_SPIN.length), 120).unref()
  onCleanup(() => clearInterval(timer))
  return (
    <box position="absolute" zIndex={5000} left={0} top={0} right={0} bottom={0} justifyContent="center" alignItems="center">
      <box flexDirection="row" gap={1}>
        <text>{BOOT_SPIN[frame()]}</text>
        <text>gyc 正在启动…</text>
      </box>
    </box>
  )
}

function errorMessage(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "data" in error &&
    typeof error.data === "object" &&
    error.data !== null &&
    "message" in error.data &&
    typeof error.data.message === "string"
  ) {
    return error.data.message
  }
  return error instanceof Error ? error.message : String(error)
}

function isVersionGreater(left: string, right: string) {
  const parse = (value: string) => {
    const [core, prerelease] = value.replace(/^v/, "").split("-", 2)
    return { core: core.split(".").map((part) => Number.parseInt(part, 10) || 0), prerelease }
  }
  const a = parse(left)
  const b = parse(right)
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index++) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference) return difference > 0
  }
  if (a.prerelease === b.prerelease) return false
  if (!a.prerelease) return true
  if (!b.prerelease) return false
  return a.prerelease.localeCompare(b.prerelease, undefined, { numeric: true }) > 0
}

export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
  const global = yield* Global.Service
  const exit = { epilogue: undefined as string | undefined, reason: undefined as unknown }
  const result = yield* Effect.scoped(
    Effect.gen(function* () {
      // 在创建渲染器前立即切换控制台代码页为 UTF-8（65001），
      // 防止首帧渲染（spinner、中文文本）出现乱码。
      // 之后再安装守护定时器，防止运行期间被子进程/外部程序复位。
      win32EnableUtf8Console()
      win32DisableProcessedInput()
      const unguardUtf8Console = win32InstallUtf8ConsoleGuard()
      // S2 灰度切换（R3：GYC_TUI_BACKEND=auto/opentui 一键切回）：默认走自研
      // 渲染后端（backendChoice 未设置时返回 "fallback"）；显式 fallback 同路径。
      // auto 模式仍走 opentui（含创建失败降级）；opentui 模式纯原生。
      if (backendChoice() === "fallback") {
        yield* Effect.promise(async () => {
          // G5 归因：source 区分显式选择与 S2 默认值
          const source = isExplicitFallback() ? "explicit" : "default"
          void mkdir(global.log, { recursive: true })
            .then(() =>
              appendFile(
                join(global.log, "gyccode.log"),
                `timestamp=${new Date().toISOString()} level=Info run=main renderer=fallback backend=fallback source=${source} event=backend-selected\n`,
              ),
            )
            .catch(() => {})
          const { runFallbackApp } = await import("./fallback/run-app")
          await runFallbackApp({
            transport:
              input.events && input.fetch
                ? { url: input.url, fetch: input.fetch, headers: input.headers, events: input.events }
                : undefined,
            directory: input.directory,
          })
        })
        return { epilogue: exit.epilogue, reason: exit.reason }
      }
      // 骨架屏并行化：config 由调用方以 Promise 注入（与 worker/effect 模块加载
      // 并行获取）。首帧只渲染零 config 依赖的骨架层，配置到达后 <Show> 切换
      // 完整应用树——TuiConfig.get() 实测约 1.2s，不再挡住首帧。
      const [config, setConfig] = createSignal<TuiConfig.Resolved | undefined>(undefined)
      const renderer = yield* Effect.acquireRelease(
        Effect.tryPromise({
          try: async () => {
            try {
              const r = await createCliRenderer({
                externalOutputMode: "passthrough",
                targetFps: 30,
                // S0 P5 基线采集：GYC_TUI_STATS=1 开启帧统计（默认关闭，行为不变），
                // 供 opentui 端帧耗时与 fallback 引擎对比验收。
                gatherStats: process.env.GYC_TUI_STATS === "1",
                exitOnCtrlC: false,
                useKittyKeyboard: {},
                autoFocus: false,
                openConsoleOnError: false,
                // 骨架期先关闭；配置到达后经 renderer.useMouse setter 运行时补启
                useMouse: false,
                consoleOptions: {
                  keyBindings: [{ name: "y", ctrl: true, action: "copy-selection" }],
                },
              })
              tuiTiming("opentui renderer created")
              return r
            } catch (error) {
              // 自动降级通道：原生层初始化失败时进入纯 JS 安全模式，
              // 变「黑屏退出」为可用保底；用户退出后仍抛出原错误走报错路径。
              // GYC_TUI_BACKEND=opentui 可禁用降级。
              if (shouldUseFallback()) {
                // S0 G5 可观测：降级事件带 renderer 归因（T3 触发条件的监测数据源）
                void mkdir(global.log, { recursive: true })
                  .then(() =>
                    appendFile(
                      join(global.log, "gyccode.log"),
                      `timestamp=${new Date().toISOString()} level=Error run=main renderer=opentui backend=${backendChoice()} event=renderer-create-degraded message=${error instanceof Error ? error.message : String(error)}\n`,
                    ),
                  )
                  .catch(() => {})
                const { runFallbackSafeMode } = await import("./fallback/safe-mode")
                await runFallbackSafeMode({ error })
              }
              throw error instanceof Error ? error : new Error(String(error))
            }
          },
          catch: (error) => (error instanceof Error ? error : new Error(String(error))),
        }),
        (renderer) =>
          Effect.sync(() => {
            destroyRenderer(renderer)
          }),
      )
      yield* Effect.addFinalizer(() => Effect.sync(unguardUtf8Console))
      const keymap = createDefaultOpenTuiKeymap(renderer)
      // keymap 绑定中 leader/输入层需要 config，注册延迟到 config 就绪 fiber；
      // 卸载仍由 scope finalizer 保证。
      let keymapOff: (() => void) | undefined
      yield* Effect.addFinalizer(() =>
        Effect.sync(() => {
          keymapOff?.()
        }),
      )
      yield* Effect.addFinalizer(() =>
        Effect.promise(async () => {
          try {
            await input.pluginHost.dispose()
          } catch (error) {
            console.error("Failed to dispose TUI plugins", error)
          }
        }),
      )
      yield* Effect.addFinalizer(() => Effect.sync(TuiAudio.dispose))
      const shutdown = yield* Deferred.make<unknown>()
      const onSighup = () => destroyRenderer(renderer)
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          process.on("SIGHUP", onSighup)
          // Windows 无 SIGHUP：用控制台检测兜底，终端窗口关闭时销毁渲染器退出
          return watchTerminalClose(onSighup)
        }),
        (cancel) =>
          Effect.sync(() => {
            process.off("SIGHUP", onSighup)
            cancel()
          }),
      )
      renderer.once("destroy", () => Deferred.doneUnsafe(shutdown, Effect.void))
      // 主进程崩溃兜底：任何未捕获异常/未处理拒绝，先恢复终端再退出，避免
      // OpenTUI 残留 alternate screen 与 ANSI 序列导致回到 shell 后乱码；同时写
      // 主进程错误日志（worker 已有日志，主进程此前是诊断黑洞）。
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          const writeMainCrash = (kind: string, error: unknown) => {
            const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
            const rssMB = Math.round(process.memoryUsage().rss / 1024 / 1024)
            void mkdir(global.log, { recursive: true })
              .then(() =>
                appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Error run=main renderer=opentui backend=${backendChoice()} ${kind} message=${detail} rss=${rssMB}MB\n`,
                ),
              )
              .catch(() => {})
          }
          const restoreTerminalAndExit = (code: number) => {
            try {
              win32FlushInputBuffer()
            } catch {}
            try {
              destroyRenderer(renderer)
            } catch {}
            process.exit(code)
          }
          // 运行中原生崩溃的降级通道：清场后进入纯 JS 安全模式展示崩溃摘要，
          // 用户退出后再按原 exit code 退出。claimFallbackOnce 一次性护栏：
          // 安全模式内再崩直接退，杜绝降级循环。GYC_TUI_BACKEND=opentui 禁用。
          let degrading = false
          const degradeToSafeModeAndExit = async (error: unknown, code: number) => {
            if (!shouldUseFallback() || degrading || !claimFallbackOnce()) {
              restoreTerminalAndExit(code)
              return
            }
            degrading = true
            // S0 G5 可观测：运行中崩溃降级事件带 renderer 归因
            void mkdir(global.log, { recursive: true })
              .then(() =>
                appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Error run=main renderer=opentui backend=${backendChoice()} event=runtime-crash-degraded message=${error instanceof Error ? error.message : String(error)}\n`,
                ),
              )
              .catch(() => {})
            try {
              win32FlushInputBuffer()
            } catch {}
            try {
              destroyRenderer(renderer)
            } catch {}
            try {
              const { runFallbackSafeMode } = await import("./fallback/safe-mode")
              await runFallbackSafeMode({ error })
            } catch {}
            process.exit(code)
          }
          const onUncaughtException = (error: Error) => {
            // AbortError / "Aborted" 是 Effect 正常取消流程（如用户中断、会话切换），
            // 不应触发崩溃退出。仅记录 debug 日志，不恢复终端、不退出进程。
            if (
              error.name === "AbortError" ||
              error.message?.includes("Aborted") ||
              error.message?.includes("Abort")
            ) {
              void mkdir(global.log, { recursive: true })
                .then(() =>
                  appendFile(
                    join(global.log, "gyccode.log"),
                    `timestamp=${new Date().toISOString()} level=Debug run=main uncaughtException-abort message=${error.message}\n`,
                  ),
                )
                .catch(() => {})
              return
            }
            writeMainCrash("uncaughtException", error)
            void degradeToSafeModeAndExit(error, 1)
          }
          const onUnhandledRejection = (reason: unknown) => {
            writeMainCrash("unhandledRejection", reason)
            void degradeToSafeModeAndExit(reason, 1)
          }
          process.on("uncaughtException", onUncaughtException)
          process.on("unhandledRejection", onUnhandledRejection)
          return () => {
            process.off("uncaughtException", onUncaughtException)
            process.off("unhandledRejection", onUnhandledRejection)
          }
        }),
        (cleanup) => Effect.sync(cleanup),
      )
      // 内存压力监控（三级）：低内存机器（如 3.9GB）下 gyc TUI 常驻约 800MB，
      // 长跑易触发 V8 堆 OOM。>0.4 WARN+主动 GC；>0.45 critical+堆快照+GC；
      // >0.5 销毁渲染器优雅退出（恢复终端），避免原生 OOM 崩溃残留 ANSI 乱码。
      // bin/gyc 以 --expose-gc --max-old-space-size 启动：堆超限变为可捕获的
      // RangeError，走 uncaughtException 兜底而非原生 abort。
      //
      // 2026-08-26 增强：① 增加 freemem（系统可用内存）维度——rss 阈值在
      // 系统被其他进程占用时会误判（rss 未到 50% 但物理内存已耗尽，V8 C++
      // 层先于 JS 守护崩溃，即 FatalOOM abort 的直接诱因）；② 低内存机器
      // （≤4GB）守护间隔 30s→10s，内存涨速快时 30s 粒度来不及拦。
      yield* Effect.acquireRelease(
        Effect.sync(() => {
          let warnOnce = false
          let criticalOnce = false
          let lastSample = 0
          // 启动宽限期：前 30 秒不做 fatal 判定，给 V8 堆增长、模块加载留出缓冲
          // 4GB 机器启动时 free memory 常跌至 100-200MB，属正常瞬态，不应触发退出
          let startupGracePeriod = true
          setTimeout(() => { startupGracePeriod = false }, 30_000).unref()
          
          // free < 256MB 的"致命"判定在低内存机器上是启动瞬态，采用连续多轮
          // 确认（本轮起 3 轮 × 10s ≈ 30s）再退出；rss > 50% 仍立即退出。
          let fatalStreak = 0
          const FATAL_STREAK_LIMIT = 3
          const totalMem = os.totalmem()
          const lowMemMachine = totalMem <= 4 * 1024 * 1024 * 1024
          // 主动 GC：bin/gyc 以 --expose-gc 启动 Node 时可用；未暴露时静默跳过
          const runGc = () => {
            try {
              ;(globalThis as { gc?: () => void }).gc?.()
            } catch {}
          }
          // critical 级堆快照：受 GYCCODE_AUTO_HEAP_SNAPSHOT 开关控制，
          // 仅保留最新 2 份，防止长跑反复触发写满磁盘
          const writeTuiMemorySnapshot = (rssMB: number) => {
            if (!Flag.GYCCODE_AUTO_HEAP_SNAPSHOT) return
            try {
              const file = join(
                global.log,
                `tui-memory-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`,
              )
              void Promise.resolve()
                .then(() => writeHeapSnapshot(file))
                .then(() =>
                  readdir(global.log).then((names) => {
                    const mine = names
                      .filter((n) => n.startsWith(`tui-memory-${process.pid}-`) && n.endsWith(".heapsnapshot"))
                      .sort()
                    for (const name of mine.slice(0, Math.max(0, mine.length - 2))) {
                      void rm(join(global.log, name), { force: true }).catch(() => {})
                    }
                  }),
                )
                .catch(() => {})
            } catch {}
          }
          const meter = setInterval(() => {
            try {
              const rss = process.memoryUsage().rss
              const total = os.totalmem()
              const free = os.freemem()
              const rssMB = Math.round(rss / 1024 / 1024)
              const totalMB = Math.round(total / 1024 / 1024)
              const freeMB = Math.round(free / 1024 / 1024)
              // 心跳采样：每 10 分钟一条 Info，供长跑内存趋势分析
              if (Date.now() - lastSample > 600_000) {
                lastSample = Date.now()
                // S0 P5 基线：GYC_TUI_STATS=1 时附带 opentui 帧统计，
                // 与 fallback 引擎基准（0.150ms/帧）做验收对比（帧耗时 ≤2 倍线）。
                let statsLine = ""
                if (process.env.GYC_TUI_STATS === "1") {
                  try {
                    const s = renderer.getStats()
                    statsLine = ` rendererStats fps=${s.fps.toFixed(1)} avgFrameMs=${s.averageFrameTime.toFixed(3)} frames=${s.frameCount}`
                  } catch {}
                }
                void appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Info run=main memory-sample rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB${statsLine}\n`,
                ).catch(() => {})
              }
              // 启动宽限期内只记录不退出，给 V8 堆稳定留时间
              if (startupGracePeriod) {
                void appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Info run=main memory-startup-grace rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB\n`,
                ).catch(() => {})
                runGc()
                return
              }
              // 系统可用内存维度：物理内存即将耗尽时 V8 C++ 层（TurboFan/
              // 地址空间分配）先于 JS 堆守护崩溃——不可捕获的 FatalOOM abort。
              // free < 256MB 本属 fatal，但低内存机器（4GB 机）启动瞬间游离于
              // 此线是常态：主进程+worker 加载临时吞掉数百 MB + Standby 缓存
              // 动态释放有延时，单轮 low 不代表不可恢复。改用连续多轮确认
              // （fatalStreak ≥3 才退出），期间写日志+尽力 GC，给喘息窗口。
              const systemFatal = free < 256 * 1024 * 1024
              if (rss > total * 0.5) {
                // 进程自身堆失控（rss>50%RAM）：真致命，立即降载退出
                void appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Error run=main memory-fatal rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB\n`,
                ).catch(() => {})
                runGc()
                try {
                  destroyRenderer(renderer)
                } catch {}
              } else if (systemFatal) {
                // 系统可用内存紧张：连续多轮确认才退出，防启动瞬态误杀
                fatalStreak += 1
                void appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Warn run=main memory-freelow streak=${fatalStreak}/${FATAL_STREAK_LIMIT} rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB\n`,
                ).catch(() => {})
                runGc()
                if (fatalStreak >= FATAL_STREAK_LIMIT) {
                  void appendFile(
                    join(global.log, "gyccode.log"),
                    `timestamp=${new Date().toISOString()} level=Error run=main memory-fatal rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB streak=${fatalStreak}\n`,
                  ).catch(() => {})
                  try {
                    destroyRenderer(renderer)
                  } catch {}
                }
              } else {
                // 系统内存恢复常态：reset 连续计数
                fatalStreak = 0
              }
              // 二级降载：rss 接近上限或 free 进入紧张带——写堆快照留证 + 主动
              // GC，尽量避免走到 fatal 退出。独立于 fatal 判断，fatal streak
              // 期间同样生效（free<256<512，条件恒真，仅首次写证）。
              if (rss > total * 0.45 || free < 512 * 1024 * 1024) {
                if (!criticalOnce) {
                  criticalOnce = true
                  void appendFile(
                    join(global.log, "gyccode.log"),
                    `timestamp=${new Date().toISOString()} level=Warn run=main memory-critical rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB\n`,
                  ).catch(() => {})
                  writeTuiMemorySnapshot(rssMB)
                }
                runGc()
              } else if (rss > total * 0.4 && !warnOnce) {
                // 一级预警：记录 + 主动 GC 尝试回落
                warnOnce = true
                void appendFile(
                  join(global.log, "gyccode.log"),
                  `timestamp=${new Date().toISOString()} level=Warn run=main memory-high rss=${rssMB}MB total=${totalMB}MB free=${freeMB}MB\n`,
                ).catch(() => {})
                runGc()
              }
            } catch {}
          }, lowMemMachine ? 10_000 : 30_000)
          meter.unref()
          return () => clearInterval(meter)
        }),
        (cleanup) => Effect.sync(cleanup),
      )
      const pluginRuntime = createPluginRuntime()

      // config 就绪 fiber：切换完整应用树 + 运行时补启鼠标 + 注册 keymap 绑定。
      // 配置读取失败（理论罕见：TuiConfig.get 内部已兜底降级）或应用阶段出错
      // 都走退出报错路径——fork fiber 的 defect 不会自动传播，必须显式兜底，
      // 与旧版"get() throw → handler 报错退出"语义对齐。
      yield* Effect.forkScoped(
        Effect.tryPromise(async () => {
          let resolved: TuiConfig.Resolved
          try {
            resolved = await input.config
          } catch (error) {
            if (!renderer.isDestroyed) {
              exit.reason = error
              destroyRenderer(renderer)
            }
            return
          }
          try {
            if (renderer.isDestroyed) return
            tuiTiming("tui config arrived (post-first-frame)")
            setConfig(resolved)
            if (!Flag.GYCCODE_DISABLE_MOUSE && resolved.mouse) renderer.useMouse = true
            keymapOff = registerGyccodeKeymap(keymap, renderer, resolved)
          } catch (error) {
            console.error("Failed to apply TUI config after splash", error)
            exit.reason = error
            if (!renderer.isDestroyed) destroyRenderer(renderer)
          }
        }),
      )

      yield* Effect.tryPromise(async () => {
        // 固定 dark 模式立即渲染，避免等待终端主题探测导致启动闪烁；手动切换由 theme_mode_lock 记住并优先。
        const mode = "dark"
        if (renderer.isDestroyed) return

        await render(() => {
          return (
            <ExitProvider
              exit={(reason) => {
                if (renderer.isDestroyed) return
                exit.reason = reason
                destroyRenderer(renderer)
              }}
            >
              <EpilogueProvider set={(value) => (exit.epilogue = value)}>
                <ErrorBoundary fallback={(error, reset) => <ErrorComponent error={error} reset={reset} mode={mode} />}>
                  <TuiPathsProvider
                    value={{
                      cwd: process.cwd(),
                      home: global.home,
                      state: global.state,
                      worktree: global.data + "/worktree",
                    }}
                  >
                    <TuiTerminalEnvironmentProvider
                      value={{
                        platform: process.platform,
                        multiplexer: process.env.TMUX ? "tmux" : process.env.STY ? "screen" : undefined,
                        displayServer: process.env.WAYLAND_DISPLAY
                          ? "wayland"
                          : process.env.DISPLAY
                            ? "x11"
                            : undefined,
                      }}
                    >
                      <TuiStartupProvider
                        value={{
                          initialRoute: process.env.GYCCODE_ROUTE ? JSON.parse(process.env.GYCCODE_ROUTE) : undefined,
                          skipInitialLoading: Boolean(process.env.GYCCODE_FAST_BOOT),
                        }}
                      >
                        <Show when={config()} keyed fallback={<BootSplash />}>
                          {(c) => (
                            <ClipboardProvider>
                              <GyccodeKeymapProvider keymap={keymap}>
                                <ArgsProvider {...input.args}>
                                  <KVProvider>
                                    <ToastProvider>
                                      <RouteProvider
                                        initialRoute={
                                          input.args.continue
                                            ? {
                                                type: "session",
                                                sessionID: "dummy",
                                              }
                                            : undefined
                                        }
                                      >
                                        <TuiConfigProvider config={c}>
                                          <PluginRuntimeProvider value={pluginRuntime}>
                                            <SDKProvider
                                              url={input.url}
                                              directory={input.directory}
                                              fetch={input.fetch}
                                              headers={input.headers}
                                              events={input.events}
                                            >
                                              <PermissionProvider>
                                                <ProjectProvider>
                                                  <SyncProvider>
                                                    <DataProvider>
                                                      <ThemeProvider mode={mode}>
                                                        <LocalProvider>
                                                          <PromptStashProvider>
                                                            <DialogProvider>
                                                              <FrecencyProvider>
                                                                <PromptHistoryProvider>
                                                                  <PromptRefProvider>
                                                                    <EditorContextProvider>
                                                                      <LocationProvider>
                                                                        <App
                                                                          onSnapshot={input.onSnapshot}
                                                                          pluginHost={input.pluginHost}
                                                                        />
                                                                      </LocationProvider>
                                                                    </EditorContextProvider>
                                                                  </PromptRefProvider>
                                                                </PromptHistoryProvider>
                                                              </FrecencyProvider>
                                                            </DialogProvider>
                                                          </PromptStashProvider>
                                                        </LocalProvider>
                                                      </ThemeProvider>
                                                    </DataProvider>
                                                  </SyncProvider>
                                                </ProjectProvider>
                                              </PermissionProvider>
                                            </SDKProvider>
                                          </PluginRuntimeProvider>
                                        </TuiConfigProvider>
                                      </RouteProvider>
                                    </ToastProvider>
                                  </KVProvider>
                                </ArgsProvider>
                              </GyccodeKeymapProvider>
                            </ClipboardProvider>
                          )}
                        </Show>
                      </TuiStartupProvider>
                    </TuiTerminalEnvironmentProvider>
                  </TuiPathsProvider>
                </ErrorBoundary>
              </EpilogueProvider>
            </ExitProvider>
          )
        }, renderer)
        tuiTiming("solid tree rendered (first mount)")
      })
      yield* Deferred.await(shutdown)
      return { epilogue: exit.epilogue, reason: exit.reason }
    }),
  )
  yield* Effect.sync(() => {
    win32FlushInputBuffer()
    if (result.reason !== undefined)
      process.stderr.write((cliErrorMessage(result.reason) ?? errorFormat(result.reason)) + "\n")
    if (result.epilogue) process.stdout.write(result.epilogue + "\n")
  })
})

function App(props: { onSnapshot?: () => Promise<string[]>; pluginHost: TuiPluginHost }) {
  const startup = useTuiStartup()
  const tuiConfig = useTuiConfig()
  const route = useRoute()
  const dimensions = useTerminalDimensions()
  const renderer = useRenderer()
  const dialog = useDialog()
  const local = useLocal()
  const kv = useKV()
  const keymap = useGyccodeKeymap()
  const event = useEvent()
  const sdk = useSDK()
  const toast = useToast()
  const themeState = useTheme()
  const { theme, mode, setMode, locked, lock, unlock } = themeState
  const sync = useSync()
  const project = useProject()
  const exit = useExit()
  const promptRef = usePromptRef()
  const pluginRuntime = usePluginRuntime()
  const attention = createTuiAttention({ renderer, config: tuiConfig, kv })
  const clipboard = useClipboard()
  // Vim 键绑定层：消费 KV vim_mode_enabled，提供 NORMAL/INSERT 模式编辑。
  // busy（会话流式输出）时 vim INSERT 层让位 escape，保证中断会话可用。
  useVimKeymap({
    busy: () => {
      if (route.data.type !== "session") return false
      const status = sync.data.session_status[route.data.sessionID]
      return status?.type === "busy" || status?.type === "retry"
    },
  })

  const api = createTuiApi(
    createTuiApiAdapters({
      version: InstallationVersion,
      tuiConfig,
      dialog,
      keymap,
      kv,
      route,
      routes: pluginRuntime.routes,
      event,
      sdk,
      sync,
      theme: themeState,
      toast,
      renderer,
      attention,
      Slot: pluginRuntime.Slot,
    }),
  )
  const [ready, setReady] = createSignal(false)
  props.pluginHost
    .start({
      api,
      config: tuiConfig,
      runtime: pluginRuntime,
      dispose: () => attention.dispose(),
    })
    .catch((error) => {
      console.error("Failed to load TUI plugins", error)
    })
    .finally(() => {
      setReady(true)
    })

  // Let selection copy/dismiss win ahead of normal bindings when explicit copy is required.
  // 注：flag 语义为"实验性禁用选择复制"——仅当用户显式设置时才跳过；默认启用。
  const offSelectionKeys = keymap.intercept(
    "key",
    ({ event }) => {
      if (Flag.GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
      Selection.handleSelectionKey(renderer, toast, event, clipboard)
    },
    { priority: 1 },
  )
  onCleanup(() => {
    offSelectionKeys()
    attention.dispose()
  })

  // Wire up console copy-to-clipboard via opentui's onCopySelection callback
  renderer.console.onCopySelection = async (text: string) => {
    if (!text || text.length === 0) return

    await clipboard
      .write?.(text)
      .then(() => toast.show({ message: "已复制到剪贴板", variant: "info" }))
      .catch(toast.error)

    renderer.clearSelection()
  }
  const [terminalTitleEnabled, setTerminalTitleEnabled] = createSignal(kv.get("terminal_title_enabled", true))
  const [pasteSummaryEnabled, setPasteSummaryEnabled] = createSignal(
    kv.get("paste_summary_enabled", !sync.data.config.experimental?.disable_paste_summary),
  )

  // Update terminal window title based on current route and session
  createEffect(() => {
    if (!terminalTitleEnabled() || Flag.GYCCODE_DISABLE_TERMINAL_TITLE) return

    if (route.data.type === "home") {
      renderer.setTerminalTitle("GycCode")
      return
    }

    if (route.data.type === "session") {
      const session = sync.session.get(route.data.sessionID)
      if (!session || isDefaultTitle(session.title)) {
        renderer.setTerminalTitle("GycCode")
        return
      }

      const title = session.title.length > 40 ? session.title.slice(0, 37) + "..." : session.title
      renderer.setTerminalTitle(`GycCode | ${title}`)
      return
    }

    if (route.data.type === "plugin") {
      renderer.setTerminalTitle(`GycCode | ${route.data.id}`)
    }
  })

  const args = useArgs()
  onMount(() => {
    batch(() => {
      if (args.agent) local.agent.set(args.agent)
      if (args.model) {
        const { providerID, modelID } = Model.parse(args.model)
        if (!providerID || !modelID)
          return toast.show({
            variant: "warning",
            message: `无效的模型格式: ${args.model}`,
            duration: 3000,
          })
        local.model.set({ providerID, modelID }, { recent: true })
      }
      if (args.sessionID && !args.fork) {
        route.navigate({
          type: "session",
          sessionID: args.sessionID,
        })
      }
    })
  })

  let continued = false
  createEffect(() => {
    // When using -c, session list is loaded in blocking phase, so we can navigate at "partial"
    if (continued || sync.status === "loading" || !args.continue) return
    const match = sync.data.session
      .toSorted((a, b) => b.time.updated - a.time.updated)
      .find((x) => x.parentID === undefined)?.id
    if (match) {
      continued = true
      if (args.fork) {
        void sdk.client.session.fork({ sessionID: match }).then((result) => {
          if (result.data?.id) {
            route.navigate({ type: "session", sessionID: result.data.id })
          } else {
            toast.show({ message: "会话分叉失败", variant: "error" })
          }
        })
      } else {
        route.navigate({ type: "session", sessionID: match })
      }
    }
  })

  // Handle --session with --fork: wait for sync to be fully complete before forking
  // (session list loads in non-blocking phase for --session, so we must wait for "complete"
  // to avoid a race where reconcile overwrites the newly forked session)
  let forked = false
  createEffect(() => {
    if (forked || sync.status !== "complete" || !args.sessionID || !args.fork) return
    forked = true
    void sdk.client.session.fork({ sessionID: args.sessionID }).then((result) => {
      if (result.data?.id) {
        route.navigate({ type: "session", sessionID: result.data.id })
      } else {
        toast.show({ message: "会话分叉失败", variant: "error" })
      }
    })
  })

  createEffect(
    on(
      () => sync.status === "complete" && sync.data.provider.length === 0,
      (isEmpty, wasEmpty) => {
        // only trigger when we transition into an empty-provider state
        if (!isEmpty || wasEmpty) return
        dialog.replace(() => <DialogProviderList />)
      },
    ),
  )

  const connected = useConnected()
  const currentWorktreeWorkspace = createMemo(() => {
    const workspaceID = project.workspace.current()
    if (!workspaceID) return
    const workspace = project.workspace.get(workspaceID)
    if (workspace?.type !== "worktree" || !workspace.directory) return
    return workspace
  })
  const appCommands = createMemo(() =>
    [
      {
        name: COMMAND_PALETTE_COMMAND,
        title: "显示命令面板",
        category: "系统",
        hidden: true,
        run: () => {
          dialog.replace(() => <CommandPaletteDialog />)
        },
      },
      {
        name: "session.list",
        title: "切换会话",
        category: "会话",
        suggested: sync.data.session.length > 0,
        slashName: "sessions",
        slashAliases: ["resume", "continue"],
        run: () => {
          dialog.replace(() => <DialogSessionList />)
        },
      },
      {
        name: "session.new",
        title: "新建会话",
        suggested: route.data.type === "session",
        category: "会话",
        slashName: "new",
        slashAliases: ["clear"],
        run: () => {
          route.navigate({
            type: "home",
          })
          dialog.clear()
        },
      },
      {
        name: "workspace.copy_path",
        title: "复制工作树路径",
        category: "工作区",
        enabled: () => currentWorktreeWorkspace() !== undefined,
        run: async () => {
          const workspace = currentWorktreeWorkspace()
          if (!workspace?.directory) return
          await clipboard
            .write?.(workspace.directory)
            .then(() => toast.show({ message: "已复制工作树路径", variant: "info" }))
            .catch(toast.error)
          dialog.clear()
        },
      },
      {
        name: "workspace.list",
        title: "管理工作区",
        category: "工作区",
        hidden: !Flag.GYCCODE_EXPERIMENTAL_WORKSPACES,
        slashName: "workspaces",
        run: () => {
          dialog.replace(() => <DialogWorkspaceList />)
        },
      },
      ...Array.from({ length: 9 }, (_, i) => ({
        name: `session.quick_switch.${i + 1}`,
        title: `切换到快捷槽 ${i + 1} 中的会话`,
        category: "会话",
        hidden: true,
        run: () => {
          local.session.quickSwitch(i + 1)
        },
      })),
      {
        name: "model.list",
        title: "切换模型",
        suggested: true,
        category: "代理",
        slashName: "models",
        // Bias /mo toward /models over /move without changing global fuzzy scoring.
        slashAliases: ["mo"],
        run: () => {
          dialog.replace(() => <DialogModel />)
        },
      },
      {
        name: "model.cycle_recent",
        title: "循环切换模型",
        category: "代理",
        hidden: true,
        run: () => {
          local.model.cycle(1)
        },
      },
      {
        name: "model.cycle_recent_reverse",
        title: "反序循环切换模型",
        category: "代理",
        hidden: true,
        run: () => {
          local.model.cycle(-1)
        },
      },
      {
        name: "model.cycle_favorite",
        title: "循环切换收藏",
        category: "代理",
        hidden: true,
        run: () => {
          local.model.cycleFavorite(1)
        },
      },
      {
        name: "model.cycle_favorite_reverse",
        title: "反序循环切换收藏",
        category: "代理",
        hidden: true,
        run: () => {
          local.model.cycleFavorite(-1)
        },
      },
      {
        name: "agent.list",
        title: "切换代理",
        category: "代理",
        slashName: "agents",
        run: () => {
          dialog.replace(() => <DialogAgent />)
        },
      },
      {
        name: "mcp.list",
        title: "启用/停用 MCP",
        category: "代理",
        slashName: "mcps",
        run: () => {
          dialog.replace(() => <DialogMcp />)
        },
      },
      {
        name: "agent.cycle",
        title: "循环切换代理",
        category: "代理",
        hidden: true,
        run: () => {
          local.agent.move(1)
        },
      },
      {
        name: "variant.cycle",
        title: "循环切换变体",
        category: "代理",
        run: () => {
          local.model.variant.cycle()
        },
      },
      {
        name: "variant.list",
        title: "切换模型变体",
        category: "代理",
        hidden: local.model.variant.list().length === 0,
        slashName: "variants",
        run: () => {
          if (local.model.variant.list().length === 0) {
            return toast.show({
              title: "没有可用的变体",
              message: "当前模型不支持任何变体。",
              variant: "info",
            })
          }
          dialog.replace(() => <DialogVariant />)
        },
      },
      {
        name: "agent.cycle.reverse",
        title: "反序循环切换代理",
        category: "代理",
        hidden: true,
        run: () => {
          local.agent.move(-1)
        },
      },
      {
        name: "provider.connect",
        title: "连接服务商",
        suggested: !connected(),
        slashName: "connect",
        run: () => {
          dialog.replace(() => <DialogProviderList />)
        },
        category: "服务商",
      },
      ...(sync.data.console_state.switchableOrgCount > 1
        ? [
            {
              name: "console.org.switch",
              title: "切换组织",
              suggested: Boolean(sync.data.console_state.activeOrgName),
              slashName: "org",
              slashAliases: ["orgs", "switch-org"],
              run: () => {
                dialog.replace(() => <DialogConsoleOrg />)
              },
              category: "服务商",
            },
          ]
        : []),
      {
        name: "gyccode.status",
        title: "查看状态",
        slashName: "status",
        run: () => {
          dialog.replace(() => <DialogStatus />)
        },
        category: "系统",
      },
      {
        name: "gyccode.debug",
        title: "查看调试信息",
        slashName: "debug",
        run: () => {
          dialog.replace(() => <DialogDebug />)
        },
        category: "系统",
      },
      {
        name: "theme.switch",
        title: "切换主题",
        slashName: "themes",
        run: () => {
          dialog.replace(() => <DialogThemeList />)
        },
        category: "系统",
      },
      {
        name: "theme.switch_mode",
        title: mode() === "dark" ? "切换到浅色模式" : "切换到深色模式",
        run: () => {
          setMode(mode() === "dark" ? "light" : "dark")
          dialog.clear()
        },
        category: "系统",
      },
      {
        name: "theme.mode.lock",
        title: locked() ? "解锁主题模式" : "锁定主题模式",
        run: () => {
          if (locked()) unlock()
          else lock()
          dialog.clear()
        },
        category: "系统",
      },
      {
        name: "help.show",
        title: "帮助",
        slashName: "help",
        run: () => {
          dialog.replace(() => <DialogHelp />)
        },
        category: "系统",
      },
      {
        name: "app.exit",
        title: "退出应用",
        slashName: "exit",
        slashAliases: ["quit", "q"],
        run: () => exit(),
        category: "系统",
      },
      {
        name: "app.debug",
        title: "切换调试面板",
        category: "系统",
        run: () => {
          renderer.toggleDebugOverlay()
          dialog.clear()
        },
      },
      {
        name: "app.console",
        title: "切换控制台",
        category: "系统",
        run: () => {
          renderer.console.toggle()
          dialog.clear()
        },
      },
      {
        name: "app.heap_snapshot",
        title: "写入堆快照",
        category: "系统",
        run: async () => {
          const files = await props.onSnapshot?.()
          toast.show({
            variant: "info",
            message: `Heap snapshot written to ${files?.join(", ")}`,
            duration: 5000,
          })
          dialog.clear()
        },
      },
      {
        name: "terminal.suspend",
        title: "挂起终端",
        category: "系统",
        hidden: true,
        enabled: process.platform !== "win32",
        run: () => {
          renderer.suspend()
          process.once("SIGCONT", () => renderer.resume())
          process.kill(0, "SIGTSTP")
        },
      },
      {
        name: "terminal.title.toggle",
        title: terminalTitleEnabled() ? "关闭终端标题" : "开启终端标题",
        category: "系统",
        run: () => {
          setTerminalTitleEnabled((prev) => {
            const next = !prev
            kv.set("terminal_title_enabled", next)
            if (!next) renderer.setTerminalTitle("")
            return next
          })
          dialog.clear()
        },
      },
      {
        name: "app.toggle.animations",
        title: kv.get("animations_enabled", false) ? "关闭动画" : "开启动画",
        category: "系统",
        run: () => {
          kv.set("animations_enabled", !kv.get("animations_enabled", false))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.file_context",
        title: kv.get("file_context_enabled", true) ? "关闭文件上下文" : "开启文件上下文",
        category: "系统",
        run: () => {
          kv.set("file_context_enabled", !kv.get("file_context_enabled", true))
          dialog.clear()
        },
      },
      {
        name: "app.toggle.diffwrap",
        title: kv.get("diff_wrap_mode", "word") === "word" ? "关闭差异换行" : "开启差异换行",
        category: "系统",
        run: () => {
          const current = kv.get("diff_wrap_mode", "word")
          kv.set("diff_wrap_mode", current === "word" ? "none" : "word")
          dialog.clear()
        },
      },
      {
        name: "app.toggle.paste_summary",
        title: pasteSummaryEnabled() ? "关闭粘贴摘要" : "开启粘贴摘要",
        category: "系统",
        run: () => {
          setPasteSummaryEnabled((prev) => {
            const next = !prev
            kv.set("paste_summary_enabled", next)
            return next
          })
          dialog.clear()
        },
      },
      {
        name: "app.toggle.session_directory_filter",
        title: kv.get("session_directory_filter_enabled", true)
          ? "关闭会话目录筛选"
          : "开启会话目录筛选",
        category: "系统",
        run: async () => {
          kv.set("session_directory_filter_enabled", !kv.get("session_directory_filter_enabled", true))
          await sync.session.refresh()
          dialog.clear()
        },
      },
      {
        name: "permission.mode",
        title:
          local.permission.mode === "auto" ? "关闭自动批准权限" : "开启自动批准权限",
        category: "系统",
        run: () => {
          local.permission.toggle()
          dialog.clear()
        },
      },
      {
        name: "gyccode.doctor",
        title: "环境诊断",
        category: "系统",
        slashName: "doctor",
        run: () => {
          dialog.replace(() => <DialogDoctor />)
        },
      },
      {
        name: "gyccode.config",
        title: "查看配置",
        category: "系统",
        slashName: "config",
        run: () => {
          dialog.replace(() => <DialogConfig />)
        },
      },
      {
        name: "gyccode.usage",
        title: "查看额度使用",
        category: "系统",
        slashName: "usage",
        run: () => {
          dialog.replace(() => <DialogUsage />)
        },
      },
      {
        name: "gyccode.permissions",
        title: "权限管理",
        category: "系统",
        slashName: "permissions",
        slashAliases: ["perms"],
        run: () => {
          dialog.replace(() => <DialogPermissions />)
        },
      },
      {
        name: "gyccode.vim",
        title: "切换 Vim 模式",
        category: "系统",
        slashName: "vim",
        run: () => {
          dialog.replace(() => <DialogVim />)
        },
      },
      {
        name: "gyccode.login",
        title: "账号登录",
        category: "账号",
        slashName: "login",
        run: () => {
          dialog.replace(() => <DialogLogin />)
        },
      },
      {
        name: "gyccode.logout",
        title: "账号登出",
        category: "账号",
        slashName: "logout",
        run: () => {
          dialog.replace(() => <DialogLogout />)
        },
      },
      {
        name: "gyccode.hooks",
        title: "查看 Hooks",
        category: "系统",
        slashName: "hooks",
        run: () => {
          dialog.replace(() => <DialogHooks />)
        },
      },
      {
        name: "gyccode.commit",
        title: "Git 提交状态",
        category: "Git",
        slashName: "commit",
        run: () => {
          dialog.replace(() => <DialogCommit />)
        },
      },
      {
        name: "gyccode.memory",
        title: "查看跨会话记忆",
        category: "系统",
        slashName: "memory",
        slashAliases: ["mem"],
        run: () => {
          dialog.replace(() => <DialogMemory />)
        },
      },
      {
        name: "gyccode.upgrade",
        title: "版本升级",
        category: "系统",
        slashName: "upgrade",
        run: () => {
          dialog.replace(() => <DialogUpgrade />)
        },
      },
      {
        name: "gyccode.release_notes",
        title: "更新日志",
        category: "系统",
        slashName: "release-notes",
        slashAliases: ["changelog"],
        run: () => {
          dialog.replace(() => <DialogReleaseNotes />)
        },
      },
      {
        name: "gyccode.feedback",
        title: "提交反馈",
        category: "系统",
        slashName: "feedback",
        run: () => {
          dialog.replace(() => <DialogFeedback />)
        },
      },
    ].map((command) => ({
      namespace: "palette",
      ...command,
    })),
  )

  useBindings(() => ({
    commands: appCommands(),
  }))

  useBindings(() => ({
    mode: GYCCODE_BASE_MODE,
    bindings: tuiConfig.keybinds.gather("app", appBindingCommands),
  }))

  useBindings(() => ({
    bindings: tuiConfig.keybinds.gather("app.global", appGlobalBindingCommands),
  }))

  useBindings(() => ({
    mode: GYCCODE_BASE_MODE,
    enabled: () => {
      const current = promptRef.current
      if (!current?.focused) return true
      return current.current.input === ""
    },
    bindings: tuiConfig.keybinds.gather("app_exit", ["app.exit"]),
  }))

  event.on("tui.command.execute", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    keymap.dispatchCommand(evt.properties.command)
  })

  event.on("tui.toast.show", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    toast.show({
      title: evt.properties.title,
      message: evt.properties.message,
      variant: evt.properties.variant,
      duration: evt.properties.duration,
    })
  })

  event.on("tui.session.select", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    route.navigate({
      type: "session",
      sessionID: evt.properties.sessionID,
    })
  })

  event.on("session.deleted", (evt) => {
    if (route.data.type === "session" && route.data.sessionID === evt.properties.info.id) {
      route.navigate({ type: "home" })
      toast.show({
        variant: "info",
        message: "当前会话已被删除",
      })
    }
  })

  event.on("session.error", (evt, { workspace }) => {
    if (workspace !== project.workspace.current()) return
    const error = evt.properties.error
    if (error && typeof error === "object" && error.name === "MessageAbortedError") return
    const message = errorMessage(error)

    toast.show({
      variant: "error",
      message,
      duration: 5000,
    })
  })

  event.on("installation.update-available", async (evt) => {
    console.log("installation.update-available", evt)
    const version = evt.properties.version

    const skipped = kv.get("skipped_version")
    if (skipped && !isVersionGreater(version, skipped)) return

    const choice = await DialogConfirm.show(
      dialog,
      `Update Available`,
      `A new release v${version} is available. Would you like to update now?`,
      "skip",
    )

    if (choice === false) {
      kv.set("skipped_version", version)
      return
    }

    if (choice !== true) return

    toast.show({
      variant: "info",
      message: `Updating to v${version}...`,
      duration: 30000,
    })

    const result = await sdk.client.global.upgrade({ target: version })

    if (result.error || !result.data?.success) {
      toast.show({
        variant: "error",
        title: "更新失败",
        message: "更新失败",
        duration: 10000,
      })
      return
    }

    await DialogAlert.show(
      dialog,
      "Update Complete",
      `Successfully updated to GycCode v${result.data.version}. Please restart the application.`,
    )

    void exit()
  })

  const plugin = createMemo(() => {
    if (!ready()) return
    if (route.data.type !== "plugin") return
    const render = pluginRuntime.routes.get(route.data.id)
    if (!render) return <PluginRouteMissing id={route.data.id} onHome={() => route.navigate({ type: "home" })} />
    return render({ params: route.data.data })
  })

  return (
    <box
      width={dimensions().width}
      height={dimensions().height}
      flexDirection="column"
      backgroundColor={theme.background}
      onMouseDown={(evt) => {
        if (!Flag.GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT) return
        if (evt.button !== MouseButton.RIGHT) return

        if (!Selection.copy(renderer, toast, clipboard)) return
        evt.preventDefault()
        evt.stopPropagation()
      }}
      onMouseUp={
        !Flag.GYCCODE_EXPERIMENTAL_DISABLE_COPY_ON_SELECT
          ? () => Selection.copy(renderer, toast, clipboard)
          : undefined
      }
    >
      <Show when={Flag.GYCCODE_SHOW_TTFD}>
        <TimeToFirstDraw />
      </Show>
      <Show when={ready()}>
        <box flexGrow={1} minHeight={0} flexDirection="column">
          <Switch>
            <Match when={route.data.type === "home"}>
              <Home />
            </Match>
            <Match when={route.data.type === "session"}>
              <Show when={route.data.type === "session" ? route.data.sessionID : undefined} keyed>
                {(_) => <Session />}
              </Show>
            </Match>
          </Switch>
          {plugin()}
        </box>
        <box flexShrink={0}>
          <pluginRuntime.Slot name="app_bottom" />
        </box>
        <pluginRuntime.Slot name="app" />
      </Show>
      <Show when={!startup.skipInitialLoading}>
        <StartupLoading ready={ready} />
      </Show>
    </box>
  )
}
