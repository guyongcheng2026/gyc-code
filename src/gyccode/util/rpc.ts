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
    const parsed = JSON.parse(data)
    if (parsed.type === "rpc.request") {
      const result = await rpc[parsed.method](parsed.input)
      port.post(JSON.stringify({ type: "rpc.result", result, id: parsed.id }))
    }
  })
}

export function emit(event: string, data: unknown) {
  channel().post(JSON.stringify({ type: "rpc.event", event, data }))
}

export function client<T extends Definition>(target: {
  postMessage: (data: string) => void | null
  onmessage?: ((this: Worker, ev: MessageEvent<any>) => any) | null
  on?: (event: "message", listener: (data: string) => void) => void
}, hooks?: { onActivity?: () => void }) {
  const pending = new Map<number, { resolve: (result: unknown) => void; reject: (error: Error) => void }>()
  // any 为方差擦除所必需：on<Data> 注册的具体 handler 无法赋给 (data: unknown) => void
  const listeners = new Map<string, Set<(data: any) => void>>()
  let id = 0
  const onMessage = (data: string) => {
    const parsed = JSON.parse(data)
    // 任一方向的流量（结果回传/事件推送）都算活动：LLM 流式输出期间
    // 主进程不发请求，靠 rpc.event 维持 worker 空闲判定的活跃信号。
    if (parsed.type === "rpc.result" || parsed.type === "rpc.event") hooks?.onActivity?.()
    if (parsed.type === "rpc.result") {
      const entry = pending.get(parsed.id)
      if (entry) {
        pending.delete(parsed.id)
        entry.resolve(parsed.result)
      }
    }
    if (parsed.type === "rpc.event") {
      const handlers = listeners.get(parsed.event)
      if (handlers) {
        for (const handler of handlers) {
          handler(parsed.data)
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
        pending.set(requestId, { resolve, reject })
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
      handlers.add(handler)
      return () => {
        handlers!.delete(handler)
      }
    },
    // worker 崩溃/被替换时调用：reject 所有挂起请求，避免上层 fetch 永久挂起。
    // 事件监听器保留——它们绑定在新 client 上后继续生效（热重启场景）。
    dispose(reason: Error) {
      for (const entry of pending.values()) {
        entry.reject(reason)
      }
      pending.clear()
    },
  }
}

export * as Rpc from "./rpc"
