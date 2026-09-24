import { EventEmitter } from "events"
import { Identifier } from "@/id/id"

export interface BaseEventPayload {
  id?: string
  syncEvent?: { id: string }
  [key: string]: unknown
}

export interface SessionEventPayload extends BaseEventPayload {
  type: "session"
  sessionId?: string
  action?: string
}

export interface ProviderEventPayload extends BaseEventPayload {
  type: "provider"
  providerId?: string
  action?: string
}

export interface UpdateEventPayload extends BaseEventPayload {
  type: "update"
  version?: string
}

export type GlobalEventPayload =
  | SessionEventPayload
  | ProviderEventPayload
  | UpdateEventPayload
  | BaseEventPayload

export type GlobalEvent = {
  directory?: string
  project?: string
  workspace?: string
  payload: GlobalEventPayload
}

class GlobalBusEmitter extends EventEmitter {
  override emit(eventName: string | symbol, ...args: unknown[]): boolean {
    if (eventName === "event") {
      const event = args[0] as GlobalEvent | undefined
      if (event?.payload && typeof event.payload === "object" && !("id" in event.payload)) {
        event.payload.id = event.payload.syncEvent?.id ?? Identifier.create("evt", "ascending")
      }
    }
    return super.emit(eventName, ...args)
  }
}

export const GlobalBus = new GlobalBusEmitter()