import { Schema } from "effect"
import { Event } from "./event"

// 会话状态与运行时实际发布/存储的形状严格对齐（processor/run-state 经
// status.set 写入、TUI/Web 按 .type 消费）：
//   { type: "idle" } | { type: "busy" }
//   | { type: "retry"; attempt; message; action?; next }
const ActionInfo = Schema.Struct({
  reason: Schema.String,
  provider: Schema.String,
  title: Schema.String,
  message: Schema.String,
  label: Schema.String,
  link: Schema.optional(Schema.String),
}).annotate({ identifier: "SessionStatusAction" })

const StatusUnion = Schema.Union([
  Schema.Struct({ type: Schema.Literal("idle") }).annotate({ identifier: "SessionStatusIdle" }),
  Schema.Struct({ type: Schema.Literal("busy") }).annotate({ identifier: "SessionStatusBusy" }),
  Schema.Struct({
    type: Schema.Literal("retry"),
    attempt: Schema.Number,
    message: Schema.String,
    action: Schema.optional(ActionInfo),
    next: Schema.Number,
  }).annotate({ identifier: "SessionStatusRetry" }),
])

const Idle = Event.define({ type: "session.idle", schema: { sessionID: Schema.String } })
const Busy = Event.define({ type: "session.busy", schema: { sessionID: Schema.String } })
const Status = Event.define({ type: "session.status", schema: { sessionID: Schema.String, status: StatusUnion } })

const Definitions = Event.inventory(Idle, Busy, Status)

export const SessionStatusEvent = {
  Info: StatusUnion,
  Definitions,
  Idle,
  Busy,
  Status,
}

export type Info = Schema.Schema.Type<typeof SessionStatusEvent.Info>
export type Definitions = typeof Definitions
