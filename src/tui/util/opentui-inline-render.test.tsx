import { describe, expect, it } from "bun:test"
import { testRender } from "@opentui/solid"

// 回归：<text> 内的内联元素（b / span / strong / i …）内容必须上屏。
//
// 立项（2026-10-11 稳定性排查）：gyc 的 opentui orphan 补丁曾把「内容为空就跳过
// 插入」的守卫放在 `isTextNodeRenderable(node)` 之后、父级检查之前。内联元素是
// 「先插入空壳节点、随后挂文本子节点」，插入那一刻 toChunks() 必为空，于是被
// 整块跳过且永不进树 —— 会话标题（<b>{title}</b>）、侧栏 footer（<b>GYC</b>）、
// 各插件标题（cwd/lsp/files/mcp/todo… 都用 <b>）全部不显示。
// 修复后守卫移入 orphan 分支内部（只有 parent 不是 <text> 时才可能是孤儿）。
//
// 该测试跑在 bun 条件（index.bun.js）；发布产物走 index.js，由
// scripts/apply-opentui-orphan-patch.cjs 同时打两个文件、verify-opentui-patches.cjs
// 双文件校验。此处兜住「补丁回退 / 被上游覆盖」这一路径。
describe("opentui 内联元素渲染", () => {
  it("<b> / <span> 无 style 时内容仍上屏", async () => {
    const setup = await testRender(
      () => (
        <box flexDirection="column">
          <text>
            <b>BOLD-MARKER</b>
          </text>
          <text>
            <span>SPAN-MARKER</span>
          </text>
          <text>PLAIN-MARKER</text>
          <text>
            pre<b>MID-MARKER</b>post
          </text>
        </box>
      ),
      { width: 50, height: 8 },
    )
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("BOLD-MARKER")
    expect(frame).toContain("SPAN-MARKER")
    expect(frame).toContain("PLAIN-MARKER")
    // 混合文本：内联元素被跳过时只剩 "prepost"，这里必须完整
    expect(frame).toContain("MID-MARKER")
    expect(frame).toContain("preMID-MARKERpost")
  }, 30_000)

  it("带 style 的内联 span 与相邻纯文本共存", async () => {
    const setup = await testRender(
      () => (
        <text>
          <span style={{ fg: "#a6e3a1" }}>● </span>
          <span style={{ fg: "#cdd6f4" }}>workspace-name</span> <span style={{ fg: "#a6adc8" }}>(project)</span>
        </text>
      ),
      { width: 50, height: 4 },
    )
    await setup.flush()
    const frame = setup.captureCharFrame()
    expect(frame).toContain("workspace-name")
    expect(frame).toContain("(project)")
  }, 30_000)
})
