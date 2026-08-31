import { readStdin } from "../../../core/util/read-stdin"
import { cmd } from "@/cli/cmd/cmd"
import { Rpc } from "@/util/rpc"
import { type rpc } from "../tui/worker"
import path from "path"
import { fileURLToPath } from "url"
import { UI } from "@/cli/ui"
import { errorMessage } from "@gyccode/tui/util/error"
import { withNetworkOptions, resolveNetworkOptionsNoConfig, hasArg } from "@/cli/network"
import { Filesystem } from "@/util/filesystem"
import type { GlobalEvent } from "@gyccode/protocol/v2"
import type { EventSource } from "@gyccode/tui/context/sdk"
import { writeHeapSnapshot } from "v8"
import { win32InstallCtrlCGuard } from "@gyccode/tui/terminal-win32"
import { tuiTiming } from "@gyccode/tui/util/timing"
import { createWorkerPool } from "../tui/worker-pool"

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
      // worker 池（重启链/空闲卸载/堆预算/优雅关闭）封装在 cli/tui/worker-pool.ts。
      const network = resolveNetworkOptionsNoConfig(args)
      const external = hasArg("--port") || hasArg("--hostname") || network.mdns === true
      const pool = createWorkerPool({ file, external })
      const ensureWorker = pool.ensure
      // 立即预热：与主进程的 TuiConfig/网络选项准备并行（不等到首请求才冷启）。
      const client = ensureWorker()
      tuiTiming("worker created")
      // 等待 worker RPC 监听就绪，避免主进程过早发起请求导致竞态。
      // 超时保护（2026-08-27 紧急修复）：worker 启动失败/重启窗口时
      // client 为空，无超时则无限轮询——TUI 永久黑屏卡死的主嫌疑根因。
      await new Promise<void>((resolve) => {
        const deadline = Date.now() + 15_000
        const checkReady = () => {
          if (client.pendingCount() === 0 || Date.now() > deadline) {
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
        process.off("SIGUSR2", reload)
        await pool.stop()
      }
    } finally {
      try {
        unguard?.()
      } catch {
        // 进程即将退出，Ctrl+C 守卫移除失败可忽略
      }
    }
    process.exit(0)
  },
})