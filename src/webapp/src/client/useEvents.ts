import { useEffect, useRef } from "react"
import { sdk } from "./sdk"

export type AnyEvent = { type: string; properties?: Record<string, unknown> }

// 订阅全局事件流（SSE）。服务端推送形如 `data: {"payload": {type, properties}}`。
// hey-api 的 SSE 客户端是惰性 AsyncGenerator —— 必须主动迭代流才会消费事件，
// 这里 for-await 迭代并解包 payload 派发给 reducer。
// directory 经 createGyccodeClient 的 x-gyccode-directory header 传递（/global/event 无 query 参数）。
export function useEvents(directory: string | undefined, onEvent: (e: AnyEvent) => void) {
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    let disposed = false
    const client = sdk(directory)

    void client.global
      .event()
      .then(async (result) => {
        if (disposed) return
        try {
          for await (const data of result.stream) {
            if (disposed) return
            const global = data as { payload?: AnyEvent } | null
            if (global?.payload) cb.current(global.payload)
          }
        } catch {
          // 流关闭/出错；SSE 客户端内部自带断线重连，这里仅停止消费。
        }
      })
      .catch(() => {
        // 订阅初始化失败，忽略。
      })

    return () => {
      disposed = true
    }
  }, [directory])
}
