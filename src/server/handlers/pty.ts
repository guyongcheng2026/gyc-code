import { Pty } from "@gyccode/core/pty"
import { PtyProtocol } from "@gyccode/core/pty/protocol"
import { PtyTicket } from "@gyccode/core/pty/ticket"
import { Location } from "@gyccode/core/location"
import { Effect, Queue } from "effect"
import { HttpServerRequest, HttpServerResponse } from "effect/unstable/http"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import * as Socket from "effect/unstable/socket/Socket"
import { Api } from "../api"
import { CorsConfig, isAllowedRequestOrigin } from "../cors"
import { ForbiddenError, PtyNotFoundError } from "@gyccode/protocol/errors"
import {
  PTY_CONNECT_TICKET_QUERY,
  PTY_CONNECT_TOKEN_HEADER,
  PTY_CONNECT_TOKEN_HEADER_VALUE,
} from "@gyccode/protocol/groups/pty"
import { response } from "../location"
import { PtyEnvironment } from "../pty-environment"

const ticketScope = Effect.gen(function* () {
  const location = yield* Location.Service
  return { directory: location.directory as string, workspaceID: location.workspaceID }
})

export const PtyHandler = HttpApiBuilder.group(Api, "server.pty", (handlers) =>
  Effect.gen(function* () {
    const tickets = yield* PtyTicket.Service
    const cors = yield* CorsConfig
    const environment = yield* PtyEnvironment.Service

    return handlers
      .handle(
        "pty.list",
        Effect.fn(function* () {
          return yield* response((yield* Pty.Service).list())
        }),
      )
      .handle(
        "pty.create",
        Effect.fn(function* (ctx) {
          const pty = yield* Pty.Service
          const location = yield* Location.Service
          const cwd = ctx.payload.cwd || location.directory
          return yield* response(
            pty.create({
              ...ctx.payload,
              args: ctx.payload.args ? [...ctx.payload.args] : undefined,
              cwd,
              env: {
                ...ctx.payload.env,
                ...(yield* environment.get({ directory: location.directory, cwd })),
              },
            }),
          )
        }),
      )
      .handle(
        "pty.get",
        Effect.fn(function* (ctx) {
          const pty = yield* Pty.Service
          return yield* response(
            pty.get(ctx.params.ptyID).pipe(
              Effect.catchTag(
                "Pty.NotFoundError",
                () =>
                  new PtyNotFoundError({
                    ptyID: ctx.params.ptyID,
                    message: `PTY session not found: ${ctx.params.ptyID}`,
                  }),
              ),
            ),
          )
        }),
      )
      .handle(
        "pty.update",
        Effect.fn(function* (ctx) {
          const pty = yield* Pty.Service
          return yield* response(
            pty
              .update(ctx.params.ptyID, {
                ...ctx.payload,
                size: ctx.payload.size ? { ...ctx.payload.size } : undefined,
              })
              .pipe(
                Effect.catchTag(
                  "Pty.NotFoundError",
                  () =>
                    new PtyNotFoundError({
                      ptyID: ctx.params.ptyID,
                      message: `PTY session not found: ${ctx.params.ptyID}`,
                    }),
                ),
              ),
          )
        }),
      )
      .handle(
        "pty.remove",
        Effect.fn(function* (ctx) {
          const pty = yield* Pty.Service
          yield* pty.remove(ctx.params.ptyID).pipe(
            Effect.catchTag(
              "Pty.NotFoundError",
              () =>
                new PtyNotFoundError({
                  ptyID: ctx.params.ptyID,
                  message: `PTY session not found: ${ctx.params.ptyID}`,
                }),
            ),
          )
          return HttpApiSchema.NoContent.make()
        }),
      )
      .handle(
        "pty.connectToken",
        Effect.fn(function* (ctx) {
          const request = yield* HttpServerRequest.HttpServerRequest
          // The custom header forces a CORS preflight, so cross-origin browser pages cannot
          // mint tickets without passing the server's origin policy.
          if (
            request.headers[PTY_CONNECT_TOKEN_HEADER] !== PTY_CONNECT_TOKEN_HEADER_VALUE ||
            !isAllowedRequestOrigin(request.headers.origin, request.headers.host, cors)
          )
            return yield* new ForbiddenError({ message: "Invalid PTY connect token request" })
          const pty = yield* Pty.Service
          yield* pty.get(ctx.params.ptyID).pipe(
            Effect.catchTag(
              "Pty.NotFoundError",
              () =>
                new PtyNotFoundError({
                  ptyID: ctx.params.ptyID,
                  message: `PTY session not found: ${ctx.params.ptyID}`,
                }),
            ),
          )
          return yield* response(tickets.issue({ ptyID: ctx.params.ptyID, ...(yield* ticketScope) }))
        }),
      )
      .handleRaw(
        "pty.connect",
        Effect.fn("PtyHandler.connect")(function* (ctx) {
          const pty = yield* Pty.Service
          const exists = yield* pty.get(ctx.params.ptyID).pipe(
            Effect.as(true),
            Effect.catchTag("Pty.NotFoundError", () => Effect.succeed(false)),
          )
          if (!exists) return HttpServerResponse.empty({ status: 404 })

          const url = new URL(ctx.request.url, "http://localhost")
          const ticket = url.searchParams.get(PTY_CONNECT_TICKET_QUERY)
          if (ticket) {
            const valid = isAllowedRequestOrigin(ctx.request.headers.origin, ctx.request.headers.host, cors)
              ? yield* tickets.consume({ ticket, ptyID: ctx.params.ptyID, ...(yield* ticketScope) })
              : false
            if (!valid) return HttpServerResponse.empty({ status: 403 })
          }
          const parsedCursor = url.searchParams.get("cursor")
          const cursorNumber = parsedCursor === null ? undefined : Number(parsedCursor)
          const cursor =
            cursorNumber !== undefined && Number.isSafeInteger(cursorNumber) && cursorNumber >= -1
              ? cursorNumber
              : undefined

          const socket = yield* Effect.orDie(ctx.request.upgrade)
          const write = yield* socket.writer
          const closeAccepted = (event: Socket.CloseEvent) =>
            socket
              .runRaw(() => Effect.void, { onOpen: write(event).pipe(Effect.catch(() => Effect.void)) })
              .pipe(
                Effect.timeout("1 second"),
                Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
                Effect.catch(() => Effect.void),
              )

          // Outbound frames flow through one queue drained by a single writer so replay, live
          // output, and the close frame keep their order.
          // 溢出保护：慢消费者（网络阻塞/挂起不读）+ 高速输出 PTY 会在内存中
          // 无界堆积（24h 高并发下 OOM）。积压字节超限即断开（1009），PTY 输出
          // 是流式非关键数据，丢流优于进程崩溃。outboxBytes 只度量"当前未写出
          // 的积压量"（drain 写出成功后扣减），不是连接累计输出总量——否则正常
          // 长会话输出累计超限会被 1009 误杀。
          const OUTBOX_BYTE_LIMIT = 16 * 1024 * 1024
          let outboxBytes = 0
          let outboxOverflowed = false
          const outbox = yield* Queue.unbounded<string | Uint8Array | Socket.CloseEvent>()
          const offer = (chunk: string | Uint8Array | Socket.CloseEvent) => Queue.offerUnsafe(outbox, chunk)
          const offerData = (chunk: string | Uint8Array) => {
            if (outboxOverflowed) return
            outboxBytes += typeof chunk === "string" ? chunk.length : chunk.byteLength
            if (outboxBytes > OUTBOX_BYTE_LIMIT) {
              outboxOverflowed = true
              offer(new Socket.CloseEvent(1009, "output buffer overflow"))
              return
            }
            offer(chunk)
          }
          // 接入优雅关停追踪的 TODO 保留：tracker Service 定义在 gyccode 包，
          // 本包（server）反向依赖会形成循环，需先将 Service 下沉到 server 包。
          const attachment = yield* pty
            .attach(ctx.params.ptyID, {
              cursor,
              onData: offerData,
              onEnd: () => offer(new Socket.CloseEvent(1000)),
            })
            .pipe(
              Effect.catchTags({
                "Pty.NotFoundError": () =>
                  closeAccepted(new Socket.CloseEvent(4404, "session not found")).pipe(Effect.as(undefined)),
                "Pty.ExitedError": () =>
                  closeAccepted(new Socket.CloseEvent(4404, "session exited")).pipe(Effect.as(undefined)),
              }),
            )
          if (!attachment) return HttpServerResponse.empty()

          // replay/meta 同样计入积压字节，保证与 drain 的扣减口径一致。
          for (const chunk of PtyProtocol.chunks(attachment.replay)) offerData(chunk)
          offerData(PtyProtocol.metaFrame(attachment.cursor))
          attachment.activate()

          const drain = Effect.gen(function* () {
            while (true) {
              const item = yield* Queue.take(outbox)
              yield* write(item)
              if (item instanceof Socket.CloseEvent) return
              // 写出成功即扣减，使 outboxBytes 始终等于"当前积压量"而非
              // 连接累计输出——否则正常长会话输出累计超限会被 1009 误杀。
              outboxBytes -= typeof item === "string" ? item.length : item.byteLength
            }
          })

          yield* Effect.race(
            drain,
            socket.runRaw((message) => {
              const decoded = PtyProtocol.decodeInput(message)
              if (decoded !== undefined) attachment.write(decoded)
            }),
          ).pipe(
            Effect.catchReason("SocketError", "SocketCloseError", () => Effect.void),
            Effect.ensuring(Effect.sync(() => attachment.detach())),
            Effect.orDie,
          )
          return HttpServerResponse.empty()
        }),
      )
  }),
)
