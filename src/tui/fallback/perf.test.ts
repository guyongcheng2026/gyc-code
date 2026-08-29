import { describe, expect, test } from "bun:test"
import { Screen } from "./screen"
import { renderDelta, renderFull } from "./diff"

/** 性能目标：80x24 全量渲染 < 5ms（CI/Windows 容差） */
const BENCHMARK_MAX_MS = 5
/** 性能目标：单行差分 < 2ms */
const DELTA_MAX_MS = 2
/** 10 条消息累计 < 25ms */
const MULTI_MSG_MAX_MS = 25

describe("性能基准", () => {
	test("80x24 全量渲染 < 5ms", () => {
		const screen = new Screen(80, 24)
		for (let y = 0; y < 24; y++) {
			screen.writeText(0, y, `第 ${y + 1} 行内容，测试渲染性能基准 ${y}`.repeat(2).slice(0, 80))
		}
		const start = performance.now()
		const out = renderFull(screen)
		const elapsed = performance.now() - start
		expect(out.length).toBeGreaterThan(0)
		expect(elapsed).toBeLessThan(BENCHMARK_MAX_MS)
	})

	test("80x24 单行差分渲染 < 2ms", () => {
		const prev = new Screen(80, 24)
		const next = new Screen(80, 24)
		for (let y = 0; y < 24; y++) {
			prev.writeText(0, y, `旧内容第 ${y} 行`)
			next.writeText(0, y, y === 10 ? "变化的第 11 行新内容" : `旧内容第 ${y} 行`)
		}
		const start = performance.now()
		const out = renderDelta(prev, next)
		const elapsed = performance.now() - start
		expect(out.length).toBeGreaterThan(0)
		expect(elapsed).toBeLessThan(DELTA_MAX_MS)
	})

	test("80x24 无变化帧输出为空串", () => {
		const a = new Screen(80, 24)
		const b = new Screen(80, 24)
		for (let y = 0; y < 24; y++) {
			const text = `相同内容第 ${y} 行测试文本`
			a.writeText(0, y, text)
			b.writeText(0, y, text)
		}
		expect(renderDelta(a, b)).toBe("")
	})

	test("差分帧字节量：1 行变化 < 全量 5%", () => {
		const prev = new Screen(80, 24)
		const next = new Screen(80, 24)
		for (let y = 0; y < 24; y++) {
			prev.writeText(0, y, `第 ${y} 行旧内容`)
			next.writeText(0, y, y === 0 ? "变化的第 1 行" : `第 ${y} 行旧内容`)
		}
		const fullOut = renderFull(next)
		const deltaOut = renderDelta(prev, next)
		expect(deltaOut.length).toBeLessThan(fullOut.length * 0.05)
	})

	test("1000 次迭代内存增长 < 5MB", () => {
		const before = process.memoryUsage().heapUsed
		const prev = new Screen(80, 24)
		const next = new Screen(80, 24)
		prev.writeText(0, 0, "初始化内容")
		next.writeText(0, 0, "初始化内容")
		for (let i = 0; i < 1000; i++) {
			prev.writeText(0, 0, `第 ${i} 次迭代`)
			next.writeText(0, 0, `第 ${i + 1} 次迭代`)
			renderDelta(prev, next)
			prev.writeText(0, 0, `第 ${i + 1} 次迭代`)
		}
		const after = process.memoryUsage().heapUsed
		expect(after - before).toBeLessThan(5 * 1024 * 1024)
	})

	test("10 条消息全量渲染 < 25ms", () => {
		const screen = new Screen(80, 24)
		const start = performance.now()
		for (let msg = 0; msg < 10; msg++) {
			const text = `助手消息 ${msg + 1}：这是第 ${msg + 1} 条助手回复，内容足够长以测试渲染性能`
			screen.writeText(0, msg, text.slice(0, 80))
		}
		const out = renderFull(screen)
		expect(out.length).toBeGreaterThan(0)
		expect(performance.now() - start).toBeLessThan(MULTI_MSG_MAX_MS)
	})

	test("满屏中文差分帧 < 4KB", () => {
		const prev = new Screen(80, 24)
		const next = new Screen(80, 24)
		for (let y = 0; y < 24; y++) {
			prev.writeText(0, y, "编码测试宽度口径验证".repeat(4))
			next.writeText(0, y, y === 5 ? "变化内容测试" : "编码测试宽度口径验证".repeat(4))
		}
		expect(renderDelta(prev, next).length).toBeLessThan(4096)
	})
})
