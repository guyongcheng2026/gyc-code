import { describe, expect, it } from "bun:test"
import { formatCwd } from "./cwd"

describe("formatCwd", () => {
  it("prefers the session cwd over the project directory", () => {
    expect(formatCwd("/workspace/project/sub", "/workspace/project")).toBe("/workspace/project/sub")
  })

  it("falls back to the project directory when no cwd is tracked", () => {
    expect(formatCwd(undefined, "/workspace/project")).toBe("/workspace/project")
  })

  it("normalizes backslashes to forward slashes", () => {
    expect(formatCwd("C:\\proj\\src", undefined)).toBe("C:/proj/src")
  })

  it("returns an empty string when both are missing", () => {
    expect(formatCwd(undefined, undefined)).toBe("")
  })
})

describe("session.cwd adapter contract", () => {
  it("exposes a per-session cwd getter backed by the sync store", () => {
    const store = { session_cwd: { s1: "/workspace/project" } }
    const session = {
      cwd: (id: string) => store.session_cwd[id],
    }
    expect(session.cwd("s1")).toBe("/workspace/project")
    expect(session.cwd("missing")).toBeUndefined()
  })
})