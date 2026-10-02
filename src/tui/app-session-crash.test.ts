import { describe, expect, test } from "bun:test"
import { getCurrentSessionID, setCurrentSessionID } from "./app"

// 崩溃降级链路运行在 Effect 作用域之外，靠这个进程级记录器拿到当前会话 ID，
// 才能在安全模式里给出「gyc --session <id>」续接命令。
describe("崩溃降级用的会话 ID 记录器", () => {
	test("初始为 undefined（启动期崩溃无会话上下文）", () => {
		setCurrentSessionID(undefined)
		expect(getCurrentSessionID()).toBeUndefined()
	})

	test("记录会话后可读回", () => {
		setCurrentSessionID("ses_f2f26a44cffePdmSm4HWrAYtg6")
		expect(getCurrentSessionID()).toBe("ses_f2f26a44cffePdmSm4HWrAYtg6")
	})

	test("路由离开会话（回首页）时清空，避免给出过期续接命令", () => {
		setCurrentSessionID("ses_f05373732ffeUZ4nDZuzrC89Ly")
		setCurrentSessionID(undefined)
		expect(getCurrentSessionID()).toBeUndefined()
	})
})