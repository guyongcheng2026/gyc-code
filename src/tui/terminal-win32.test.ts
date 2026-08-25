import { describe, expect, test } from "bun:test"
import { utf8GuardMismatches, win32EnableUtf8Console, win32GetConsoleCodePage } from "./terminal-win32"

describe("terminal-win32 UTF-8 代码页", () => {
	test("启用后输出代码页读回为 65001（有控制台时）", () => {
		const enabled = win32EnableUtf8Console()
		if (!enabled) {
			// 无控制台环境（如 CI 管道）：函数应返回 false 而非抛错
			expect(win32GetConsoleCodePage()).toBe(-1)
			return
		}
		expect(win32GetConsoleCodePage()).toBe(65001)
	})

	test("守护失配计数器可用且非负", () => {
		expect(utf8GuardMismatches()).toBeGreaterThanOrEqual(0)
	})
})
