import { Server } from "@/server/server"
import { InstanceRuntime } from "@/project/instance-runtime"
import { Rpc } from "@/util/rpc"
import { upgrade } from "@/cli/upgrade"
import { Config } from "@/config/config"
import { GlobalBus } from "@/bus/global"
import { ServerAuth } from "@/server/auth"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { AppRuntime } from "@/effect/app-runtime"
import { Effect } from "effect"
import { disposeAllInstancesAndEmitGlobalDisposed } from "@/server/global-lifecycle"
import { Global } from "@gyccode/core/global"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import { tuiTiming } from "@gyccode/tui/util/timing"

Heap.start()

// 原实现是空函数，静默吞掉所有未捕获异常，形成诊断黑洞。现在至少写入
// gyccode.log（绝不写 stdout/stderr，避免污染 TUI 渲染），进程存活语义
// 不变。5 秒节流防异常风暴刷盘——与 logging.ts 的 WARN 节流策略一致。
const logWorkerCrash = (() => {
  let last = 0
  return (kind: string, error: unknown) => {
    const now = Date.now()
    if (now - last < 5_000) return
    last = now
    const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error)
    void mkdir(Global.Path.log, { recursive: true })
      .then(() =>
        appendFile(
          path.join(Global.Path.log, "gyccode.log"),
          `timestamp=${new Date().toISOString()} level=Error run=worker ${kind} message=${detail}\n`,
        ),
      )
      .catch(() => {})
  }
})()

const onUnhandledRejection = (error: unknown) => logWorkerCrash("unhandledRejection", error)

const onUncaughtException = (error: Error) => logWorkerCrash("uncaughtException", error)

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
GlobalBus.on("event", (event) => {
  Rpc.emit("global.event", event)
})

let server: Awaited<ReturnType<typeof Server.listen>> | undefined

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    if (firstFetch) {
      firstFetch = false
      tuiTiming("worker first fetch (instance cold path)")
    }
    const headers = { ...input.headers }
    const auth = ServerAuth.header()
    if (auth && !headers["authorization"] && !headers["Authorization"]) {
      headers["Authorization"] = auth
    }
    const request = new Request(input.url, {
      method: input.method,
      headers,
      body: input.body,
    })
    const response = await Server.Default().app.fetch(request)
    const body = await response.text()
    return {
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    }
  },
  snapshot() {
    const result = writeHeapSnapshot("server.heapsnapshot")
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }) {
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await InstanceRuntime.load({ directory: input.directory })
    await upgrade().catch(() => {})
  },
  async reload() {
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    await InstanceRuntime.disposeAllInstances()
    if (server) await server.stop(true)
    process.off("unhandledRejection", onUnhandledRejection)
    process.off("uncaughtException", onUncaughtException)
  },
}

tuiTiming("worker module evaluated")

let firstFetch = true

Rpc.listen(rpc)
tuiTiming("worker rpc listening")

// 预热 instance：不等首个 API 进来就开始 config/provider/agent 初始化。
// InstanceStore.load 对同 directory 幂等（并发调用复用同一 Deferred），
// 因此这里与后续 rpc.fetch 触发的 load 天然去重。预热与主线程的渲染器
// 初始化并行执行，缩短首屏模式栏（plan/build/compose）出现时间。
void InstanceRuntime.load({ directory: process.cwd() })
  .then(() => tuiTiming("instance warm (APIs ready)"))
  .catch(() => {})
