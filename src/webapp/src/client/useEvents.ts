import { useEffect, useRef } from "react"
import { sdk } from "./sdk"

export type AnyEvent = { type: string; properties?: Record<string, unknown> }

// 订阅全局事件流（SSE）。服务端推送形如 `data: {"payload": {type, properties}}`。
// directory 经 createGyccodeClient 的 x-gyccode-directory header 传递（/global/event 无 query 参数）。
//
// 连接复用（关键）：浏览器对同源 HTTP/1.1 有并发连接上限（Chrome 为 6），而 SSE 是长连接。
// 此前每个 hook 实例各自开一条 /global/event 且卸载时不取消，页面内选中会话后即有 7+ 条
// 永久连接，连接池被打满后所有后续 API 请求永久排队（模型列表"加载中…"、消息不加载、
// 新会话无响应等）。因此同一 directory 全页共享一条流，事件在订阅者间扇出；
// 最后一个订阅者离开时经 AbortSignal 真正关闭底层连接。
type Listener = (e: AnyEvent) => void

type Bus = { listeners: Set<Listener>; ac: AbortController }

const buses = new Map<string | undefined, Bus>()

function startStream(directory: string | undefined, bus: Bus) {
  void sdk(directory)
    .global.event({ signal: bus.ac.signal })
    .then(async (result) => {
      try {
        for await (const data of result.stream) {
          const global = data as { payload?: AnyEvent } | null
          if (!global?.payload) continue
          // 扇出快照迭代：避免监听器在派发中增删导致的问题
          for (const l of [...bus.listeners]) l(global.payload)
        }
      } catch {
        // 流被中止或出错；SSE 客户端内部自带断线重连，这里仅停止消费。
      }
    })
    .catch(() => {
      // 订阅初始化失败，忽略。
    })
}

function subscribe(directory: string | undefined, cb: Listener): () => void {
  let bus = buses.get(directory)
  if (!bus) {
    bus = { listeners: new Set(), ac: new AbortController() }
    buses.set(directory, bus)
    startStream(directory, bus)
  }
  bus.listeners.add(cb)
  return () => {
    const current = buses.get(directory)
    if (current !== bus) return
    bus.listeners.delete(cb)
    if (bus.listeners.size === 0) {
      bus.ac.abort()
      buses.delete(directory)
    }
  }
}

export function useEvents(directory: string | undefined, onEvent: Listener) {
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => subscribe(directory, (e) => cb.current(e)), [directory])
}
