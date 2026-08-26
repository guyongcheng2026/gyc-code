/**
 * 自研 fallback 渲染器性能基准。
 *
 * 运行：bun scripts/tui-fallback-bench.ts
 * 指标：全量帧/增量帧渲染耗时、输出字节量（80x24 与 120x40 两档）。
 */
import { renderDelta, renderFull } from "../src/tui/fallback/diff"
import { Screen } from "../src/tui/fallback/screen"

const ITER = 2000

function benchFullFrame(cols: number, rows: number): { msPerFrame: number; bytes: number } {
	const screen = new Screen(cols, rows)
	for (let y = 0; y < rows; y++) {
		screen.writeText(1, y, "编码测试宽度口径验证 mixed text 🚀".repeat(Math.ceil(cols / 10)), { fg: "#aaaaaa" })
	}
	const bytes = renderFull(screen).length
	const t0 = performance.now()
	for (let i = 0; i < ITER; i++) renderFull(screen)
	const ms = (performance.now() - t0) / ITER
	return { msPerFrame: ms, bytes }
}

function benchDeltaFrame(cols: number, rows: number): { msPerFrame: number; bytes: number } {
	const prev = new Screen(cols, rows)
	const next = new Screen(cols, rows)
	for (let y = 0; y < rows; y++) {
		prev.writeText(1, y, `行 ${y}: 基线内容 baseline content`)
		next.writeText(1, y, `行 ${y}: 基线内容 baseline content`)
	}
	next.writeText(5, Math.floor(rows / 2), "单点变更：中文更新")
	const bytes = renderDelta(prev, next).length
	const t0 = performance.now()
	for (let i = 0; i < ITER; i++) renderDelta(prev, next)
	const ms = (performance.now() - t0) / ITER
	return { msPerFrame: ms, bytes }
}

console.log(`迭代次数: ${ITER}/场景`)
for (const [cols, rows] of [
	[80, 24],
	[120, 40],
] as const) {
	const full = benchFullFrame(cols, rows)
	const delta = benchDeltaFrame(cols, rows)
	console.log(`${cols}x${rows} 全量帧: ${full.msPerFrame.toFixed(3)}ms/帧, 输出 ${full.bytes}B`)
	console.log(`${cols}x${rows} 增量帧: ${delta.msPerFrame.toFixed(3)}ms/帧, 输出 ${bytesFmt(delta.bytes)}`)
}

function bytesFmt(n: number): string {
	return n > 1024 ? `${(n / 1024).toFixed(2)}KB` : `${n}B`
}
