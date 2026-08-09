import { afterEach, describe, expect, it } from "bun:test"
import { Effect, Schema } from "effect"
import { SessionEvent } from "@gyccode/schema/session-event"
import type { EventV2 } from "@gyccode/core/event"
import { SessionCwd } from "./session-cwd"
import { SessionID } from "./schema"
import { publishInstructionsListed } from "./instruction"

const ses = (id: string) => SessionID.descending("ses_" + id)

const run = (effect: Effect.Effect<void>) => Effect.runSync(effect)

const fakeEvents = (calls: Array<{ type: string; data: unknown }>): Pick<EventV2.Interface, "publish"> => ({
  publish: (definition, data) => {
    calls.push({ type: definition.type, data })
    return Effect.succeed(undefined as never)
  },
})

describe("SessionCwd.store", () => {
  afterEach(() => SessionCwd.reset())

  it("set/get/clear round-trip", () => {
    SessionCwd.set(ses("s1"), "/a/b")
    expect(SessionCwd.get(ses("s1"))).toBe("/a/b")
    SessionCwd.clear(ses("s1"))
    expect(SessionCwd.get(ses("s1"))).toBeUndefined()
  })
})

describe("SessionCwd.publish", () => {
  afterEach(() => SessionCwd.reset())

  it("publishes a session.cwd event when the value actually changed", () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published)

    run(SessionCwd.publishIfChanged(ses("p1"), "/workspace/project", events))

    expect(SessionCwd.get(ses("p1"))).toBe("/workspace/project")
    expect(published).toHaveLength(1)
    expect(published[0].type).toBe("session.cwd")
    const data = published[0].data as { sessionID: string; cwd: string }
    expect(data.sessionID).toBe("ses_p1")
    expect(data.cwd).toBe("/workspace/project")
  })

  it("does not publish again when the value is unchanged", () => {
    const published: Array<{ type: string; data: unknown }> = []
    run(SessionCwd.publishIfChanged(ses("p2"), "/a", fakeEvents(published)))
    run(SessionCwd.publishIfChanged(ses("p2"), "/a", fakeEvents(published)))

    expect(published).toHaveLength(1)
  })

  it("published payload decodes to the durable SessionEvent.CwdChanged wire shape", () => {
    const published: Array<{ type: string; data: unknown }> = []
    run(SessionCwd.publishIfChanged(ses("p3"), "/x/y", fakeEvents(published)))

    const data = published[0].data as { sessionID: string; cwd: string }
    const event = Schema.decodeUnknownSync(SessionEvent.CwdChanged)({
      id: "evt_test_cwd",
      type: "session.cwd",
      data: {
        timestamp: 0,
        sessionID: data.sessionID,
        cwd: data.cwd,
      },
    })
    expect(event.type).toBe("session.cwd")
    expect(event.data.cwd).toBe("/x/y")
  })
})

describe("InstructionsListed emitter", () => {
  it("publishes a session.instructions event carrying the resolved instruction files", () => {
    const calls: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(calls)

    run(publishInstructionsListed(events, ses("i1"), ["AGENTS.md", "CLAUDE.md", "docs/guidelines.md"]))

    expect(calls).toHaveLength(1)
    expect(calls[0].type).toBe("session.instructions")
    const data = calls[0].data as { sessionID: string; files: string[]; timestamp: unknown }
    expect(data.sessionID).toBe("ses_i1")
    expect(data.files).toEqual(["AGENTS.md", "CLAUDE.md", "docs/guidelines.md"])
    expect(data.timestamp).toBeDefined()
  })
})