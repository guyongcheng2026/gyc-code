import { Cause, Context, Effect, Fiber, Layer, Queue, Stream } from "effect"
import { Headers } from "effect/unstable/http"
import { LLMError, TransportReason } from "../../schema"
import * as HttpTransport from "./http"
import type { Transport } from "./index"

export interface WebSocketRequest {
  readonly url: string
  readonly headers: Headers.Headers
}

export interface WebSocketConnection {
  readonly sendText: (message: string) => Effect.Effect<void, LLMError>
  readonly messages: Stream.Stream<string | Uint8Array, LLMError>
  readonly close: Effect.Effect<void, never>
}

export interface Interface {
  readonly open: (input: WebSocketRequest) => Effect.Effect<WebSocketConnection, LLMError>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/LLM/WebSocketExecutor") {}

// 仅用于选择构造器，不用于判定运行形态：Node 22+ 内置的全局 WebSocket 是
// 浏览器 API 实现，不支持自定义 header；要带 header 必须走 ws 包。
const hasGlobalWebSocket = typeof globalThis.WebSocket !== "undefined"

// 心跳周期：两个周期（约 60s）收不到 pong 即判定链路已死
const HEARTBEAT_INTERVAL_MS = 30_000

const createWebSocket = (
  url: string,
  headers: Headers.Headers,
): globalThis.WebSocket => {
  if (!hasGlobalWebSocket) {
    type NodeWebSocketModule = typeof import("ws")
    const mod: NodeWebSocketModule = require("ws")
    return new mod.WebSocket(url, { headers }) as unknown as globalThis.WebSocket
  }
  if (headers && Object.keys(headers).length > 0) {
    console.warn("[websocket] ignoring custom headers in browser environment")
  }
  return new globalThis.WebSocket(url)
}

const transportError = (
  method: string,
  message: string,
  input: { readonly url?: string; readonly kind?: string } = {},
) =>
  new LLMError({
    module: "WebSocketExecutor",
    method,
    reason: new TransportReason({ message, url: input.url, kind: input.kind }),
  })

const eventMessage = (event: Event) => {
  if ("message" in event && typeof event.message === "string") return event.message
  return event.type
}

const binaryMessage = (data: unknown) => {
  if (data instanceof Uint8Array) return data
  if (data instanceof ArrayBuffer) return new Uint8Array(data)
  if (ArrayBuffer.isView(data)) return new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
  return undefined
}

const waitOpen = (ws: globalThis.WebSocket, input: WebSocketRequest) => {
  if (ws.readyState === globalThis.WebSocket.OPEN) return Effect.void
  if (ws.readyState === globalThis.WebSocket.CLOSING || ws.readyState === globalThis.WebSocket.CLOSED) {
    return Effect.fail(
      transportError("open", `WebSocket closed before opening (state ${ws.readyState})`, {
        url: input.url,
        kind: "open",
      }),
    )
  }
  return Effect.gen(function* () {
    let disposeRef: (() => void) | undefined
    yield* Effect.race(
      Effect.callback<void, LLMError>((resume, signal) => {
        const cleanup = () => {
          ws.removeEventListener("open", onOpen)
          ws.removeEventListener("error", onError)
          ws.removeEventListener("close", onClose)
          signal.removeEventListener("abort", onAbort)
        }
        let aborted = false
        let opened = false
        // 中断与超时共用：移除监听器并关闭 socket，避免监听器与 WS 句柄残留
        const dispose = () => {
          if (opened) return
          cleanup()
          if (ws.readyState !== globalThis.WebSocket.CLOSED && ws.readyState !== globalThis.WebSocket.CLOSING)
            ws.close(1000)
        }
        disposeRef = dispose
        const onAbort = () => {
          aborted = true
          try {
            resume(
              Effect.fail(
                transportError("open", "WebSocket connection aborted", { url: input.url, kind: "open" }),
              ),
            )
          } catch {
            // resume already called (e.g. onOpen fired before abort)
          }
          dispose()
        }
        const onOpen = () => {
          opened = true
          cleanup()
          if (!aborted) {
            try {
              resume(Effect.void)
            } catch {
              // resume already called (e.g. onAbort fired before onOpen)
            }
          }
        }
        const onError = (event: Event) => {
          cleanup()
          if (!aborted) {
            try {
              resume(
                Effect.fail(
                  transportError("open", `Failed to open WebSocket: ${eventMessage(event)}`, { url: input.url, kind: "open" }),
                ),
              )
            } catch (error) {
              // 投递失败时会与已送达的结果冲突，此处 socket 错误无法再送达，记录告警避免被静默吞掉
              Effect.runFork(
                Effect.logWarning(
                  `WebSocket open error dropped: ${eventMessage(event)} (${error instanceof Error ? error.message : String(error)})`,
                ),
              )
            }
          }
        }
        const onClose = (event: CloseEvent) => {
          cleanup()
          if (!aborted) {
            try {
              resume(
                Effect.fail(
                  transportError("open", `WebSocket closed before opening with code ${event.code}`, {
                    url: input.url,
                    kind: "open",
                  }),
                ),
              )
            } catch (error) {
              // 未连接即关闭同样属于失败路径，投递不出去时记录告警，避免 close 原因被静默吞掉
              Effect.runFork(
                Effect.logWarning(
                  `WebSocket close before open dropped: code ${event.code} (${error instanceof Error ? error.message : String(error)})`,
                ),
              )
            }
          }
        }
        ws.addEventListener("open", onOpen, { once: true })
        ws.addEventListener("error", onError, { once: true })
        ws.addEventListener("close", onClose, { once: true })
        signal.addEventListener("abort", onAbort, { once: true })
      }),
      Effect.sleep("10 seconds").pipe(
        Effect.flatMap(() => {
          // 超时失败分支不会走上面的 resume 路径，必须自行清理监听器并关闭 socket
          disposeRef?.()
          return Effect.fail(
            transportError("open", "WebSocket connection timeout", { url: input.url, kind: "timeout" }),
          )
        }),
      ),
    )
  })
}

const webSocketUrl = (value: string) =>
  Effect.try({
    try: () => {
      const url = new URL(value)
      if (url.protocol === "https:") {
        url.protocol = "wss:"
        return url.toString()
      }
      if (url.protocol === "http:") {
        url.protocol = "ws:"
        return url.toString()
      }
      throw new Error(`Unsupported WebSocket URL protocol ${url.protocol}`)
    },
    catch: (error) =>
      transportError("prepare", error instanceof Error ? error.message : "Invalid WebSocket URL", {
        url: value,
        kind: "websocket",
      }),
  })

export const open = (input: WebSocketRequest) =>
  Effect.try({
    try: () => createWebSocket(input.url, input.headers),
    catch: (error) =>
      transportError("open", error instanceof Error ? error.message : "Failed to construct WebSocket", {
        url: input.url,
        kind: "open",
      }),
  }).pipe(Effect.flatMap((ws) => fromWebSocket(ws, input)))

export const layer: Layer.Layer<Service> = Layer.succeed(Service, Service.of({ open }))

export const fromWebSocket = (
  ws: globalThis.WebSocket,
  input: WebSocketRequest,
): Effect.Effect<WebSocketConnection, LLMError> =>
  Effect.gen(function* () {
    yield* waitOpen(ws, input)
    const messages = yield* Queue.bounded<string | Uint8Array, LLMError | Cause.Done<void>>(128)

    const onMessage = (event: MessageEvent) => {
      const data: string | Uint8Array | undefined = typeof event.data === "string"
        ? event.data
        : binaryMessage(event.data)
      if (data === undefined) {
        Queue.failCauseUnsafe(
          messages,
          Cause.fail(
            transportError("message", "Unsupported WebSocket message payload", { url: input.url, kind: "message" }),
          ),
        )
        return
      }
      // offerUnsafe 同步入队：队列满说明消费侧跟不上（单帧过大或 delta 突发），
      // 此时若只打一条 warning 后继续，丢掉的正是流式增量 —— 表现为「静默丢 token」。
      // 必须显式失败，让上层按既定策略重试或报错。
      if (!Queue.offerUnsafe(messages, data)) {
        Queue.failCauseUnsafe(
          messages,
          Cause.fail(
            transportError("message", "WebSocket message queue overflow", { url: input.url, kind: "message" }),
          ),
        )
      }
    }
    const onError = (event: Event) => {
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", `WebSocket error: ${eventMessage(event)}`, { url: input.url, kind: "message" }),
        ),
      )
    }
    const onClose = (event: CloseEvent) => {
      // 仅 1000 (Normal Closure) 视为干净关闭；1005 (No Status Received) 属异常关闭，需报错
      if (event.code === 1000) return Queue.endUnsafe(messages)
      Queue.failCauseUnsafe(
        messages,
        Cause.fail(
          transportError("message", `WebSocket closed with code ${event.code}`, { url: input.url, kind: "close" }),
        ),
      )
    }

    // 心跳：长会话中途被网关/代理静默断开时，既无 error 也无 close 事件，
    // 只能靠 ping/pong 探测。连续两个周期收不到 pong 即判定链路已死并失败，
    // 否则只能等首包超时甚至永久挂起。
    const ping = (ws as { ping?: () => void }).ping
    // 只有具备应用层 ping 的实现才会派发 "pong" 事件。浏览器 API 以及
    // Node 22+ 内置的全局 WebSocket 都没有 ping()，onPong 永远不会被触发；
    // 若此时照常按「收不到 pong 即超时」判定，健康长连接会在约 60s 后被误杀。
    // 因此无 ping 能力时干脆不起心跳 fork。
    const supportsHeartbeat = typeof ping === "function"
    let lastPongAt = Date.now()
    const onPong = () => {
      lastPongAt = Date.now()
    }
    const heartbeat = supportsHeartbeat
      ? yield* Effect.forkDetach(
          Effect.forever(
            Effect.andThen(Effect.sleep(HEARTBEAT_INTERVAL_MS), () =>
              Effect.sync(() => {
                if (Date.now() - lastPongAt > HEARTBEAT_INTERVAL_MS * 2) {
                  Queue.failCauseUnsafe(
                    messages,
                    Cause.fail(
                      transportError("message", "WebSocket heartbeat timeout", { url: input.url, kind: "timeout" }),
                    ),
                  )
                  return
                }
                ping?.call(ws)
              }),
            ),
          ),
        )
      : undefined

    const cleanup = Effect.sync(() => {
      ws.removeEventListener("message", onMessage)
      ws.removeEventListener("error", onError)
      ws.removeEventListener("close", onClose)
      ws.removeEventListener("pong", onPong)
    }).pipe(
      Effect.andThen(Effect.suspend(() => (heartbeat ? Fiber.interrupt(heartbeat) : Effect.void))),
      Effect.andThen(Queue.shutdown(messages)),
    )

    ws.addEventListener("message", onMessage)
    ws.addEventListener("error", onError)
    ws.addEventListener("close", onClose)
    ws.addEventListener("pong", onPong)

    return {
      sendText: (message) =>
        Effect.try({
          try: () => ws.send(message),
          catch: (error) =>
            transportError("sendText", error instanceof Error ? error.message : "Failed to send WebSocket message", {
              url: input.url,
              kind: "write",
            }),
        }),
      messages: Stream.fromQueue(messages),
      close: cleanup.pipe(
        Effect.andThen(
          Effect.sync(() => {
            if (ws.readyState === globalThis.WebSocket.CLOSED || ws.readyState === globalThis.WebSocket.CLOSING) return
            ws.close(1000)
          }),
        ),
      ),
    }
  })

export const messageText = (message: string | Uint8Array, decoder: TextDecoder) =>
  typeof message === "string" ? message : decoder.decode(message)

export interface JsonPrepared {
  readonly url: string
  readonly headers: Headers.Headers
  readonly message: string
}

export interface JsonInput<Body, Message> {
  readonly toMessage: (body: Body | Record<string, unknown>) => Effect.Effect<Message, LLMError>
  readonly encodeMessage: (message: Message) => string
}

export type JsonPatch<Body, Message> = Partial<JsonInput<Body, Message>>

export interface JsonTransport<Body, Message> extends Transport<Body, JsonPrepared, string> {
  readonly with: (patch: JsonPatch<Body, Message>) => JsonTransport<Body, Message>
}

export const json = <Body, Message>(input: JsonInput<Body, Message>): JsonTransport<Body, Message> => ({
  id: "websocket-json",
  with: (patch) => json({ ...input, ...patch }),
  prepare: (prepareInput) =>
    Effect.gen(function* () {
      const parts = yield* HttpTransport.jsonRequestParts({
        ...prepareInput,
      })
      return {
        url: yield* webSocketUrl(parts.url),
        headers: parts.headers,
        message: input.encodeMessage(yield* input.toMessage(parts.jsonBody)),
      }
    }),
  frames: (prepared, _request, runtime) => {
    const webSocket = runtime.webSocket
    if (!webSocket) {
      return Stream.fail(
        transportError("json", "WebSocket JSON transport requires WebSocketExecutor.Service", {
          url: prepared.url,
          kind: "websocket",
        }),
      )
    }
    const decoder = new TextDecoder()
    return Stream.unwrap(
      Effect.gen(function* () {
        const connection = yield* Effect.acquireRelease(
          webSocket.open({ url: prepared.url, headers: prepared.headers }),
          (connection) => connection.close,
        )
        yield* connection.sendText(prepared.message)
        return connection.messages.pipe(Stream.map((message) => messageText(message, decoder)))
      }),
    )
  },
})

export const jsonTransport = {
  id: "websocket-json",
  with: json,
} as const

export const WebSocketExecutor = {
  Service,
  layer,
  open,
  fromWebSocket,
  messageText,
} as const

export const WebSocketTransport = {
  json,
  jsonTransport,
} as const
