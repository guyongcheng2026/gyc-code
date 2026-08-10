import { describe, expect, it } from "bun:test"
import { CONTEXT_MANAGEMENT_BETA_HEADER, contextManagementEdits } from "./context-management"

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
  it("builds clear_tool_uses edit with trigger", () => {
    const edits = contextManagementEdits({
      enabled: true,
      clear_tool_uses: true,
      trigger_threshold: 180000,
      keep_target: 40000,
    })
    expect(edits).toEqual([
      {
        type: "clear_tool_uses_20250919",
        trigger: { type: "token_threshold", value: 180000 },
        clear_at_least: { type: "token_count", value: 140000 },
        exclude_tools: [],
      },
    ])
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