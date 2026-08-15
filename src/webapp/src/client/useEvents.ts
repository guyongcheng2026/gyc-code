import { useEffect, useRef } from "react"
import { sdk } from "./sdk"

export type AnyEvent = { type: string; properties?: Record<string, unknown> }

// 订阅全局事件流（SSE）。事件经回调派发给 store reducer。
// 由生成 SDK 的 SSE 客户端负责断线重连（指数退避）。
export function useEvents(directory: string | undefined, onEvent: (e: AnyEvent) => void) {
  const cb = useRef(onEvent)
  cb.current = onEvent

  useEffect(() => {
    let disposed = false
    const client = sdk(directory)
    let sub: { stream: AsyncGenerator<AnyEvent> } | undefined

    void client.global
      .event({
        query: { directory },
        onSseEvent: (evt) => {
          if (!disposed && evt?.data) cb.current(evt.data as AnyEvent)
        },
      })
      .then((result) => {
        if (!disposed) sub = result
      })

    return () => {
      disposed = true
      void sub?.stream.return?.(undefined)
    }
  }, [directory])
}
