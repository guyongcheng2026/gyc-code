import { readStdin } from "../../../core/util/read-stdin"
import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@gyccode/tui/util/error"
import { withTimeout } from "@/util/timeout"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@gyccode/protocol/v2"
import type { EventSource } from "@gyccode/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { win32InstallCtrlCGuard } from "@gyccode/tui/terminal-win32"
import { tuiTiming } from "@gyccode/tui/util/timing"
import { Worker } from "node:worker_threads"
import { appendFile, mkdir } from "node:fs/promises"
import os from "node:os"
import { Global } from "@gyccode/core/global"

declare global {
  const GYCCODE_WORKER_PATH: string
}

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

function createWorkerFetch(client: () => RpcClient): typeof fetch {
  const fn = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init)
    const body = request.body ? await request.text() : undefined
    const result = await client().call("fetch", {
      url: request.url,
      method: request.method,
      headers: Object.fromEntries(request.headers.entries()),
      body,
    })
    return new Response(result.body, {
      status: result.status,
      headers: result.headers,
    })
  }
  return fn as typeof fetch
}

function createEventSource(client: () => RpcClient): EventSource {
  return {
    subscribe: async (handler) => {
      return client().on<GlobalEvent>("global.event", (e) => {
        handler(e)
      })
    },
  }
}

async function target() {
  if (typeof GYCCODE_WORKER_PATH !== "undefined") return GYCCODE_WORKER_PATH
  const dist = new URL("./cli/tui/worker.js", import.meta.url)
  if (await Filesystem.exists(fileURLToPath(dist))) return dist
  return new URL("../tui/worker.ts", import.meta.url)
}

async function input(value?: string) {
  const piped = process.stdin.isTTY ? undefined : await readStdin()
  if (!value) return piped
  if (!piped) return value
  return piped + "\n" + value
}

export function resolveThreadDirectory(project?: string, envPWD = process.env.PWD, cwd = process.cwd()) {
  const root = Filesystem.resolve(envPWD ?? cwd)
  if (project) return Filesystem.resolve(path.isAbsolute(project) ? project : path.join(root, project))
  return Filesystem.resolve(cwd)
}

export const TuiThreadCommand = cmd({
  command: "tui [project]",
  describe: "start gyc tui (full-screen interface)",
  builder: (yargs) =>
    withNetworkOptions(yargs)
      .positional("project", {
        type: "string",
        describe: "path to start gyc in",
      })
      .option("model", {
        type: "string",
        alias: ["m"],
        describe: "model to use in the format of provider/model",
      })
      .option("continue", {
        alias: ["c"],
        describe: "continue the last session",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "session id to continue",
      })
      .option("fork", {
        type: "boolean",
        describe: "fork the session when continuing (use with --continue or --session)",
      })
      .option("prompt", {
        type: "string",
        describe: "prompt to use",
      })
      .option("agent", {
        type: "string",
        describe: "agent to use",
      })
      .option("auto", {
        type: "boolean",
        describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
        default: false,
      })
      .option("yolo", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("dangerously-skip-permissions", {
        type: "boolean",
        hidden: true,
        default: false,
      }),
  handler: async (args) => {
    tuiTiming("cmd.tui handler enter")
    const unguard = win32InstallCtrlCGuard()
    try {
      if (args.fork && !args.continue && !args.session) {
        UI.error("--fork requires --continue or --session")
        process.exitCode = 1
        return
      }

      // Resolve relative --project paths from PWD, then use the real cwd after
      // chdir so the thread and worker share the same directory key.
      const next = resolveThreadDirectory(args.project)
      const file = await target()
      try {
        process.chdir(next)
      } catch {
        UI.error("Failed to change directory to " + next)
        return
      }
      const cwd = Filesystem.resolve(process.cwd())

      // TUI 渲染在 Node 主线程（OpenTUI 的 koffi 支持 Node），server 在
      // node:worker_threads 里运行，Rpc 做双通道桥接（替代 Bun Web Worker）。
      // 尽早创建 worker：其模块图求值（effect/server 全家桶，实测 ~2.6s）
      // 与主进程的 TuiConfig/网络选项准备并行，是启动耗时的大头。
      //
      // resourceLimits（根治 FatalOOM 崩溃）：worker isolate 无限制时继承主进程
      // --max-old-space-size，双 isolate 各自可涨到该值，加上 OpenTUI 原生内存，
      // 在 ~4GB 机器上 V8 C++ 层（TurboFan 编译器/地址空间分配）先于 JS 堆守
      // 护耗尽内存，触发不可捕获的 FatalOOM abort（运行几分钟即崩）。设置
      // resourceLimits 后 worker 堆超限在 worker 内抛可捕获的 RangeError，
      // worker.ts 检测后主动退出，这里自动重启自愈。
      const workerHeapLimits = () => {
        const explicit = Number(process.env.GYC_WORKER_OLD_SPACE)
        if (Number.isFinite(explicit) && explicit > 0) {
          return { maxOldGenerationSizeMb: Math.round(explicit), maxYoungGenerationSizeMb: 64 }
        }
        const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
        // 2026-08-27 实测修正：4GB 机主进程常驻 ~800MB + worker 1024MB 预算，
        // 与系统合计超订物理内存 → Windows 页面交换 → 磁盘持续读写（发热/
        // 噪音主因）。worker 下调到 768MB：主+worker ≈1.6GB，为系统留出
        // ~2.4GB 余量；超限时走既有的 OOM exit(12) 自动重启链路自愈。
        const oldMb = totalMb <= 4096 ? 768 : totalMb <= 8192 ? 1536 : 2048
        return { maxOldGenerationSizeMb: oldMb, maxYoungGenerationSizeMb: 64 }
      }

      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true

      let currentWorker: Worker | undefined
      let currentClient: RpcClient | undefined
      let restarts = 0
      const MAX_WORKER_RESTARTS = 3
      // 空闲卸载（极致省内存）：无 RPC 活动持续 idleSec 后 terminate worker，
      // 常驻省 200-400MB（isolate 底噪 + effect/drizzle/ai-sdk 模块图 + instance
      // 状态）。下次请求经 ensureWorker 冷启（模块求值 ~2.6s，postMessage 在
      // worker 未就绪时由 node 缓冲，请求不丢失）。会话进行中流式 RPC 频繁，
      // 不会误卸。external 模式（--port 对外服务）禁用。
      // GYC_TUI_IDLE_UNLOAD_SEC 可调，0 = 禁用。默认 10 分钟。
      const IDLE_UNLOAD_SEC = Number(process.env.GYC_TUI_IDLE_UNLOAD_SEC ?? 600)
      let lastActiveAt = Date.now()
      const touchActive = () => {
        lastActiveAt = Date.now()
      }
      // worker 存活时直接返回 client；空闲卸载后（或崩溃重启窗口）按需重生。
      // 空闲唤醒不计入崩溃重启预算——正常唤醒与异常重启语义分离。
      const ensureWorker = (): RpcClient => {
        if (currentWorker && currentClient) return currentClient
        spawnWorker()
        return currentClient!
      }
      let stopped = false

      const spawnWorker = () => {
        const worker = new Worker(file, {
          env: Object.fromEntries(
            Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
          ),
          resourceLimits: workerHeapLimits(),
        })
        currentWorker = worker
        currentClient = Rpc.client<typeof rpc>(worker, { onActivity: touchActive })
        // worker 异常退出：记录日志并自动重启（指数退避），TUI 主进程保持存活。
        // 此前仅记录不重启，worker 阵亡后所有 RPC 永久失败，TUI 功能瘫痪。
        worker.on("exit", (code) => {
          if (code === 0 || stopped) return
          // 先 reject 挂起请求（Promise 挂在主进程，不 dispose 会永久悬挂），
          // 再置空引用：确保 ensureWorker 在重启延迟窗口内被调用时立即重生
          // worker（而非返回已死 client 的 postMessage 抛错）
          currentClient?.dispose(new Error(`worker exited with code ${code}`))
          currentWorker = undefined
          currentClient = undefined
          const delayMs = Math.min(2000 * 2 ** restarts, 8000)
          restarts += 1
          void mkdir(Global.Path.log, { recursive: true })
            .then(() =>
              appendFile(
                path.join(Global.Path.log, "gyccode.log"),
                `timestamp=${new Date().toISOString()} level=Error run=main worker-exit code=${code} restart=${restarts}/${MAX_WORKER_RESTARTS} delay=${delayMs}ms\n`,
              ),
            )
            // 写日志本身失败不能再抛，否则会掩盖 worker 退出原因
            .catch(() => {})
          if (restarts > MAX_WORKER_RESTARTS) return
          setTimeout(() => {
            if (stopped) return
            // ensureWorker 可能在延迟窗口内已抢先重生（有请求到达时立即重启
            // 优于定时重启），此时跳过，避免双 worker
            if (currentWorker) return
            try {
              spawnWorker()
            } catch (e) {
              // worker 重启失败必须留痕，否则 TUI 静默无响应且无任何线索
              console.error(`[tui] worker 重启失败：${String(e)}`)
            }
          }, delayMs).unref?.()
        })
        return worker
      }

      spawnWorker()
      tuiTiming("worker created")
      // 等待 worker RPC 监听就绪，避免主进程过早发起请求导致竞态。
      // 超时保护（2026-08-27 紧急修复）：worker 启动失败/重启窗口时
      // currentClient 为空，无超时则无限轮询——TUI 永久黑屏卡死的主嫌疑根因
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 15_000
        const checkReady = () => {
          if ((currentClient && currentClient.pendingCount() === 0) || Date.now() > deadline) {
            resolve()
            return
          }
          setTimeout(checkReady, 20)
        }
        checkReady()
      })
      tuiTiming("worker rpc ready")
      const reload = () => {
        // reload 失败需留痕，否则 SIGUSR2 触发后界面无变化且无从排查
        ensureWorker().call("reload", undefined).catch((e) => {
          console.error(`[tui] 重载失败：${String(e)}`)
        })
      }
      process.on("SIGUSR2", reload)

      // 空闲卸载巡检（每分钟）：pending 归零且超时才卸。摘除 exit 监听后
      // terminate——exit 走"正常退出"路径（code!==0 但无监听），不触发重启链。
      // external（--port/--hostname/--mdns 对外服务）模式下 worker 承载真实
      // HTTP server，卸载即断服，禁用。
      const idleTimer = IDLE_UNLOAD_SEC > 0
        ? setInterval(() => {
            if (stopped || !currentWorker || !currentClient) return
            if (external) return
            if (currentClient.pendingCount() > 0) return
            if (Date.now() - lastActiveAt < IDLE_UNLOAD_SEC * 1000) return
            const worker = currentWorker
            currentWorker = undefined
            currentClient.dispose(new Error("worker idle unloaded"))
            currentClient = undefined
            worker.removeAllListeners("exit")
            worker.terminate()
            void appendFile(
              path.join(Global.Path.log, "gyccode.log"),
              `timestamp=${new Date().toISOString()} level=Info run=main worker-idle-unloaded\n`,
            )
            // 写日志本身失败不能再抛，忽略
            .catch(() => {})
          }, 60_000)
        : undefined
      idleTimer?.unref?.()

      const stop = async () => {
        if (stopped) return
        stopped = true
        process.off("SIGUSR2", reload)
        if (idleTimer) clearInterval(idleTimer)
        if (currentWorker && currentClient) {
          // 优雅关闭超时/失败属预期（进程即将退出），忽略
          await withTimeout(currentClient.call("shutdown", undefined), 5000).catch(() => {})
        }
        currentWorker?.terminate()
      }
      const prompt = await input(args.prompt)
      tuiTiming("prompt resolved")
      // 骨架屏并行化：config 获取（模块加载 + 读取解析，实测 ~1.2s）提前 fire
      // 但不 await——与 worker 模块求值、effect/layer 加载并行；Promise 注入
      // TUI 后由首帧骨架屏过渡，配置到达再切换完整树。
      const configPromise = import("@/config/tui").then((m) => m.TuiConfig.get())

      // 懒加载：ServerAuth 仅 --port/--hostname/--mdns 对外暴露时需要，
      // 默认 internal RPC 传输不引入 server/auth 模块图。
      const headers = external ? (await import("@/server/auth")).ServerAuth.headers() : undefined

      const transport = external
        ? {
            url: (await ensureWorker().call("server", network)).url,
            fetch: undefined,
            events: undefined,
            headers,
          }
        : {
            url: "http://gyccode.internal",
            fetch: createWorkerFetch(ensureWorker),
            events: createEventSource(ensureWorker),
          }

      try {
        // 仅 --session 时才需要校验（validateSession 内部对无 sessionID 直接返回）。
        // 懒加载：避免把 @gyccode/protocol/v2 client 全量拉进默认 `gyc tui`
        // 的启动关键路径（主进程模块图实测可省数百毫秒）。
        if (args.session) {
          const { validateSession } = await import("../tui/validate-session")
          await validateSession({
            url: transport.url,
            sessionID: args.session,
            directory: cwd,
            fetch: transport.fetch,
            headers,
          })
        }
        tuiTiming("validateSession done")
      } catch (error) {
        UI.error(errorMessage(error))
        process.exitCode = 1
        return
      }

      setTimeout(() => {
        // 后台检查升级失败不影响当前会话，忽略
        ensureWorker().call("checkUpgrade", { directory: cwd }).catch(() => {})
      }, 1000).unref?.()

      try {
        const { Effect } = await import("effect")
        const { run } = await import("../tui/layer")
        const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
        tuiTiming("effect/layer/plugin-host imported")
        await Effect.runPromise(
          run({
            url: transport.url,
            async onSnapshot() {
              const tui = writeHeapSnapshot("tui.heapsnapshot")
              const server = await ensureWorker().call("snapshot", undefined)
              return [tui, server]
            },
            config: configPromise,
            pluginHost: createLegacyTuiPluginHost(),
            directory: cwd,
            fetch: transport.fetch,
            headers: transport.headers,
            events: transport.events,
            args: {
              continue: args.continue,
              sessionID: args.session,
              agent: args.agent,
              model: args.model,
              prompt,
              fork: args.fork,
              auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
            },
          }),
        )
      } finally {
        await stop()
      }
    } finally {
      try