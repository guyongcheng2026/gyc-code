import { describe, expect, it } from "bun:test"
import { DateTime, Schema } from "effect"
import { SessionEvent } from "./session-event"

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

  it("session.goal wire payload carries the active goal and last verdict", () => {
    const event = decode(SessionEvent.GoalUpdated)({
      id: "evt_test_goal",
      type: "session.goal",
      data: {
        timestamp: 0,
        sessionID: "ses_test",
        goal: { condition: "all tests pass" },
        lastVerdict: {
          ok: false,
          impossible: true,
          reason: "the condition is self-contradictory",
          attempt: 3,
          messageID: "msg_test",
          error: true,
        },
      },
    })
    expect(event.type).toBe("session.goal")
    expect(event.data.goal?.condition).toBe("all tests pass")
    expect(event.data.lastVerdict?.ok).toBe(false)
    expect(event.data.lastVerdict?.impossible).toBe(true)
    expect(event.data.lastVerdict?.reason).toBe("the condition is self-contradictory")
    expect(event.data.lastVerdict?.attempt).toBe(3)
    expect(String(event.data.lastVerdict?.messageID)).toBe("msg_test")
    expect(event.data.lastVerdict?.error).toBe(true)
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
})
