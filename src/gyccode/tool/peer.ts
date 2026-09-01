import { Effect, Schema } from "effect"
import * as Tool from "./tool"

// F2: 代理间消息（peer messaging），参考 Hermes v0.21.0 `hermes peer` 概念。
// 最小实现：内存 Map 存储消息，handle 即 sessionID，按 FIFO 排队。
// 提供 send / read 两个工具，允许 agent 之间发送和接收直接消息。

export interface PeerMessage {
  id: string
  from: string
  to: string
  content: string
  sentAt: number
  read: boolean
}

const inbox = new Map<string, PeerMessage[]>()
let messageCounter = 0

function enqueue(msg: PeerMessage) {
  const list = inbox.get(msg.to) ?? []
  list.push(msg)
  if (list.length > 500) list.splice(0, list.length - 500)
  inbox.set(msg.to, list)
}

const SendInput = Schema.Struct({
  to: Schema.String.annotate({ description: "Recipient handle (sessionID, agent name, or any string identifier)." }),
  content: Schema.String.annotate({ description: "Message content to deliver." }),
})

const ReadInput = Schema.Struct({
  from: Schema.optional(Schema.String).annotate({ description: "Optional sender filter; only return messages from this handle." }),
  limit: Schema.optional(Schema.Number).annotate({ description: "Max messages to return; default 20." }),
  mark_read: Schema.optional(Schema.Boolean).annotate({ description: "Mark returned messages as read; default true." }),
})

export const PeerSendTool = Tool.define<typeof SendInput, {}, never>(
  "peer_send",
  Effect.succeed({
    description:
      "Send a direct message to another agent (peer DM). The recipient retrieves it via `peer_read`. Messages are stored in memory (cleared on restart).",
    parameters: SendInput,
    execute: (params: Schema.Schema.Type<typeof SendInput>, ctx: Tool.Context) => {
      const msg: PeerMessage = {
        id: `peer-${Date.now()}-${(++messageCounter).toString(36)}`,
        from: ctx.sessionID,
        to: params.to,
        content: params.content,
        sentAt: Date.now(),
        read: false,
      }
      enqueue(msg)
      return Effect.succeed({
        title: `peer_send to ${params.to}`,
        metadata: { id: msg.id, to: params.to, from: msg.from },
        output: `Sent peer message ${msg.id} to "${params.to}" (${msg.content.length} chars).`,
      })
    },
  }),
)

export const PeerReadTool = Tool.define<typeof ReadInput, {}, never>(
  "peer_read",
  Effect.succeed({
    description:
      "Read peer messages addressed to this session. Returns up to `limit` messages (default 20), optionally filtered by sender. Marks them as read by default.",
    parameters: ReadInput,
    execute: (params: Schema.Schema.Type<typeof ReadInput>, ctx: Tool.Context) => {
      const list = (inbox.get(ctx.sessionID) ?? []).filter((m) => !params.from || m.from === params.from)
      const limit = params.limit ?? 20
      const slice = list.splice(-limit)
      for (const m of slice) m.read = true
      return Effect.succeed({
        title: `peer_read (${slice.length})`,
        metadata: { count: slice.length, total: list.length },
        output: JSON.stringify(slice, null, 2),
      })
    },
  }),
)
