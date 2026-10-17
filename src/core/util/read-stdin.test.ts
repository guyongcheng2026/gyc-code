import { execFileSync } from "child_process"
import { describe, expect, it, setDefaultTimeout } from "bun:test"

// 真起子进程读 stdin。2026-10-16 压力测试：并发负载下子进程调度慢，统一放宽
// 用例预算，避免把「慢」记成「错」。
setDefaultTimeout(30_000)

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

