import { describe, expect, it } from "vitest"
import { buildPromptParts } from "./useSendPrompt"

describe("buildPromptParts", () => {
  it("builds a text part for the given prompt", () => {
    const parts = buildPromptParts("你好")
    expect(parts).toEqual([{ type: "text", text: "你好" }])
  })
})
