import { Schema } from "effect"
import { Event } from "./event"

const StatusLiterals = [
  Schema.Literal("idle"),
  Schema.Literal("busy"),
  Schema.Literal("working"),
  Schema.Literal("waiting"),
  Schema.Literal("error"),
] as const

const StatusUnion = Schema.Union(StatusLiterals)

const Idle = Event.define({ type: "session.idle", schema: { sessionID: Schema.String } })
const Busy = Event.define({ type: "session.busy", schema: { sessionID: Schema.String } })
const Status = Event.define({ type: "session.status", schema: { sessionID: Schema.String, status: StatusUnion } })

const Definitions = Event.inventory(Idle, Busy, Status)

export const SessionStatusEvent = {
  Info: Schema.Struct({
    sessionID: Schema.String,
    status: StatusUnion,
    updatedAt: Schema.Number,
  }),
  Definitions,
  Idle,
  Busy,
  Status,
}

export type Info = Schema.Schema.Type<typeof SessionStatusEvent.Info>
export type Definitions = typeof Definitions