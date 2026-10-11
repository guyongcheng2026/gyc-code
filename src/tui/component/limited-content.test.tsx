import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { RGBA } from "@opentui/core"
import { testRender } from "@opentui/solid"
import { LimitedContent } from "./limited-content"
import { globalHandleBudget } from "../util/handle-budget"
import { installTuiErrorAuditSink } from "../util/error-audit-sink"

// 回归：预算耗尽导致的降级必须留痕。
// 此前 handleBudgetPressure 只有定义与单测、没有生产调用点（死代码），
// 「内容预算被吃满、富渲染静默降级为纯文本」在运行期完全不可见。
describe("LimitedContent 预算降级可观测性", () => {
  const dirs: string[] = []
  afterEach(() => {
    globalHandleBudget.reset()
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
  })

  it("预算耗尽时降级为纯文本并写入审计日志", async () => {
    const dir = mkdtempSync(path.join(tmpdir(), "gyc-hb-"))
    dirs.push(dir)
    const file = path.join(dir, "gyccode.log")
    const uninstall = installTuiErrorAuditSink(file)

    globalHandleBudget.reset()
    // 占满全部内容预算，使后续 reserve 必然失败
    expect(globalHandleBudget.reserve(globalHandleBudget.limit())).toBe(true)

    const setup = await testRender(
      () => (
        <LimitedContent
          text={"x".repeat(200)}
          cols={40}
          plainColor={RGBA.fromHex("#ffffff")}
          rich={(text) => <text>{`RICH:${text.slice(0, 4)}`}</text>}
          plain={(text) => <text>{`PLAIN:${text.slice(0, 4)}`}</text>}
        />
      ),
      { width: 40, height: 4 },
    )
    await setup.flush()
    const frame = setup.captureCharFrame()
    // 预算不足 → 走内部逐行 fallback（不调用 props.rich），富渲染分支必须缺席
    expect(frame).toContain("xxxx")
    expect(frame).not.toContain("RICH")

    await new Promise((r) => setTimeout(r, 30))
    const log = readFileSync(file, "utf8")
    expect(log).toContain("内容句柄预算不足")
    expect(log).toContain("tui.handle-budget")
    uninstall()
  }, 30_000)
})
