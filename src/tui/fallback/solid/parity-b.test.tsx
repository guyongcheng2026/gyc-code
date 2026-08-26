/** @jsxImportSource #fallback-solid */
import { describe, expect, test } from "bun:test"
import { createComponent, For } from "solid-js"
import { FallbackRenderer, MemoryBackend } from "../terminal"
import { flushSync, renderRoot } from "./renderer"
import { ScrollBar, Select, TextTable, type SelectApi } from "./components"
import { highlightCodeLine } from "../highlight"
import { renderDelta } from "../diff"
import { Screen } from "../screen"

/**
 * parity slice B：Select/ScrollBar/TextTable 组件、代码高亮、
 * 行戳差分与量算缓存的性能验证。
 */

function mount(renderer: FallbackRenderer, app: () => unknown): () => void {
	return renderRoot(() => createComponent(app as () => never, {}), renderer)
}

describe("slice B：Select 选择器", () => {
	test("上下移动 + 反白高亮 + 回车确认", () => {
		const backend = new MemoryBackend(30, 8)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		let sel: SelectApi | undefined
		let confirmed = -1
		const dispose = mount(renderer, () => (
			<Select
				options={["苹果", "香蕉", "樱桃"]}
				ref={(api) => {
					sel = api
				}}
				onConfirm={(i) => (confirmed = i)}
			/>
		))
		flushSync()
		// 初始第 0 项反白
		expect(renderer.currentScreen.cellAt(0, 0).style.reverse).toBe(true)
		expect(sel!.handleKey({ type: "down" })).toBe(true)
		flushSync()
		expect(sel!.selectedIndex()).toBe(1)
		expect(renderer.currentScreen.cellAt(0, 1).style.reverse).toBe(true)
		expect(renderer.currentScreen.cellAt(0, 0).style.reverse).toBeUndefined()
		expect(sel!.handleKey({ type: "enter" })).toBe(true)
		expect(confirmed).toBe(1)
		dispose()
	})

	test("视口滚动跟随（visibleRows）", () => {
		const backend = new MemoryBackend(30, 6)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		let sel: SelectApi | undefined
		const dispose = mount(renderer, () => (
			<Select
				options={["一", "二", "三", "四", "五"]}
				visibleRows={3}
				ref={(api) => {
					sel = api
				}}
			/>
		))
		flushSync()
		// 视口 3 行：初始显示 一/二/三
		expect(renderer.currentScreen.snapshot()[0]!.trim()).toBe("一")
		expect(renderer.currentScreen.snapshot()[2]!.trim()).toBe("三")
		expect(renderer.currentScreen.snapshot()[3]!.trim()).toBe("")
		// 下移 3 次：选中「四」，视口滚到 二/三/四
		sel!.handleKey({ type: "down" })
		sel!.handleKey({ type: "down" })
		sel!.handleKey({ type: "down" })
		flushSync()
		expect(renderer.currentScreen.snapshot()[0]!.trim()).toBe("二")
		expect(renderer.currentScreen.snapshot()[2]!.trim()).toBe("四")
		dispose()
	})

	test("Esc 取消回调", () => {
		const backend = new MemoryBackend(20, 4)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		let sel: SelectApi | undefined
		let cancelled = false
		const dispose = mount(renderer, () => (
			<Select
				options={["a"]}
				ref={(api) => {
					sel = api
				}}
				onCancel={() => (cancelled = true)}
			/>
		))
		expect(sel!.handleKey({ type: "escape" })).toBe(true)
		expect(cancelled).toBe(true)
		dispose()
	})
})

describe("slice B：ScrollBar 指示条", () => {
	test("比例条渲染：位置与长度", () => {
		const backend = new MemoryBackend(10, 10)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<ScrollBar contentHeight={100} viewportHeight={10} scrollTop={0} />
		))
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		// bar 长度 = round(10/100*10)=1，位置 0 → 首行 █，其余 │
		expect(snap[0]![0]).toBe("█")
		expect(snap[1]![0]).toBe("│")
		expect(snap[9]![0]).toBe("│")
		dispose()
	})

	test("滚动中途：条位置随 scrollTop 移动", () => {
		const backend = new MemoryBackend(10, 10)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<ScrollBar contentHeight={100} viewportHeight={10} scrollTop={50} />
		))
		flushSync()
		// maxScroll=90，pos = round(50/90*9)≈5 → 第 5 行 █
		expect(renderer.currentScreen.snapshot()[5]![0]).toBe("█")
		dispose()
	})
})

describe("slice B：TextTable 表格", () => {
	test("列对齐与表头样式", () => {
		const backend = new MemoryBackend(40, 5)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = renderRoot(
			() => createComponent(() => (<TextTable header={["名称", "数量"]} rows={[["苹果", "3"], ["香蕉", "12"]]} />) as never, {}),
			renderer,
		)
		flushSync()
		const snap = renderer.currentScreen.snapshot()
		// 表头加粗
		expect(renderer.currentScreen.cellAt(0, 0).style.bold).toBe(true)
		// 列对齐（cellAt 按显示列）：「苹果」占列 0-3，+2 空格 → 列 6 起「3」
		expect(renderer.currentScreen.cellAt(6, 1).ch).toBe("3")
		expect(renderer.currentScreen.cellAt(6, 2).ch).toBe("1")
		expect(renderer.currentScreen.cellAt(7, 2).ch).toBe("2")
		expect(snap[1]!.includes("苹果")).toBe(true)
		dispose()
	})
})

describe("slice B：代码高亮", () => {
	test("关键字/字符串/注释/数字分色", () => {
		const spans = highlightCodeLine('const x = "hi" // 备注', "ts")
		const text = spans.map((s) => s.text).join("")
		expect(text).toBe('const x = "hi" // 备注')
		expect(spans[0]!.text).toBe("const")
		expect(spans[0]!.style.fg).toBe("#d73a49") // 关键字红
		const strSpan = spans.find((s) => s.text.startsWith('"'))
		expect(strSpan!.style.fg).toBe("#22863a") // 字符串绿
		const commentSpan = spans.find((s) => s.text.startsWith("//"))
		expect(commentSpan!.style.fg).toBe("#6a737d") // 注释灰
	})

	test("函数调用紫色 + Python 注释", () => {
		const py = highlightCodeLine("def foo(x): # 定义", "python")
		expect(py[0]!.text).toBe("def")
		expect(py[0]!.style.fg).toBe("#d73a49")
		const comment = py.find((s) => s.text.startsWith("#"))
		expect(comment).toBeDefined()
	})
})

describe("slice B：性能（行戳差分 + 量算缓存）", () => {
	test("未写行 O(1) 短路：大屏增量帧只含变化行", () => {
		const prev = new Screen(200, 50)
		const next = new Screen(200, 50)
		// 两屏写相同内容（走值比较路径，next 的行戳记录写入）
		for (let y = 0; y < 50; y++) {
			prev.writeText(0, y, `行内容-${y}-固定文本占位XXXXXXXXXXXXXXXX`)
			next.writeText(0, y, `行内容-${y}-固定文本占位XXXXXXXXXXXXXXXX`)
		}
		// next 仅改一行
		next.writeText(0, 25, "变化行XXXXXXXXXXXXXXXXXXXXXXXXXXXX")
		const delta = renderDelta(prev, next)
		// 增量只包含第 25 行（定位序列唯一）
		const positions = delta.match(/\x1b\[\d+;\d+H/g) ?? []
		expect(positions).toEqual(["\x1b[26;1H"])
	})

	test("值比较吸收：写回相同内容不产生增量", () => {
		const screen = new Screen(80, 24)
		screen.writeText(0, 0, "稳定内容")
		const prev = screen.clone()
		// 再次写完全相同的内容（值比较应吸收，戳不变）
		screen.writeText(0, 0, "稳定内容")
		const delta = renderDelta(prev, screen)
		expect(delta).toBe("")
	})

	test("量算缓存：同宽度重复量算命中（性能冒烟）", () => {
		// 大树全量 repaint 两次，第二次应显著快于第一次（缓存命中）
		const backend = new MemoryBackend(120, 40)
		const renderer = new FallbackRenderer(backend)
		renderer.start()
		const dispose = mount(renderer, () => (
			<box flex>
				<For each={Array.from({ length: 200 }, (_, i) => i)}>
					{(i: number) => <text>条目{i}：固定宽度文本内容占位行</text>}
				</For>
			</box>
		))
		flushSync()
		const t0 = performance.now()
		for (let i = 0; i < 50; i++) {
			// 同树重复 repaint（模拟光标闪烁等无内容变化帧）
			flushSync()
		}
		const elapsed = performance.now() - t0
		// 50 次无变化帧总耗时应远低于 50ms（缓存 + 值比较吸收）
		expect(elapsed).toBeLessThan(50)
		dispose()
	})
})
