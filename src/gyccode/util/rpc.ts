import { parentPort } from "node:worker_threads"

// @types/bun 对 node:worker_threads 的 parentPort 声明不准确（主线程字面量 null），
// 运行时在 worker 线程中为 MessagePort。此处用结构化类型手动收窄，避免依赖其声明。
type NodeWorkerPort = {
  on(event: "message", listener: (data: string) => void): void
  postMessage(data: string): void
}

// any 在此为方差擦除所必需：handler 实参类型各异（unknown 会因逆协变
// 拒绝具体参数类型的实现），具体类型由 client<T> 泛型在调用侧保证。
type Definition = {
  [method: string]: (input: any) => any
}

export type { Definition }

// 消息通道统一适配：Web Worker（Bun/浏览器 onmessage/postMessage 全局）优先，
// Node worker_threads（parentPort）兜底。TUI 整体由 Node 运行，worker 线程经
// node:worker_threads 创建；client 侧同样双通道兼容（node Worker 无 onmessage 属性）。
function channel() {
  if (typeof onmessage !== "undefined" && typeof postMessage !== "undefined") {
    return {
      onMessage(listener: (data: string) => void) {
        onmessage = (evt) => listener(evt.data)
      },
      post(data: string) {
        postMessage(data)
      },
    }
  }
  const nodePort = parentPort as NodeWorkerPort | null | undefined
  if (nodePort != null) {
    return {
      onMessage(listener: (data: string) => void) {
        nodePort.on("message", listener)
      },
      post(data: string) {
        nodePort.postMessage(data)
      },
    }
  }
  throw new Error("RPC message channel is not available")
}

export function listen(rpc: Definition) {
  const port = channel()
  port.onMessage(async (data) => {
    let parsed: { type?: string; method?: string; input?: unknown; id?: number }
    try {
      parsed = JSON.parse(data)
    } catch {
      // 畸形消息：忽略并继续，不让整个消息通道因一次坏包而失效
      return
    }
    if (parsed.type === "rpc.request") {
      try {
        const handler = parsed.method === undefined ? undefined : rpc[parsed.method]
        // 未知方法显式失败（此前会抛 TypeError，调用方语义不变）
        if (handler === undefined) throw new Error(`RPC method not found: ${parsed.method}`)
        const result = await handler(parsed.input)
        port.post(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
      } catch (error) {
        // handler 抛错必须回传：否则 client 侧 pending 悬挂至 dispose，上层 fetch 永不结束。
        port.post(
          JSON.stringify({
            type: "rpc.result",
            id: parsed.id,
            error: error instanceof Error ? (error.stack ?? error.message) : String(error),
          }),
        )
      }
    }
  })
}

export function emit(event: string, data: unknown) {
  channel().post(JSON.stringify({ type: "rpc.event", event, data }))
}

// 默认单次 RPC 调用上限。worker 侧 handler 多为 LLM 流式请求，正常可达数分钟；
// 取 10 分钟仅为拦截"永不返回"的悬挂，避免 pending 无界增长。
const DEFAULT_RPC_TIMEOUT_MS = (() => {
  const raw = process.env.GYCCODE_RPC_TIMEOUT_MS
  if (raw === undefined || raw.length === 0) return 10 * 60 * 1000
  const parsed = Number(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 10 * 60 * 1000
})()

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage?: ((this: Worker, ev: MessageEvent<any>) => any) | null
  on?: (event: "message", listener: (data: string) => void) => void
}, hooks?: { onActivity?: () => void; /** 单次调用超时（ms）。传 0 关闭超时。默认取 GYCCODE_RPC_TIMEOUT_MS 或 10 分钟。 */ timeoutMs?: number }) {
  const timeoutMs = hooks?.timeoutMs ?? DEFAULT_RPC_TIMEOUT_MS
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  // 与 pending 一一对应的超时定时器：settle 时清理，避免长驻定时器拖住进程。
  const timers = new Map<number, ReturnType<typeof setTimeout>>()
  // 用 never 而非 any 做类型擦除：(data: never) => void 对任意具体 handler 均可赋值
  // （函数参数逆变：never 是所有类型的子类型），从而在保留泛型精确类型的同时避免 any。
  const listeners = new Map<string, Set<(data: never) => void>>()
  let id = 0
  const onMessage = (data: string) => {
    let parsed: { type?: string; id?: number; error?: unknown; result?: unknown; event?: string; data?: unknown }
    try {
      parsed = JSON.parse(data)
    } catch {
      // 畸形消息（截断/编码损坏）不应让整个消息通道抛出：否则后续合法消息
      // 也会因监听器异常而丢失。忽略并继续。
      return
    }
    // 任一方向的流量（结果回传/事件推送）都算活动：LLM 流式输出期间
    // 主进程不发请求，靠 rpc.event 维持 worker 空闲判定的活跃信号。
    if (parsed.type === "rpc.result" || parsed.type === "rpc.event") hooks?.onActivity?.()
    if (parsed.type === "rpc.result") {
      const requestId = parsed.id
      if (requestId === undefined) return
      const entry = pending.get(requestId)
      if (entry) {
        pending.delete(requestId)
        // 服务端回传 error 字段表示 handler 失败：reject 而非 resolve，
        // 否则调用方会把失败当成功结果继续跑。
        if (parsed.error !== undefined) {
          entry.reject(new Error(String(parsed.error)))
        } else {
          entry.resolve(parsed.result)
        }
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event as string)
      if (handlers) {
        for (const handler of handlers) {
          ;(handler as (data: unknown) => void)(parsed.data)
        }
      }
    }
  }
  if (typeof target.on === "function") {
    target.on("message", onMessage)
  } else {
    target.onmessage = async (evt) => {
      onMessage(evt.data)
    }
  }
  return {
    call<Method extends keyof T>(method: Method, input: Parameters<T[Method]>[0]): Promise<ReturnType<T[Method]>> {
      const requestId = id++
      hooks?.onActivity?.()
      return new Promise((resolve, reject) => {
        const settle = (fn: () => void) => {
          const timer = timers.get(requestId)
          if (timer !== undefined) {
            clearTimeout(timer)
            timers.delete(requestId)
          }
          fn()
        }
        // 超时兜底：dispose 只在 worker 退出/空闲卸载时触发，若 worker 存活但
        // handler 永不返回（死锁、上游挂起），pending 条目会无界常驻并连带
        // 持有调用方的闭包。超时后主动 reject 并清理。
        // 不用 unref：Node 与 Bun 的返回类型不同（Bun 下无该方法），
        // 且定时器已在 settle/dispose 路径清除，不会拖住进程退出。
        if (timeoutMs > 0) {
          const timer = setTimeout(() => {
            if (!pending.has(requestId)) return
            pending.delete(requestId)
            timers.delete(requestId)
            reject(new Error(`RPC call timed out after ${timeoutMs}ms: ${String(method)}`))
          }, timeoutMs)
          timers.set(requestId, timer)
        }
        pending.set(requestId, {
          resolve: (result) => settle(() => resolve(result as ReturnType<T[Method]>)),
          reject: (error) => settle(() => reject(error)),
        })
        target.postMessage(JSON.stringify({ type: "rpc.request", method, input, id: requestId }))
      })
    },
    // 当前 in-flight 请求数：空闲卸载前检查，避免误杀活跃连接
    pendingCount(): number {
      return pending.size
    },
    on<Data>(event: string, handler: (data: Data) => void) {
      let handlers = listeners.get(event)
      if (!handlers) {
        handlers = new Set()
        listeners.set(event, handlers)
      }
      handlers.add(handler as (data: never) => void)
      return () => {
        handlers!.delete(handler as (data: never) => void)
      }
    },
    // worker 崩溃/被替换时调用：reject 所有挂起请求，避免上层 fetch 永久挂起。
    // listeners 同步释放：热重启由 worker-pool 重新 spawn 并创建全新 client
    // （worker-pool.ts spawnWorker 内 Rpc.client(...)，事件 on() 随之重新注册），
    // 旧 client 已无端口可收消息，保留 listeners 只会让旧 handler 残留造成回调叠加。
    dispose(reason: Error) {
      for (const entry of pending.values()) {
        entry.reject(reason)
      }
      pending.clear()
      for (const timer of timers.values()) clearTimeout(timer)
      timers.clear()
      listeners.clear()
    },
  }
}

export * as Rpc from "./rpc"
