import { describe, expect, it } from "bun:test"
import { abbreviateInstruction } from "./instructions"

describe("abbreviateInstruction", () => {
  it("strips the project-relative prefix", () => {
    expect(abbreviateInstruction("/workspace/project/AGENTS.md", "/workspace/project")).toBe("AGENTS.md")
  })

  it("keeps nested relative paths", () => {
    expect(abbreviateInstruction("/workspace/project/docs/CLAUDE.md", "/workspace/project")).toBe("docs/CLAUDE.md")
  })

  it("normalizes backslashes to forward slashes", () => {
    expect(abbreviateInstruction("C:\\proj\\AGENTS.md", undefined)).toBe("C:/proj/AGENTS.md")
  })

  it("returns the full path when no project dir is known", () => {
    expect(abbreviateInstruction("/abs/path/.cursorrules", undefined)).toBe("/abs/path/.cursorrules")
  })
})

describe("session.instructions adapter contract", () => {
  it("exposes a per-session instructions getter backed by the sync store", () => {
    const store = { session_instructions: { s1: ["AGENTS.md", "CLAUDE.md"] } }
    const session = {
      instructions: (id: string) => store.session_instructions[id] ?? [],
    }
    expect(session.instructions("s1")).toEqual(["AGENTS.md", "CLAUDE.md"])
    expect(session.instructions("missing")).toEqual([])
  })
})