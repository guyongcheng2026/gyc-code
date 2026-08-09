import type { Event } from "@opencode-ai/sdk/v2"
import { useSDK } from "./sdk"

type EventMetadata = {
  directory: string
  workspace: string | undefined
}

/** Custom durable session event carrying the working directory (not part of the SDK union). */
export type SessionCwdEvent = {
  id: string
  type: "session.cwd"
  properties: {
    timestamp: number
    sessionID: string
    cwd: string
  }
}

/** Custom durable session event listing the instruction files in play (not part of the SDK union). */
export type SessionInstructionsEvent = {
  id: string
  type: "session.instructions"
  properties: {
    timestamp: number
    sessionID: string
    files: string[]
  }
}

/** Custom durable session event carrying the active goal + latest judge verdict (not part of the SDK union). */
export type SessionGoalEvent = {
  id: string
  type: "session.goal"
  properties: {
    timestamp: number
    sessionID: string
    goal?: { condition: string }
    lastVerdict?: {
      ok: boolean
      impossible?: boolean
      error?: boolean
      reason: string
      attempt: number
    }
  }
}

type RuntimeEvent = Event | SessionCwdEvent | SessionInstructionsEvent | SessionGoalEvent

export function useEvent() {
  const sdk = useSDK()

  function subscribe(handler: (event: RuntimeEvent, metadata: EventMetadata) => void) {
    return sdk.event.on("event", (event) => {
      if (event.payload.type === "sync") {
        return
      }

      handler(event.payload as RuntimeEvent, { directory: event.directory, workspace: event.workspace })
    })
  }

  function on<T extends Event["type"]>(
    type: T,
    handler: (event: Extract<Event, { type: T }>, metadata: EventMetadata) => void,
  ) {
    return subscribe((event: RuntimeEvent, metadata: EventMetadata) => {
      if (event.type !== type) return
      handler(event as Extract<Event, { type: T }>, metadata)
    })
  }

  return {
    subscribe,
    on,
  }
}