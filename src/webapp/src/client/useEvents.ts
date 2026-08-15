import { useEffect, useRef } from "react"
import { sdk } from "./sdk"

export type AnyEvent = { type: string; properties?: Record<string, unknown> }

// 订阅全局事件流（SSE）。服务端推送 GlobalEvent = { directory, payload: Event }，
// 这里解包 payload（真正的类型化事件）经回调派发给 store reducer。
// directory 经 createGyccodeClient 的 x-gyccode-directory header 传递（/global/event 无 query 参数）。
export function useEvents(directory: string | undefined, onEvent: (e: AnyEvent) => void) {
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    let disposed = false
    const client = sdk(directory)

    void client.global
      .event({
        onSseEvent: (evt) => {
          if (disposed || !evt?.data) return
          const global = evt.data as { payload?: AnyEvent } | null
          if (global?.payload) cb.current(global.payload)
        },
      })
      .catch(() => {
        // 忽略订阅失败；SSE 客户端自带重连，组件卸载由 disposed 守卫。
      })

    return () => {
      disposed = true
    }
  }, [directory])
}
