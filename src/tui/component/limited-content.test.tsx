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

// 常驻额度分账：常驻节点（prompt 输入框 / sidebar / which-key / dialog 浮层）
// 与消息内容共用同一张 65,535 的原生句柄表。此前常驻节点零记账，闸门只管
// 内容区——常驻节点把句柄表撑爆时，预算闸门一声不响。
describe("LimitedContent 常驻额度分账", () => {
  afterEach(() => {
    globalHandleBudget.reset()
  })

  it("scope=persistent 时占用常驻池，内容池保持空闲", async () => {
    globalHandleBudget.reset()
    const setup = await testRender(
      () => (
        <LimitedContent
          scope="persistent"
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
    expect(globalHandleBudget.persistentUsed()).toBeGreaterThan(0)
    expect(globalHandleBudget.used()).toBe(0)
    // 常驻池有余额 → 富渲染不被降级
    expect(setup.captureCharFrame()).toContain("RICH")

    // 卸载后必须把常驻额度还回去，否则常驻池会被死节点一点点吃光
    setup.renderer.destroy()
    await new Promise((r) => setTimeout(r, 30))
    expect(globalHandleBudget.persistentUsed()).toBe(0)
  }, 30_000)

  it("默认 scope=content 只占内容池，常驻池不动", async () => {
    globalHandleBudget.reset()
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
    expect(globalHandleBudget.used()).toBeGreaterThan(0)
    expect(globalHandleBudget.persistentUsed()).toBe(0)
  }, 30_000)

  it("常驻池耗尽时 scope=persistent 降级为纯文本", async () => {
    globalHandleBudget.reset()
    // 占满常驻池，常驻节点再挂载必然超限
    expect(globalHandleBudget.reservePersistent(globalHandleBudget.persistentLimit())).toBe(true)
    const setup = await testRender(
      () => (
        <LimitedContent
          scope="persistent"
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
    expect(frame).not.toContain("RICH")
    expect(frame).toContain("xxxx")
    // 内容池是独立的，常驻池耗尽不该牵连内容池
    expect(globalHandleBudget.used()).toBe(0)
  }, 30_000)
})
