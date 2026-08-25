import { Rpc } from "@/util/rpc"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "@/cli/heap"
import { Effect } from "effect"
import { Global } from "@gyccode/core/global"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { tuiTiming } from "@gyccode/tui/util/timing"
import { GlobalBus } from "@/bus/global"
import type { Listener } from "@/server/server"

// 尽早关闭 ai-sdk 警告（原 Server 模块顶层设置，改为懒加载后此处前置兜底，
// 避免加载前 ai-sdk 向 stdout 打日志污染 TUI 渲染）。
// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout
globalThis.AI_SDK_LOG_WARNINGS = false

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

let server: Listener | undefined

// 懒加载模块缓存：按需动态 import，避免 worker 启动即加载 server/instance/effect
// 全家桶，显著降低常驻内存（低内存机器实测 worker+主进程可省数百 MB）。
// 一旦加载即缓存，后续同步返回，不重复开销。
const modCache = new Map<string, Promise<unknown>>()
function importMod<T>(spec: string): Promise<T> {
  let p = modCache.get(spec)
  if (!p) {
    p = import(spec).then(
      (m) => m as T,
      (error) => {
        modCache.delete(spec)
        throw error
      },
    )
    modCache.set(spec, p)
  }
  return p as Promise<T>
}

let instanceWarmed = false
async function ensureWarmInstance() {
  if (instanceWarmed) return
  const { InstanceRuntime } = await importMod<typeof import("@/project/instance-runtime")>(
    "@/project/instance-runtime",
  )
  await InstanceRuntime.load({ directory: process.cwd() })
  instanceWarmed = true
}

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }) {
    if (firstFetch) {
      firstFetch = false
      tuiTiming("worker first fetch (instance cold path)")
    }
    // 低内存机器顶层跳过预热，首次请求在此补载 instance；正常机器此处幂等快速返回。
    await ensureWarmInstance()
    const { Server } = await importMod<typeof import("@/server/server")>("@/server/server")
    const { ServerAuth } = await importMod<typeof import("@/server/auth")>("@/server/auth")
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
    const { Server } = await importMod<typeof import("@/server/server")>("@/server/server")
    if (server) await server.stop(true)
    server = await Server.listen(input)
    return { url: server.url.toString() }
  },
  async checkUpgrade(input: { directory: string }) {
    await ensureWarmInstance()
    const { upgrade } = await importMod<typeof import("@/cli/upgrade")>("@/cli/upgrade")
    await upgrade().catch(() => {})
  },
  async reload() {
    const { AppRuntime } = await importMod<typeof import("@/effect/app-runtime")>("@/effect/app-runtime")
    const { Config } = await importMod<typeof import("@/config/config")>("@/config/config")
    const { disposeAllInstancesAndEmitGlobalDisposed } = await importMod<
      typeof import("@/server/global-lifecycle")
    >("@/server/global-lifecycle")
    await AppRuntime.runPromise(
      Effect.gen(function* () {
        const cfg = yield* Config.Service
        yield* cfg.invalidate()
        yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
      }),
    )
  },
  async shutdown() {
    const { InstanceRuntime } = await importMod<typeof import("@/project/instance-runtime")>(
      "@/project/instance-runtime",
    )
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
// 低内存机器（free < 1.5GB，如 3.9GB 宿主机）跳过预热：worker 常驻内存
// 显著下降，instance 改为首次 rpc.fetch 时惰性加载，避免 V8 OOM 崩溃。
const LOW_MEM_PREWARM_CUTOFF = 1536 * 1024 * 1024
if (os.freemem() > LOW_MEM_PREWARM_CUTOFF) {
  void ensureWarmInstance()
    .then(() => tuiTiming("instance warm (APIs ready)"))
    .catch(() => {})
}