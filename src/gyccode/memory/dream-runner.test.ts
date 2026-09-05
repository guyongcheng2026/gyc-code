import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { maybeDream } from "./dream-runner"

describe("maybeDream", () => {
  it("does not dream below thresholds; returns advanced state", async () => {
    let synthesized = false
    let written: string | undefined
    const next = await Effect.runPromise(
      maybeDream({
        state: { lastDreamAt: 0, sessionsSinceDream: 3, memoryCount: 0 },
        memoryCount: 10,
        memories: "m1\nm2",
        synthesizer: ({ prompt }) =>
          Effect.sync(() => {
            synthesized = true
            return "# summary"
          }),
        writeMemory: (v) =>
          Effect.sync(() => {
            written = v
          }),
      }),
    )
    expect(synthesized).toBe(false)
    expect(written).toBeUndefined()
    expect(next.sessionsSinceDream).toBe(4)
    expect(next.lastDreamAt).toBe(0)
  })

  it("dreams when session threshold is met; resets state and persists summary", async () => {
    let written: string | undefined
    const next = await Effect.runPromise(
      maybeDream({
        state: { lastDreamAt: 0, sessionsSinceDream: 4, memoryCount: 0 },
        memoryCount: 10,
        memories: "m1\nm2",
        // 这些单测注入的是最小化伪 LLM 输出，不满足真实校验门，故测非校验路径
        useValidation: false,
        synthesizer: ({ prompt }) =>
          Effect.sync(() => {
            expect(prompt).toContain("m1")
            return "## Key Learnings\n- a\n\n## Action Items\n- b"
          }),
        writeMemory: (v) =>
          Effect.sync(() => {
            written = v
          }),
      }),
    )
    expect(written).toBeDefined()
    expect(written).toContain("Key Learnings")
    expect(next.lastDreamAt).toBeGreaterThan(0)
    expect(next.sessionsSinceDream).toBe(0)
  })

  it("dreams when hours elapsed since last dream, even with few sessions", async () => {
    const longAgo = Date.now() - 25 * 60 * 60 * 1000
    let written: string | undefined
    const next = await Effect.runPromise(
      maybeDream({
        state: { lastDreamAt: longAgo, sessionsSinceDream: 0, memoryCount: 0 },
        memoryCount: 10,
        memories: "m",
        // 伪输出不满足真实校验门，测非校验路径
        useValidation: false,
        synthesizer: () => Effect.sync(() => "## Topic Clusters\n- x"),
        writeMemory: (v) =>
          Effect.sync(() => {
            written = v
          }),
      }),
    )
    expect(written).toBeDefined()
    expect(next.sessionsSinceDream).toBe(0)
  })
})