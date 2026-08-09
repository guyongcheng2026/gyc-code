import { DateTime, Effect } from "effect"
import { SessionEvent } from "@gyccode/schema/session-event"
import type { EventV2 } from "@gyccode/core/event"
import type { SessionID } from "./schema"

/**
 * In-memory per-session working directory store + broadcast.
 *
 * bash (and any tool that changes the session working directory) pushes the
 * real execution cwd here after it runs; the in-memory store then serves the
 * live cwd for the active session and publishes a durable `session.cwd`
 * event when the value actually changed.
 *
 * Mirrors produce SessionCwd naming: each entry carries `directory` (the
 * instance/workspace root the session belongs to) and `cwd` (the effective
 * working directory override).
 */

export interface Entry {
  readonly directory: string
  readonly cwd: string
}

/** Narrow publish seam so tests can inject a fake event handle. */
export type SessionEventPublisher = Pick<EventV2.Interface, "publish">

const store = new Map<SessionID, Entry>()

export const get = (sessionID: SessionID): string | undefined => store.get(sessionID)?.cwd

export const set = (sessionID: SessionID, cwd: string, directory = ""): void => {
  store.set(sessionID, { directory, cwd })
}

export const clear = (sessionID: SessionID): void => {
  store.delete(sessionID)
}

/** Publish the durable `session.cwd` event carrying the working directory. */
export const publishCwdChanged = (
  events: SessionEventPublisher,
  sessionID: SessionID,
  cwd: string,
): Effect.Effect<void> =>
  Effect.gen(function* () {
    yield* events.publish(SessionEvent.CwdChanged, {
      sessionID,
      cwd,
      timestamp: yield* DateTime.now,
    })
  })

/** Store `cwd` and publish a `session.cwd` event only when the value actually changed. */
export const publishIfChanged = (
  sessionID: SessionID,
  cwd: string,
  events: SessionEventPublisher,
  directory = "",
): Effect.Effect<void> => {
  const previous = store.get(sessionID)?.cwd
  store.set(sessionID, { directory, cwd })
  if (previous === cwd) return Effect.void
  return publishCwdChanged(events, sessionID, cwd)
}

export const reset = (): void => {
  store.clear()
}

export * as SessionCwd from "./session-cwd"