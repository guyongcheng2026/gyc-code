import { describe, test, expect } from "bun:test"
import { IDETransport } from "./transport-ide"

describe("IDETransport.getEditorCommand", () => {
  const transport = new IDETransport({ editor: "vscode", port: 1234, extensionId: "test" })

  test("builds a normal vscode goto command with quoted file", () => {
    const cmd = transport.getEditorCommand("goto", { file: "/tmp/a.ts", line: 5, column: 3 })
    expect(cmd).toBe("code --goto '/tmp/a.ts:5:3'")
  })

  test("single-quotes file so shell metacharacters stay literal", () => {
    const cmd = transport.getEditorCommand("goto", { file: 'a"; rm -rf ~', line: "1", column: "1" })
    expect(cmd.startsWith("code --goto '")).toBe(true)
    expect(cmd.endsWith("'")).toBe(true)
  })

  test("escapes embedded single quotes in the file argument", () => {
    const cmd = transport.getEditorCommand("goto", { file: "a';rm -rf /", line: "1", column: "1" })
    expect(cmd).toContain("'\\''")
  })

  test("coerces non-numeric line/column to a safe fallback", () => {
    const cmd = transport.getEditorCommand("goto", { file: "/tmp/a.ts", line: "abc", column: "x;echo pwned" })
    expect(cmd).toBe("code --goto '/tmp/a.ts:1:1'")
  })
})