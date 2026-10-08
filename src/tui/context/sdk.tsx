import { createGyccodeClient } from "@gyccode/protocol/v2"
import type { GlobalEvent } from "@gyccode/protocol/v2"
import { Flag } from "@gyccode/core/flag/flag"
import { logError } from "@core/observability/log-error"
import { createSimpleContext } from "./helper"
import { batch, onCleanup, onMount } from "solid-js"

export type EventSource = {
  subscribe: (handler: (event: GlobalEvent) => void) => Promise<() => void>
}

export const { use: useSDK, provider: SDKProvider } = createSimpleContext({
  name: "SDK",
  init: (props: {
    url: string
    directory?: string
    fetch?: typeof fetch
    headers?: RequestInit["headers"]
    events?: EventSource
  }) => {
    const abort = new AbortController()
    let sse: AbortController | undefined

    function createSDK() {
      return createGyccodeClient({
        baseUrl: props.url,
        signal: abort.signal,
        directory: props.directory,
        fetch: props.fetch,
        headers: props.headers,
      })
    }

    let sdk = createSDK()

    const handlers = new Set<(event: GlobalEvent) => void>()
    const emitter = {
      emit(_type: "event", event: GlobalEvent) {
        for (const handler of handlers) handler(event)
      },
      on(_type: "event", handler: (event: GlobalEvent) => void) {
        handlers.add(handler)
        return () => {
          handlers.delete(handler)
        }
      },
    }

    let queue: GlobalEvent[] = []
    let timer: Timer | undefined
    let last = 0
    const retryDelay = 1000
    const maxRetryDelay = 30000

    const flush = () => {
      if (queue.length === 0) return
      const events = queue
      queue = []
      timer = undefined
      last = Date.now()
      // Batch all event emissions so all store updates result in a single render
      batch(() => {
        for (const event of events) {
          emitter.emit("event", event)
        }
      })
    }

    const handleEvent = (event: GlobalEvent) => {
      queue.push(event)
      const elapsed = Date.now() - last

      if (timer) return
      // If we just flushed recently (within 16ms), batch this with future events
      // Otherwise, process immediately to avoid latency
      if (elapsed < 16) {
        timer = setTimeout(flush, 16)
        return
      }
      flush()
    }

    function startSSE() {
      sse?.abort()
      const ctrl = new AbortController()
      sse = ctrl
      ;(async () => {
        let attempt = 0
        while (true) {
          if (abort.signal.aborted || ctrl.signal.aborted) break

          try {
            const events = await sdk.global.event({
              signal: ctrl.signal,
              sseMaxRetryAttempts: 0,
            })

            if (Flag.GYCCODE_EXPERIMENTAL_WORKSPACES) {
              // Start syncing workspaces, it's important to do this after
              // we've started listening to events
              await sdk.sync.start().catch((error: unknown) => {
                // 同步失败不致命（事件流仍会建立），但必须留痕：此前静默吞掉，
                // 工作区同步长期不工作时没有任何线索可查。
                logError("tui.sdk", error, { op: "sync.start" })
              })
            }

            for await (const event of events.stream) {
              if (ctrl.signal.aborted) break
              handleEvent(event)
            }

            if (timer) clearTimeout(timer)
            if (queue.length > 0) flush()
          } catch (error) {
            // 网络/协议异常不得让事件流静默死亡：记录并继续指数退避重连
            // （仅 abort 时退出）。此前无 try/catch，错误被 .catch(() => {})
            // 吞掉导致 TUI 事件流失联、界面卡死但进程存活。
            if (abort.signal.aborted || ctrl.signal.aborted) break
            logError("tui.sdk", error)
          }
          attempt += 1
          if (abort.signal.aborted || ctrl.signal.aborted) break

          // Exponential backoff
          const backoff = Math.min(retryDelay * 2 ** (attempt - 1), maxRetryDelay)
          await new Promise((resolve) => setTimeout(resolve, backoff))
        }
      })()
    }

    onMount(() => {
      if (props.events) {
        // 不能写成 `onMount(async () => { const unsub = await ...; onCleanup(unsub) })`：
        // await 之后 Solid 的 Owner 已丢失，onCleanup 在 Owner===null 时是静默空操作
        // （node_modules/solid-js/dist/solid.cjs），退订永远不会执行。
        // 故先同步注册清理，再在 promise 兑现后挂上 unsub；若期间已卸载则立即退订。
        let unsub: (() => void) | undefined
        let disposed = false
        onCleanup(() => {
          disposed = true
          unsub?.()
        })
        void props.events
          .subscribe(handleEvent)
          .then((off) => {
            if (disposed) {
              off()
              return
            }
            unsub = off
          })
          .catch((error: unknown) => {
            logError("tui.sdk", error, { op: "events.subscribe" })
          })

        if (Flag.GYCCODE_EXPERIMENTAL_WORKSPACES) {
          // Start syncing workspaces, it's important to do this after
          // we've started listening to events
          void sdk.sync.start().catch((error: unknown) => {
            // 同 startSSE：失败不致命，但必须留痕，否则同步长期不工作时无从排查。
            logError("tui.sdk", error, { op: "sync.start" })
          })
        }
      } else {
        startSSE()
      }
    })

    onCleanup(() => {
      abort.abort()
      sse?.abort()
      if (timer) clearTimeout(timer)
      handlers.clear()
    })

    return {
      get client() {
        return sdk
      },
      directory: props.directory,
      event: emitter,
      fetch: props.fetch ?? fetch,
      url: props.url,
    }
  },
})
