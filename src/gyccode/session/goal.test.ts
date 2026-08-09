import { afterEach, describe, expect, it } from "bun:test"
import { Effect, Schema } from "effect"
import { SessionEvent } from "@gyccode/schema/session-event"
import type { EventV2 } from "@gyccode/core/event"
import { Goal } from "./goal"
import { SessionID } from "./schema"
import { disposeInstance } from "../effect/instance-registry"

const ses = (id: string) => SessionID.descending("ses_" + id)

const fakeEvents = (calls: Array<{ type: string; data: unknown }>): Pick<EventV2.Interface, "publish"> => ({
  publish: (definition, data) => {
    calls.push({ type: definition.type, data })
    return Effect.succeed(undefined as never)
  },
})

describe("Goal", () => {
  afterEach(() => Goal.reset())

  it("set/get/clear/evaluate with a fake judge (no LLM)", async () => {
    const svc = Goal.fake({ verdict: { ok: true, reason: "x" } })
    await svc.set(ses("s1"), "task done")
    expect(svc.get(ses("s1"))?.condition).toBe("task done")
    const v = await svc.evaluate({ sessionID: ses("s1") })
    expect(v.ok).toBe(true)
    expect(v.reason).toBe("x")
    expect(v.attempt).toBe(1)
    svc.clear(ses("s1"))
    expect(svc.get(ses("s1"))).toBeUndefined()
  })

  it("bumpReact increments the per-session react counter", async () => {
    const svc = Goal.fake()
    await svc.set(ses("r1"), "run the build")
    expect(svc.bumpReact(ses("r1"))).toBe(1)
    expect(svc.bumpReact(ses("r1"))).toBe(2)
    expect(svc.get(ses("r1"))?.react).toBe(2)
  })

  it("evaluate rejects when no goal is active", async () => {
    const svc = Goal.fake({ verdict: { ok: true, reason: "x" } })
    await expect(svc.evaluate({ sessionID: ses("none") })).rejects.toThrow(/no active goal/i)
  })
})

describe("Goal.publish", () => {
  afterEach(() => Goal.reset())

  it("set publishes a session.goal event carrying the condition", async () => {
    const published: Array<{ type: string; data: unknown }> = []
    const events = fakeEvents(published)
    const svc = Goal.make({ events, judge: () => Effect.succeed({ ok: true, reason: "x" }) })

    await svc.set(ses("p1"), "task done")

    expect(published).toHaveLength(1)
    expect(published[0].type).toBe("session.goal")
    const data = published[0].data as { sessionID: string; goal: { condition: string }; lastVerdict?: unknown }
    expect(data.sessionID).toBe("ses_p1")
    expect(data.goal.condition).toBe("task done")
    expect(data.lastVerdict).toBeUndefined()
  })

  it("evaluate publishes a session.goal event with the judge verdict", async () => {
    const published: Array<{ type: string; data: unknown }> = []
    const svc = Goal.make({
      events: fakeEvents(published),
      judge: () => Effect.succeed({ ok: false, reason: "not satisfied" }),
    })

    await svc.set(ses("p2"), "ship it")
    const verdict = await svc.evaluate({ sessionID: ses("p2") })

    expect(verdict.ok).toBe(false)
    expect(verdict.attempt).toBe(1)
    expect(published).toHaveLength(2)
    const last = published[1] as {
      type: string
      data: { goal: { condition: string }; lastVerdict: { ok: boolean; attempt: number } }
    }
    expect(last.type).toBe("session.goal")
    expect(last.data.goal.condition).toBe("ship it")
    expect(last.data.lastVerdict.ok).toBe(false)
    expect(last.data.lastVerdict.attempt).toBe(1)
  })

  it("evaluate re-publishes only when the verdict actually changed", async () => {
    const published: Array<{ type: string; data: unknown }> = []
    const svc = Goal.make({
      events: fakeEvents(published),
      judge: () => Effect.succeed({ ok: false, reason: "still working" }),
    })

    await svc.set(ses("p2"), "ship it")
    await svc.evaluate({ sessionID: ses("p2") })
    await svc.evaluate({ sessionID: ses("p2") })

    // set + first evaluate publish; the second (unchanged) evaluate does not.
    expect(published).toHaveLength(2)
    expect(svc.get(ses("p2"))?.lastVerdict?.attempt).toBe(2)
  })

  it("published payload decodes to the durable SessionEvent.GoalUpdated wire shape", async () => {
    const published: Array<{ type: string; data: unknown }> = []
    const svc = Goal.make({ events: fakeEvents(published), judge: () => Effect.succeed({ ok: true, reason: "d" }) })

    await svc.set(ses("p3"), "task done")

    const data = published[0].data as { sessionID: string; goal: { condition: string } }
    const event = Schema.decodeUnknownSync(SessionEvent.GoalUpdated)({
      id: "evt_test_goal",
      type: "session.goal",
      data: {
        timestamp: 0,
        sessionID: data.sessionID,
        goal: data.goal,
      },
    })
    expect(event.type).toBe("session.goal")
    expect(event.data.goal?.condition).toBe("task done")
  })
})

describe("Goal.lifecycle", () => {
  afterEach(() => Goal.reset())

  it("drops all goals that belong to a disposed instance directory", async () => {
    const svc = Goal.fake()
    await svc.set(ses("l1"), "a", "/root")
    await svc.set(ses("l2"), "b", "/root")
    await svc.set(ses("l3"), "c", "/other")

    expect(svc.get(ses("l1"))?.condition).toBe("a")

    await disposeInstance("/root")

    expect(svc.get(ses("l1"))).toBeUndefined()
    expect(svc.get(ses("l2"))).toBeUndefined()
    expect(svc.get(ses("l3"))?.condition).toBe("c")
  })
})