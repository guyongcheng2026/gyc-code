import { execFileSync } from "child_process"
import { describe, expect, it } from "bun:test"

const url = "file://" + import.meta.dir.replace(/\\/g, "/") + "/read-stdin.ts"
const script = `
import { readStdin } from "${url}"
process.stdout.write(await readStdin())
`
describe("readStdin", () => {
  it("reads piped utf8 stdin to end", () => {
    const out = execFileSync(process.execPath, ["-e", script], { input: "hello\nworld" })
    expect(out.toString()).toBe("hello\nworld")
  })
  it("returns empty string for empty stdin", () => {
    const out = execFileSync(process.execPath, ["-e", script], { input: "" })
    expect(out.toString()).toBe("")
  })
})

