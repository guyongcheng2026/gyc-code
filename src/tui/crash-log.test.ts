import { describe, expect, test } from "bun:test"
import { appendFileSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { writeCrashLogSync } from "./crash-log"

// 崩溃日志此前用异步 appendFile，随后 process.exit 立即执行导致写盘被抢占，
// 崩溃现场全部丢失（诊断黑洞）。必须同步落盘。
describe("崩溃日志同步落盘", () => {
	const dir = mkdtempSync(join(tmpdir(), "gyc-crash-log-"))
	const file = join(dir, "gyccode.log")

	test("同步写入：函数返回时内容已落盘", () => {
		writeCrashLogSync(file, "first-line")
		expect(existsSync(file)).toBe(true)
		expect(readFileSync(file, "utf8")).toContain("first-line")
	})

	test("多次调用为追加而非覆盖", () => {
		writeCrashLogSync(file, "second-line")
		const content = readFileSync(file, "utf8")
		expect(content).toContain("first-line")
		expect(content).toContain("second-line")
	})

	test("目录不存在时自动创建", () => {
		const nested = join(dir, "a", "b", "gyccode.log")
		writeCrashLogSync(nested, "nested-line")
		expect(readFileSync(nested, "utf8")).toContain("nested-line")
	})

	test("写入失败（路径非法）不抛异常：崩溃路径绝不能因日志再崩", () => {
		const bad = join(dir, "\0invalid")
		expect(() => writeCrashLogSync(bad, "x")).not.toThrow()
	})

	test("换行结尾，保证与后续日志拼接不粘连", () => {
		const f2 = join(dir, "nl.log")
		writeCrashLogSync(f2, "line-a")
		writeCrashLogSync(f2, "line-b")
		const lines = readFileSync(f2, "utf8").split("\n").filter(Boolean)
		expect(lines.length).toBe(2)
		expect(lines[0]).toContain("line-a")
		expect(lines[1]).toContain("line-b")
	})

	rmSync(dir, { recursive: true, force: true })
})