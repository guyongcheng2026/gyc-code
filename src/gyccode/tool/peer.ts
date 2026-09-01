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

const INBOX_CAP = 500
// P0-1 修复：原版 inbox 是裸 Map，enqueue/read 内部使用 in-place push/splice。
// 现改为不可变更新（concat + slice 重建新数组）替代 in-place 修改：
//   1. 任何 reader 看到的 list 是不可变引用，不会读到「被改一半」的状态。
//   2. Set O(1) 替代 Array.includes O(n²)（P0-2）。
// 注：peer.execute 是同步无 await，JS 单线程事件循环下 get→set 序列本身原子；
// 不可变更新主要价值是消除「读到 list 内部状态被并发修改」的隐性耦合。
const inbox: { current: Map<string, PeerMessage[]> } = { current: new Map() }

function enqueue(msg: PeerMessage) {
  const list = (inbox.current.get(msg.to) ?? []).concat([msg]).slice(-INBOX_CAP)
  inbox.current.set(msg.to, list)
}

function readMessages(target: string, from: string | undefined, limit: number, markRead: boolean): PeerMessage[] {
  const list = inbox.current.get(target) ?? []
  const matched = list.filter((m) => !from || m.from === from)
  const slice = matched.slice(-limit)
  if (markRead && slice.length > 0) {
    const sliceSet = new Set(slice)
    inbox.current.set(target, list.map((m) => (sliceSet.has(m) ? { ...m, read: true } : m)))
  }
  return slice
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
      // R1-3 修复：to 字段也做非空校验，避免 inbox 出现 "" 空 key 桶
      if (params.content.length === 0 || params.to.length === 0) {
        return Effect.succeed({
          title: "peer_send failed",
          metadata: { error: "to and content must be non-empty" },
          output: "Error: peer_send: to and content must be non-empty",
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
      const target = params.to ?? ctx.sessionID
      const limit = params.limit ?? 20
      const markRead = params.mark_read ?? true
      const slice = readMessages(target, params.from, limit, markRead)
      return Effect.succeed({
        title: `peer_read (${slice.length})`,
        metadata: { count: slice.length, target },
        output: JSON.stringify(slice, null, 2),
      })
    },
  }),
)
