/**
 * 真终端 fallback 启动验证（headless 版本）。
 *
 * 三轮顺序：每轮创建新 backend → start → present → stop → 检查无异常。
 * 模拟"全量启动 ballback"在 CI/headless 环境的稳定性。
 */
import { describe, expect, test } from "bun:test"
import { FallbackRenderer } from "./terminal"
import { probeTerminal, renderBudget } from "./capability"

interface NullBackend {
	write(s: string): void
	getWidth(): number
	getHeight(): number
	setRawMode(on: boolean): void
	onResize(cb: () => void): () => void
	start(): void
	stop(): void
	isStdout(): boolean
}

function makeBackend(): NullBackend {
	return {
		write(_s: string) {},
		getWidth() { return 80 },
		getHeight() { return 24 },
		setRawMode(_: boolean) {},
		onResize(_: () => void) { return () => {} },
		start() {},
		stop() {},
		isStdout() { return false },
	}
}

async function runOneRound(): Promise<{ ok: boolean; ms: number }> {
	const t0 = performance.now()
	const backend = makeBackend()
	const probe = probeTerminal()
	const budget = renderBudget(probe)
	const renderer = new FallbackRenderer(backend as never, budget)
	renderer.start()
	renderer.present((s) => {
		s.writeText(0, 0, "fallback ballback test", { fg: "#ffffff", bg: "#000000" })
	})
	await Bun.sleep(30)
	renderer.stop()
	const ms = performance.now() - t0
	return { ok: true, ms }
}

describe("三轮真终端 fallback 验证", () => {
	const results: Array<{ ok: boolean; ms: number }> = []

	for (let round = 1; round <= 3; round++) {
		test(`第 ${round} 轮：start + present + stop`, async () => {
			const r = await runOneRound()
			results.push({ ok: r.ok, ms: r.ms })
			expect(r.ok).toBe(true)
		})
	}

	test("三轮汇总：全部成功", () => {
		expect(results.length).toBe(3)
		for (const r of results) expect(r.ok).toBe(true)
	})
})
