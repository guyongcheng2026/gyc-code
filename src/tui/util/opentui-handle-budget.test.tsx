import { describe, expect, it } from "bun:test"
import { For, Show } from "solid-js"
import { SyntaxStyle, TextBuffer, resolveRenderLib } from "@opentui/core"
import { testRender } from "@opentui/solid"

/**
 * 原生句柄泄漏回归测试。
 *
 * 立项背景：gyccode.log 在 2026-10-07T01:06Z（opentui 0.5.14、node dist、主进程）
 * 出现 `Failed to create TextBuffer` 并降级退出。virtual-window.ts:23-28 记载
 * 原生句柄表上限 65,535，第 65,535 次 createTextBuffer 即返回无效句柄。
 * 历史上一份仓库外的 handle-probe 埋点记录 textCreated 远大于 destroyed，
 * 疑似 reconciler 泄漏，但该埋点不在版本库内、无法复核。
 *
 * 本测试用原生分配器的 activeAllocations 作为「句柄是否归还」的判据，分两部分：
 *   1. 标定——故意泄漏 N 个 TextBuffer 再 destroy，证明该指标确实跟随分配变化。
 *      没有这一步，后面的阴性结论等于没测（指标不灵敏则测不出问题）。
 *   2. 逐路径实测——流式改写、条件渲染、列表增减，断言增量不显著为正。
 *
 * 实测基线（0.5.14）：标定 50 个 → +138、destroy 后归零；流式 300 轮 → -5；
 * 条件 200 轮 → +3；列表 100 轮 → +1。阈值取 20，留有充足余量。
 */
describe("opentui 原生句柄归还", () => {
  it("标定：activeAllocations 跟随 TextBuffer 分配，destroy 后回落", () => {
    const lib = resolveRenderLib()
    const before = lib.getAllocatorStats().activeAllocations

    const leaked: TextBuffer[] = []
    for (let i = 0; i < 50; i++) leaked.push(TextBuffer.create("unicode" as never))

    const after = lib.getAllocatorStats().activeAllocations
    // 实测单个 TextBuffer 约 4 个原生分配，故 50 个应远大于 50。
    expect(after - before).toBeGreaterThanOrEqual(50)

    for (const b of leaked) b.destroy()
    expect(lib.getAllocatorStats().activeAllocations).toBeLessThanOrEqual(before + 5)
  })

  it("流式改写 markdown 内容不累积句柄", async () => {
    const style = SyntaxStyle.create()
    let content = ""
    const setup = await testRender(() => (
      <box>
        <markdown content={content} syntaxStyle={style} streaming={true} />
      </box>
    ), { width: 80, height: 24 })

    const lib = resolveRenderLib()
    const before = lib.getAllocatorStats().activeAllocations
    const ROUNDS = 300
    for (let i = 0; i < ROUNDS; i++) {
      content = `# 标题 ${i}\n\n段落 ${i}，带 **粗体** 与 \`代码\`。\n\n- 甲\n- 乙\n\n| 列 A | 列 B |\n| --- | --- |\n| ${i} | x |`
      await setup.renderOnce()
    }
    const delta = lib.getAllocatorStats().activeAllocations - before
    console.log(`[句柄] 流式改写 ${ROUNDS} 轮: 增量 ${delta}`)
    expect(delta).toBeLessThan(20)
  }, 60_000)

  it("条件渲染在空文本与有文本间切换不累积句柄", async () => {
    const style = SyntaxStyle.create()
    let show = false
    const setup = await testRender(() => (
      <box>
        <Show when={show} fallback={<text>{""}</text>}>
          <markdown content={"内容段落，带 **粗体**。"} syntaxStyle={style} />
        </Show>
      </box>
    ), { width: 80, height: 24 })

    const lib = resolveRenderLib()
    const before = lib.getAllocatorStats().activeAllocations
    const ROUNDS = 200
    for (let i = 0; i < ROUNDS; i++) {
      show = i % 2 === 0
      await setup.renderOnce()
    }
    const delta = lib.getAllocatorStats().activeAllocations - before
    console.log(`[句柄] 条件切换 ${ROUNDS} 轮: 增量 ${delta}`)
    expect(delta).toBeLessThan(20)
  }, 60_000)

  it("列表项数量增减不累积句柄", async () => {
    const style = SyntaxStyle.create()
    let items = 1
    const setup = await testRender(() => (
      <box>
        <For each={Array.from({ length: items }, (_, i) => i)}>
          {(i) => <markdown content={`条目 ${i}，含 **粗体** 与 \`代码\`。`} syntaxStyle={style} />}
        </For>
      </box>
    ), { width: 80, height: 24 })

    const lib = resolveRenderLib()
    const before = lib.getAllocatorStats().activeAllocations
    const ROUNDS = 100
    for (let i = 0; i < ROUNDS; i++) {
      items = 1 + (i % 12)
      await setup.renderOnce()
    }
    const delta = lib.getAllocatorStats().activeAllocations - before
    console.log(`[句柄] 列表增减 ${ROUNDS} 轮: 增量 ${delta}`)
    expect(delta).toBeLessThan(20)
  }, 60_000)

  it("单条内容的句柄开销不随长度线性膨胀", async () => {
    const lib = resolveRenderLib()
    const style = SyntaxStyle.create()
    let content = ""
    const setup = await testRender(() => (
      <box>
        <markdown content={content} syntaxStyle={style} />
      </box>
    ), { width: 80, height: 24 })

    await setup.renderOnce()
    const baseline = lib.getAllocatorStats().activeAllocations

    content = Array.from({ length: 1000 }, (_, i) => `第 ${i} 行文字。`).join("\n")
    await setup.renderOnce()
    const delta = lib.getAllocatorStats().activeAllocations - baseline

    // 10,000 字符若线性膨胀会是数千量级；实测仅 +66，故设 500 作为宽松上界。
    console.log(`[句柄] 单条 1000 行内容: 增量 ${delta}`)
    expect(delta).toBeLessThan(500)
  }, 60_000)
})
