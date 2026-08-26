/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { highlightCodeLine } from "../highlight"
import { parseMarkdown } from "../markdown"
import { renderDelta } from "../diff"
import { Screen } from "../screen"

/**
 * 三轮代码审查（2026-08-27）修复回归：
 * 语义轮（# 注释整段高亮）、边界轮（roles 上限/戳精度）、性能轮（空 delta 戳同步）。
 */

describe("审查三轮修复：高亮与解析", () => {
	test("python # 注释整段高亮（非仅 # 字符）", () => {
		const spans = highlightCodeLine("x = 1  # 这里是备注", "python")
		const comment = spans.find((s) => s.text.startsWith("#"))
		expect(comment).toBeDefined()
		// 整段（含中文备注）都被吞进注释 token，不是只有 "#"
		expect(comment!.text).toBe("# 这里是备注")
		expect(comment!.style.fg).toBe("#6a737d")
	})

	test("shell # 注释同样整段", () => {
		const spans = highlightCodeLine("echo hi # 输出", "sh")
		expect(spans.find((s) => s.text === "# 输出")!.style.fg).toBe("#6a737d")
	})

	test("ts 字符串内的 # 不受影响", () => {
		const spans = highlightCodeLine('const u = "a#b"', "ts")
		expect(spans.find((s) => s.text.startsWith('"'))!.style.fg).toBe("#22863a")
	})

	test("markdown 有序列表编号保持", () => {
		const lines = parseMarkdown("1. 第一\n2. 第二")
		expect(lines[0]![0]!.text).toBe("  1. ")
		expect(lines[1]![0]!.text).toBe("  2. ")
	})
})

describe("审查三轮修复：行戳语义", () => {
	test("空 delta 后戳同步——后续无变化帧保持 O(1) 短路", () => {
		const screen = new Screen(40, 5)
		screen.writeText(0, 0, "内容A")
		screen.writeText(0, 1, "内容B")
		const prev = screen.clone()
		// 模拟 present 空 delta 后的戳同步
		prev.syncStampsFrom(screen)
		// 再写回相同内容（值比较吸收，戳不变）
		screen.writeText(0, 0, "内容A")
		expect(renderDelta(prev, screen)).toBe("")
	})

	test("同步后真实变化仍被检出", () => {
		const screen = new Screen(40, 5)
		screen.writeText(0, 2, "旧文本")
		const prev = screen.clone()
		prev.syncStampsFrom(screen)
		screen.writeText(0, 2, "完全不同的新内容")
		const delta = renderDelta(prev, screen)
		expect(delta).toContain("完全不同的新内容")
	})

	test("resize 保留重叠区行戳", () => {
		const screen = new Screen(20, 5)
		screen.writeText(0, 3, "底部")
		const before = screen.rowStampAt(3)
		screen.resize(30, 8)
		// 扩容后旧行的戳应保留（非 0 重置）
		expect(screen.rowStampAt(3)).toBe(before)
	})
})

describe("审查三轮修复：渲染器空 delta 戳同步（端到端）", () => {
	test("两次相同 present 后第三次仍零输出", async () => {
		const backend = new MemoryBackend(30, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		renderer.present((s) => {
			s.writeText(0, 0, "静止内容")
		})
		await new Promise((r) => setTimeout(r, 5))
		const len1 = backend.output.length
		// 再 present 相同内容：值比较吸收 + 戳同步 → 输出不再增长
		renderer.present((s) => {
			s.writeText(0, 0, "静止内容")
		})
		await new Promise((r) => setTimeout(r, 5))
		expect(backend.output.length).toBe(len1)
		renderer.stop()
	})
})
