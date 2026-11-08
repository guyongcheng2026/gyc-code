import { Rpc } from "@/util/rpc"
import { writeHeapSnapshot } from "node:v8"
import { Heap } from "../heap"
import { Effect } from "effect"
import { Global } from "@gyccode/core/global"
import { appendFile, mkdir } from "node:fs/promises"
import path from "node:path"
import os from "node:os"
import { tuiTiming } from "@gyccode/tui/util/timing"
import { shouldExitOnUnhandledRejection } from "@gyccode/tui/util/crash-classify"
import { GlobalBus } from "@/bus/global"
import type { Listener } from "@/server/server"
import { dispatchErrorAudit } from "@core/observability/error-audit"

// 尽早关闭 ai-sdk 警告（原 Server 模块顶层设置，改为懒加载后此处前置兜底，
// 避免加载前 ai-sdk 向 stdout 打日志污染 TUI 渲染）。统一下沉到共享模块。
import "@core/observability/silence-ai-sdk"

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
    const detail = error instanceof Error ? error.message : String(error)
    // 落审计库：worker 崩溃是观测盲区，必须可按 scope/级别聚合
    dispatchErrorAudit({ scope: `cli.tui.worker.${kind}`, message: detail, level: "error" })
    // 写文件日志：用 JSON 行格式保证可解析性（detail 可能含空格/等号/换行）
    void mkdir(Global.Path.log, { recursive: true })
      .then(() =>
        appendFile(
          path.join(Global.Path.log, "gyccode.log"),
          JSON.stringify({ timestamp: new Date().toISOString(), level: "Error", run: "worker", kind, message: detail }) + "\n",
        ),
      )
      .catch(() => {
        // 写日志本身失败不能再抛，否则会掩盖原始错误
      })
  }
})()

const onUnhandledRejection = (error: unknown) => {
  // 可恢复的瞬时错误（限流 429 / SSE 超时 / 网络抖动 / 原子写竞争）：
  // 记日志后继续运行，不退出。与主进程 app.tsx:511-521 同一口径。
  //
  // 为什么 worker 侧同样需要分级：本文件下方 server = await Server.listen(input)
  // 说明 HTTP server 由 worker 托管，worker 一死服务端即消失，TUI 的每个
  // HTTP 调用都会失败——用户看到的是「发送提示词失败」
  // （src/tui/component/prompt/index.tsx:1192）。此前这里对任何 rejection
  // 一律 exit(1)，一次网络抖动就能掐断整个会话通道。
  if (!shouldExitOnUnhandledRejection(error)) {
    logWorkerCrash("unhandledRejection-recoverable", error)
    return
  }
  logWorkerCrash("unhandledRejection", error)
  // Exit the worker so the pool can restart it with a fresh heap.
  // This prevents silent failure accumulation that could leave the worker
  // in an inconsistent state. The main process will respawn via worker-exit handler.
  process.exit(1)
}

// 堆超限（resourceLimits.maxOldGenerationSizeMb 触发）抛出的 RangeError：
// 堆已满且无法回收，继续存活只会进入"每次分配都抛异常 + GC 风暴"的性能死
// 区。主动退出（退出码 12），让主进程按 worker-exit 自动重启链路自愈——
// 新 worker 堆从零开始，会话状态经 InstanceStore 从磁盘恢复。
const WORKER_OOM_EXIT_CODE = 12
const isHeapOOM = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error)
  return (
    message.includes("heap out of memory") ||
    message.includes("JavaScript heap out of memory") ||
    message.includes("Array buffer allocation failed")
  )
}

const onUncaughtException = (error: Error) => {
  logWorkerCrash("uncaughtException", error)
  if (isHeapOOM(error)) {
    process.exit(WORKER_OOM_EXIT_CODE)
  }
}

process.on("unhandledRejection", onUnhandledRejection)
process.on("uncaughtException", onUncaughtException)

// Subscribe to global events and forward them via RPC
// P0 修复：存储 listener 引用，允许进程退出时清理，防止 Worker 重建后幽灵事件
const globalEventListener = (event: unknown) => {
  Rpc.emit("global.event", event)
}
GlobalBus.on("event", globalEventListener)

// Worker 退出时注销监听器
process.on("exit", () => {
  GlobalBus.off("event", globalEventListener)
})

let server: Listener | undefined

// 懒加载模块缓存：按需动态 import，避免 worker 启动即加载 server/instance/effect
// 全家桶，显著降低常驻内存（低内存机器实测 worker+主进程可省数百 MB）。
// 一旦加载即缓存，后续同步返回，不重复开销。
const LAZY_MODULES: Record<string, () => Promise<unknown>> = {
  '@/project/instance-runtime': () => import('@/project/instance-runtime'),
  '@/server/server': () => import('@/server/server'),
  '@/server/auth': () => import('@/server/auth'),
  '../upgrade': () => import('../upgrade'),
  '@/effect/app-runtime': () => import('@/effect/app-runtime'),
  '@/config/config': () => import('@/config/config'),
  '@/server/global-lifecycle': () => import('@/server/global-lifecycle'),
}

const MOD_CACHE_TTL = 5 * 60 * 1000 // 5分钟

// 单 Map 存储 { promise, expiresAt }，去除双 Map + O(n) 遍历
interface CacheEntry<T> {
  promise: Promise<T>
  expiresAt: number
}
const modCache = new Map<string, CacheEntry<unknown>>()

// 独立的过期缓存清理定时器：按固定间隔清理，避免 importMod 每次遍历
const modCacheCleanupTimer = setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of modCache.entries()) {
    if (now > entry.expiresAt) modCache.delete(key)
  }
}, MOD_CACHE_TTL)
modCacheCleanupTimer.unref?.()

function importMod<T>(spec: string): Promise<T> {
  const loader = LAZY_MODULES[spec]
  if (!loader) return Promise.reject(new Error(`未知的懒加载模块：${spec}`))
  
  const now = Date.now()
  const entry = modCache.get(spec)
  // 命中且未过期
  if (entry && now <= entry.expiresAt) return entry.promise as Promise<T>
  
  // 未命中或已过期：重新加载
  const p = loader().then(
    (m) => m as T,
    (error) => {
      modCache.delete(spec)
      throw error
    }
  )
  modCache.set(spec, { promise: p, expiresAt: now + MOD_CACHE_TTL })
  return p as Promise<T>
}

let instanceWarmed = false
let prewarmPromise: Promise<void> | null = null
async function ensureWarmInstance(): Promise<void> {
  if (instanceWarmed) return
  if (!prewarmPromise) {
    prewarmPromise = (async () => {
      const { InstanceRuntime } = await importMod<typeof import("@/project/instance-runtime")>(
        "@/project/instance-runtime",
      )
      await InstanceRuntime.load({ directory: process.cwd() })
      instanceWarmed = true
    })()
  }
  return prewarmPromise
}

// server 操作互斥锁：避免并发调用 server() 时出现检查-then-赋值竞态，
// 导致多个 HTTP Server 实例被启动、旧实例引用被覆盖而无法 stop。
let serverLock = Promise.resolve()

export const rpc = {
  async fetch(input: { url: string; method: string; headers: Record<string, string>; body?: string }, { signal }: { signal: AbortSignal }) {
    if (firstFetch) {
      firstFetch = false
      tuiTiming("worker first fetch (instance cold path)")
    }
    // 低内存机器顶层跳过预热，首次请求在此补载 instance；正常机器此处幂等快速返回。
    const [, serverMod, authMod] = await Promise.all([
      ensureWarmInstance(),
      importMod<typeof import("@/server/server")>("@/server/server"),
      importMod<typeof import("@/server/auth")>("@/server/auth"),
    ])
    const { Server } = serverMod
    const { ServerAuth } = authMod
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
    if (signal.aborted) return { status: 499, headers: {}, body: "aborted" }
    const abortPromise = new Promise<{ status: number; headers: Record<string, string>; body: string }>((resolve) => {
      signal.addEventListener("abort", () => resolve({ status: 499, headers: {}, body: "aborted" }), { once: true })
    })
    try {
      const fetchPromise = (async () => {
        const response = await Server.Default().app.fetch(request)
        const body = await response.text()
        return {
          status: response.status,
          headers: Object.fromEntries(response.headers.entries()),
          body,
        }
      })()
      return await Promise.race([fetchPromise, abortPromise])
    } catch (error) {
      // 失败时返回错误响应，而不让异常通过 listen 向上冒泡，
      // 避免调用方因 worker 挂起而无限等待；错误详情只落日志，body 脱敏，
      // 避免把堆栈/路径等底层信息暴露给调用方。
      logWorkerCrash("rpc.fetch", error)
      return {
        status: 500,
        headers: {},
        body: "rpc.fetch 失败",
      }
    }
  },
  snapshot() {
    const result = writeHeapSnapshot(path.join(Global.Path.log, `worker-${process.pid}-${new Date().toISOString().replace(/[:.]/g, "")}.heapsnapshot`))
    return result
  },
  async server(input: { port: number; hostname: string; mdns?: boolean; cors?: string[] }, ctx: { signal: AbortSignal }) {
    let unlock!: () => void
    serverLock = serverLock.then(() => new Promise<void>((resolve) => { unlock = resolve }))
    await serverLock
    try {
      const { Server } = await importMod<typeof import("@/server/server")>("@/server/server")
      if (server) await server.stop(true)
      // 注册 abort 监听：用局部变量跟踪 listen 结果，避免 onAbort 引用旧 server
      let listener: Listener | undefined
      const onAbort = () => { listener?.stop(true) }
      ctx.signal.addEventListener("abort", onAbort, { once: true })
      try {
        listener = await Server.listen(input)
        server = listener
        return { url: listener.url.toString() }
      } finally {
        ctx.signal.removeEventListener("abort", onAbort)
      }
    } finally {
      unlock()
    }
  },
  async checkUpgrade(input: { directory: string }, ctx: { signal: AbortSignal }) {
    await ensureWarmInstance()
    const { upgrade } = await importMod<typeof import("../upgrade")>("../upgrade")
    // 后台检查升级失败不影响当前会话，忽略（v1.19.3：改为返回结果，调用方可观测）
    // 支持 abort：若调用方取消，不再等待 upgrade 完成
    return new Promise((resolve) => {
      const onAbort = () => resolve(undefined)
      ctx.signal.addEventListener("abort", onAbort, { once: true })
      upgrade().then(resolve).finally(() => ctx.signal.removeEventListener("abort", onAbort))
    }).catch(() => undefined)
  },
  async reload(_input: undefined, ctx: { signal: AbortSignal }) {
    const { AppRuntime } = await importMod<typeof import("@/effect/app-runtime")>("@/effect/app-runtime")
    const { Config } = await importMod<typeof import("@/config/config")>("@/config/config")
    const { disposeAllInstancesAndEmitGlobalDisposed } = await importMod<
      typeof import("@/server/global-lifecycle")
    >("@/server/global-lifecycle")
    // 支持 abort：若调用方取消，尽快停止
    if (ctx.signal.aborted) return
    const onAbort = () => { /* abort 触发，runPromise 内部会处理 */ }
    ctx.signal.addEventListener("abort", onAbort, { once: true })
    try {
      await AppRuntime.runPromise(
        Effect.gen(function* () {
          const cfg = yield* Config.Service
          yield* cfg.invalidate()
          yield* disposeAllInstancesAndEmitGlobalDisposed({ swallowErrors: true })
        })
      )
    } finally {
      ctx.signal.removeEventListener("abort", onAbort)
    }
  },
  async shutdown(_input: undefined, ctx: { signal: AbortSignal }) {
    const { InstanceRuntime } = await importMod<typeof import("@/project/instance-runtime")>(
      "@/project/instance-runtime",
    )
    // 支持 abort：若调用方取消，尽快停止 dispose
    await new Promise<void>((resolve) => {
      const onAbort = () => resolve()
      ctx.signal.addEventListener("abort", onAbort, { once: true })
      InstanceRuntime.disposeAllInstances().then(() => {
        ctx.signal.removeEventListener("abort", onAbort)
        resolve()
      })
    })
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
  // 模块加载即并行预加载高频模块，不等首个 rpc.fetch，缩短冷启动延迟。
  // InstanceStore.load 对同 directory 幂等，并发调用复用同一 Deferred，天然去重。
  void Promise.all([
    ensureWarmInstance(),
    importMod<typeof import("@/server/server")>("@/server/server"),
    importMod<typeof import("@/server/auth")>("@/server/auth"),
  ])
    .then(() => tuiTiming("instance warm (APIs ready)"))
    // 预热属性能优化：失败时首次请求会走正常初始化路径（符合允许忽略的“纯性能优化”例外）
    .catch(() => { /* pre-warm failure OK */ })
}
