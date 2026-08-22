import { describe, expect, it } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionEvent } from "./session-event"
import { DurableEventManifest } from "./durable-event-manifest"

const decode = <S extends Schema.Decoder<unknown>>(schema: S) => Schema.decodeUnknownSync(schema)

describe("SessionEvent new kinds", () => {
  it("declares the three new event types with sessionID durability", () => {
    expect(SessionEvent.CwdChanged.type).toBe("session.cwd")
    expect(SessionEvent.GoalUpdated.type).toBe("session.goal")
    expect(SessionEvent.InstructionsListed.type).toBe("session.instructions")
    expect(SessionEvent.CwdChanged.durable?.aggregate).toBe("sessionID")
    expect(SessionEvent.GoalUpdated.durable?.aggregate).toBe("sessionID")
    expect(SessionEvent.InstructionsListed.durable?.aggregate).toBe("sessionID")
  })

  it("registers the three events in the event inventories and durable manifest", () => {
    for (const type of ["session.cwd", "session.goal", "session.instructions"] as const) {
      expect(SessionEvent.DurableDefinitions.some((definition) => definition.type === type)).toBe(true)
      expect(SessionEvent.Definitions.some((definition) => definition.type === type)).toBe(true)
      // durable-event-manifest is generated from SessionEvent.DurableDefinitions
      expect(DurableEventManifest.Durable.has(`${type}.1`)).toBe(true)
    }
  })

  it("session.cwd wire payload carries the working directory", () => {
    const event = decode(SessionEvent.CwdChanged)({
      id: "evt_test_cwd",
      type: "session.cwd",
      data: {
        timestamp: 0,
        sessionID: "ses_test",
        cwd: "/workspace/project",
      },
    })
    expect(event.type).toBe("session.cwd")
    expect(String(event.data.sessionID)).toBe("ses_test")
    expect(event.data.cwd).toBe("/workspace/project")
    expect(DateTime.toEpochMillis(event.data.timestamp)).toBe(0)
  })

  it("session.goal wire payload carries the active goal and an impossible verdict", () => {
    const event = decode(SessionEvent.GoalUpdated)({
      id: "evt_test_goal_impossible",
      type: "session.goal",
      data: {
        timestamp: 0,
        sessionID: "ses_test",
        goal: { condition: "all tests pass" },
        lastVerdict: {
          ok: false,
          impossible: true,
          error: false,
          reason: "the condition is self-contradictory",
          attempt: 3,
          messageID: "msg_test",
        },
      },
    })
    expect(event.type).toBe("session.goal")
    expect(event.data.goal?.condition).toBe("all tests pass")
    expect(event.data.lastVerdict?.ok).toBe(false)
    expect(event.data.lastVerdict?.impossible).toBe(true)
    expect(event.data.lastVerdict?.error).toBe(false)
    expect(event.data.lastVerdict?.reason).toBe("the condition is self-contradictory")
    expect(event.data.lastVerdict?.attempt).toBe(3)
    expect(String(event.data.lastVerdict?.messageID)).toBe("msg_test")
  })

  it("session.goal last verdict records an evaluation error without claiming impossibility", () => {
    const event = decode(SessionEvent.GoalUpdated)({
      id: "evt_test_goal_error",
      type: "session.goal",
      data: {
        timestamp: 0,
        sessionID: "ses_test",
        goal: { condition: "all tests pass" },
        lastVerdict: {
          ok: false,
          impossible: false,
          error: true,
          reason: "goal evaluator failed after retry budget",
          attempt: 3,
        },
      },
    })
    expect(event.type).toBe("session.goal")
    expect(event.data.lastVerdict?.ok).toBe(false)
    expect(event.data.lastVerdict?.impossible).toBe(false)
    expect(event.data.lastVerdict?.error).toBe(true)
    expect(event.data.lastVerdict?.reason).toBe("goal evaluator failed after retry budget")
    expect(event.data.lastVerdict?.attempt).toBe(3)
  })

  it("session.goal wire payload allows a cleared goal (goal and lastVerdict optional)", () => {
    const event = decode(SessionEvent.GoalUpdated)({
      id: "evt_test_goal_clear",
      type: "session.goal",
      data: {
        timestamp: 0,
        sessionID: "ses_test",
      },
    })
    expect(event.data.goal).toBeUndefined()
    expect(event.data.lastVerdict).toBeUndefined()
  })

  it("session.instructions wire payload carries the listed files", () => {
    const event = decode(SessionEvent.InstructionsListed)({
      id: "evt_test_instructions",
      type: "session.instructions",
      data: {
        timestamp: 0,
        sessionID: "ses_test",
        files: ["AGENTS.md", "CLAUDE.md", "docs/guidelines.md"],
      },
    })
    expect(event.type).toBe("session.instructions")
    expect(String(event.data.sessionID)).toBe("ses_test")
    expect(event.data.files).toEqual(["AGENTS.md", "CLAUDE.md", "docs/guidelines.md"])
    expect(DateTime.toEpochMillis(event.data.timestamp)).toBe(0)
  })

  it("rejects session.cwd payload missing the required cwd field", () => {
    expect(() =>
      decode(SessionEvent.CwdChanged)({
        id: "evt_bad_cwd",
        type: "session.cwd",
        data: {
          timestamp: 0,
          sessionID: "ses_test",
        },
      }),
    ).toThrow()
  })

  it("rejects session.instructions payload missing the required files field", () => {
    expect(() =>
      decode(SessionEvent.InstructionsListed)({
        type: "session.instructions",
        data: {
          timestamp: 0,
          sessionID: "ses_test",
        },
      }),
    ).toThrow()
  })

  it("rejects a goal verdict missing the required reason", () => {
    expect(() =>
      decode(SessionEvent.GoalUpdated)({
        type: "session.goal",
        data: {
          timestamp: 0,
          sessionID: "ses_test",
          lastVerdict: { ok: true },
        },
      }),
    ).toThrow()
  })

  it("rejects a goal verdict with a negative attempt", () => {
    expect(() =>
      decode(SessionEvent.GoalUpdated)({
        type: "session.goal",
        data: {
          timestamp: 0,
          sessionID: "ses_test",
          lastVerdict: { ok: false, impossible: true, reason: "nope", attempt: -1 },
        },
      }),
    ).toThrow()
  })
})