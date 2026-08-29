import { describe, expect, test, beforeEach, afterEach, mock } from "bun:test"
import { ToastStore, renderToastsToStderr } from "./toast"

describe("ToastStore", () => {
	let store: ToastStore

	beforeEach(() => {
		store = new ToastStore()
	})

	test("add 返回递增 id", () => {
		const id1 = store.add("a")
		const id2 = store.add("b")
		expect(id2).toBeGreaterThan(id1)
	})

	test("all 返回当前所有 Toast", () => {
		store.add("hello")
		store.add("world", { variant: "error" })
		const all = store.all()
		expect(all.length).toBe(2)
		expect(all[0].text).toBe("hello")
		expect(all[1].text).toBe("world")
		expect(all[1].variant).toBe("error")
	})

	test("dismiss 移除指定 id", () => {
		const id = store.add("temp")
		store.dismiss(id)
		expect(store.all()).toHaveLength(0)
	})

	test("dismiss 无效 id 无副作用", () => {
		store.add("keep")
		store.dismiss(9999)
		expect(store.all()).toHaveLength(1)
	})

	test("clear 清空所有", () => {
		store.add("a")
		store.add("b")
		store.clear()
		expect(store.all()).toHaveLength(0)
	})

	test("duration=0 不自动移除", async () => {
		store.add("permanent", { duration: 0 })
		await Bun.sleep(50)
		expect(store.all()).toHaveLength(1)
	})

	test("默认 duration=3000 后自动移除", async () => {
		store.add("transient", { duration: 50 })
		expect(store.all()).toHaveLength(1)
		await Bun.sleep(100)
		expect(store.all()).toHaveLength(0)
	})

	test("title 可选", () => {
		store.add("text", { title: "标题", variant: "success" })
		const [t] = store.all()
		expect(t.title).toBe("标题")
		expect(t.variant).toBe("success")
	})
})
