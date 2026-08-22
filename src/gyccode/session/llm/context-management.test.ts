import { describe, expect, it } from "bun:test"
import {
  CONTEXT_MANAGEMENT_BETA_HEADER,
  contextManagementBetaHeader,
  contextManagementEdits,
  contextManagementOptions,
} from "./context-management"

describe("CONTEXT_MANAGEMENT_BETA_HEADER", () => {
  it("is the context-management beta", () => {
    expect(CONTEXT_MANAGEMENT_BETA_HEADER).toBe("context-management-2025-06-27")
  })
})

describe("contextManagementEdits", () => {
  it("returns undefined when disabled", () => {
    expect(contextManagementEdits({ enabled: false })).toBeUndefined()
  })
  it("builds clear_thinking edit", () => {
    const edits = contextManagementEdits({ enabled: true, clear_thinking: true, thinking_turns: 1 })
    expect(edits).toEqual([
      { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 1 } },
    ])
  })
  it("defaults clear_thinking to on", () => {
    const edits = contextManagementEdits({ enabled: true, clear_tool_uses: true, thinking_turns: 2 })
    expect(edits).toEqual([
      { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 2 } },
      {
        type: "clear_tool_uses_20250919",
        trigger: { type: "input_tokens", value: 180000 },
        clearAtLeast: { type: "input_tokens", value: 140000 },
      },
    ])
  })
  it("builds clear_tool_uses edit with trigger", () => {
    const edits = contextManagementEdits({
      enabled: true,
      clear_thinking: false,
      clear_tool_uses: true,
      trigger_threshold: 180000,
      keep_target: 40000,
    })
    expect(edits).toEqual([
      {
        type: "clear_tool_uses_20250919",
        trigger: { type: "input_tokens", value: 180000 },
        clearAtLeast: { type: "input_tokens", value: 140000 },
      },
    ])
  })
  it("omits excludeTools since no config path populates it", () => {
    const edits = contextManagementEdits({ enabled: true, clear_thinking: false, clear_tool_uses: true })
    expect(edits![0]).not.toHaveProperty("excludeTools")
  })
  it("combines both edits", () => {
    const edits = contextManagementEdits({
      enabled: true,
      clear_thinking: true,
      clear_tool_uses: true,
      thinking_turns: 2,
      trigger_threshold: 200000,
      keep_target: 50000,
    })
    expect(edits).toHaveLength(2)
    expect(edits![0]!.type).toBe("clear_thinking_20251015")
    expect(edits![1]!.type).toBe("clear_tool_uses_20250919")
  })
  it("returns undefined when both clears disabled", () => {
    expect(contextManagementEdits({ enabled: true, clear_thinking: false, clear_tool_uses: false })).toBeUndefined()
  })
})

describe("contextManagementBetaHeader", () => {
  it("merges when enabled and anthropic", () => {
    expect(contextManagementBetaHeader(undefined, true, true)).toBe(CONTEXT_MANAGEMENT_BETA_HEADER)
    expect(contextManagementBetaHeader("interleaved-thinking-2025-05-14", true, true)).toBe(
      `interleaved-thinking-2025-05-14,${CONTEXT_MANAGEMENT_BETA_HEADER}`,
    )
    expect(contextManagementBetaHeader(CONTEXT_MANAGEMENT_BETA_HEADER, true, true)).toBe(CONTEXT_MANAGEMENT_BETA_HEADER)
  })
  it("returns existing unchanged when disabled or non-anthropic", () => {
    expect(contextManagementBetaHeader("x", false, true)).toBe("x")
    expect(contextManagementBetaHeader("x", true, false)).toBe("x")
    expect(contextManagementBetaHeader(undefined, false, false)).toBeUndefined()
  })
})

describe("contextManagementOptions", () => {
  it("returns edits when enabled", () => {
    const o = contextManagementOptions({ enabled: true, clear_thinking: false, clear_tool_uses: true })
    expect(o?.contextManagement.edits[0]!.type).toBe("clear_tool_uses_20250919")
  })
  it("returns undefined when disabled", () => {
    expect(contextManagementOptions({ enabled: false })).toBeUndefined()
  })
  it("returns undefined when enabled but both clears are disabled (no edits -> no beta header)", () => {
    expect(contextManagementOptions({ enabled: true, clear_thinking: false, clear_tool_uses: false })).toBeUndefined()
  })
})
