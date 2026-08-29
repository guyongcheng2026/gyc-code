import { describe, expect, test, mock } from "bun:test"
import { createSelectionStore, copyAndSelect, copySelection } from "./selection"

describe("选择存储", () => {
	test("初始为空", () => {
		const store = createSelectionStore()
		expect(store.get()).toBeNull()
	})

	test("程序化 setProgrammatic 写入", () => {
		const store = createSelectionStore()
		store.setProgrammatic("hello world")
		const sel = store.get()
		expect(sel?.text).toBe("hello world")
		expect(sel?.source).toBe("programmatic")
		expect(sel?.createdAt).toBeGreaterThan(0)
	})

	test("空文本 setProgrammatic 视为清空", () => {
		const store = createSelectionStore()
		store.setProgrammatic("非空")
		store.setProgrammatic("")
		expect(store.get()).toBeNull()
	})

	test("clear 清空", () => {
		const store = createSelectionStore()
		store.setProgrammatic("x")
		store.clear()
		expect(store.get()).toBeNull()
	})
})

describe("复制", () => {
	test("copySelection 空选择返回 false", async () => {
		const store = createSelectionStore()
		expect(await copySelection(store)).toBe(false)
	})

	test("copySelection 非空返回 true", async () => {
		const store = createSelectionStore()
		store.setProgrammatic("hi")
		expect(await copySelection(store)).toBe(true)
	})

	test("copyAndSelect 复合操作", async () => {
		const store = createSelectionStore()
		const ok = await copyAndSelect(store, "combined")
		expect(ok).toBe(true)
		expect(store.get()?.text).toBe("combined")
	})
})
