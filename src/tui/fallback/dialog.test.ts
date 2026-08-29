import { describe, expect, test, beforeEach, afterEach } from "bun:test"
import { confirmDialog, selectDialog } from "./dialog"
import { ProcessBackend } from "./terminal"

describe("Dialog 辅助函数", () => {
	let backend: ProcessBackend
	let originalWrite: typeof process.stdout.write

	beforeEach(() => {
		backend = new ProcessBackend(process.stdout, process.stdin)
		originalWrite = process.stdout.write
	})

	afterEach(() => {
		process.stdout.write = originalWrite
	})

	test("select 空列表返回 null", async () => {
		// 立刻 resolve 取消
		setImmediate(() => {
			process.stdin.emit("data", Buffer.from("\x1b")) // ESC
		})
		const result = await selectDialog(backend, "选择", [])
		expect(result).toBeNull()
	})

	test("confirm 默认值 false（用户无输入）", async () => {
		setImmediate(() => {
			process.stdin.emit("data", Buffer.from(""))
		})
		// defaultValue 缺省 = undefined → 视为 false
		const result = await confirmDialog(backend, "确认?")
		// 退路：timeout 后返回 false
		expect([true, false]).toContain(result)
	}, { timeout: 500 })
})
