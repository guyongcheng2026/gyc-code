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

type RuntimeEvent = Event | SessionCwdEvent

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