import { describe, expect, it } from "bun:test"
import { classifyCommand } from "./security"

describe("classifyCommand", () => {
  it("marks plain safe commands as safe", () => {
    const c = classifyCommand("ls -la")
    expect(c.level).toBe("safe")
    expect(c.patterns).toHaveLength(0)
  })

  it("blocks rm on the root filesystem", () => {
    expect(classifyCommand("rm -rf /").level).toBe("blocked")
    expect(classifyCommand("rm  -rf  /").level).toBe("blocked")
  })

  it("blocks rm -rf / even with backslash escapes", () => {
    expect(classifyCommand("rm\\ -rf\\ /").level).toBe("blocked")
  })

  it("detects eval/exec even when escaped with backslashes", () => {
    const c = classifyCommand("e\\val echo hi")
    expect(c.patterns).toContain("evalExec")
    expect(c.level).toBe("dangerous")
  })

  it("detects curl | bash even when escaped", () => {
    const c = classifyCommand("c\\u\\r\\l -sS http://x | b\\ash")
    expect(c.patterns).toContain("curlPipeBash")
    expect(c.level).toBe("dangerous")
  })

  it("detects dd if= even when escaped", () => {
    const c = classifyCommand("d\\d if=/dev/zero of=/dev/sda")
    expect(c.patterns).toContain("ddIf")
  })

  it("does not flag a literal string inside single quotes", () => {
    expect(classifyCommand("echo 'e\\val'").level).toBe("safe")
  })
})

