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

// F2-P0 修复：原版用模块级 messageCounter (++) + Map 内部 push/splice
// 是非原子的，多 fiber 并发下 ID 碰撞、list 元素丢失。改用：
//   1. crypto.randomUUID() 生成 ID，零碰撞风险
//   2. 不可变 .concat().slice(-500) 替代 in-place push/splice，
//      虽仍是 Map.set，但不再依赖旧的数组引用
const inbox = new Map<string, PeerMessage[]>()

function enqueue(msg: PeerMessage) {
  const list = (inbox.get(msg.to) ?? []).concat([msg]).slice(-500)
  inbox.set(msg.to, list)
}

const SendInput = Schema.Struct({
  to: Schema.String.annotate({ description: "Recipient handle (sessionID, agent name, or any string identifier)." }),
  content: Schema.String.annotate({ description: "Message content to deliver." }),
})

const ReadInput = Schema.Struct({
  from: Schema.optional(Schema.String).annotate({ description: "Optional sender filter; only return messages from this handle." }),
  to: Schema.optional(Schema.String).annotate({ description: "Optional recipient filter; only return messages addressed to this handle (default: this session)." }),
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
      // P2-14 修复：运行时非空校验（Schema 4.0 缺 minLength，故下沉到 execute 层）
      if (params.content.length === 0) {
        return Effect.succeed({
          title: "peer_send failed",
          metadata: { error: "content must be non-empty" },
          output: "Error: peer_send: content must be non-empty",
        })
      }
      const msg: PeerMessage = {
        id: crypto.randomUUID(),
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
      // P1-9 修复：增加 to 过滤器，允许查询发件箱或特定收件人
      const target = params.to ?? ctx.sessionID
      const list = (inbox.get(target) ?? []).filter((m) => !params.from || m.from === params.from)
      const limit = params.limit ?? 20
      const slice = list.slice(-limit)
      // P1-8 + P2-15 修复：mark_read 默认 true（P1-8 注释保留 Schema 行为一致性）；
      // 不可变标记而非 in-place 遍历
      const markRead = params.mark_read ?? true
      if (markRead) {
        const updated = list.map((m) => (slice.includes(m) ? { ...m, read: true } : m))
        inbox.set(target, updated)
      }
      return Effect.succeed({
        title: `peer_read (${slice.length})`,
        metadata: { count: slice.length, total: list.length, target },
        output: JSON.stringify(slice, null, 2),
      })
    },
  }),
)
