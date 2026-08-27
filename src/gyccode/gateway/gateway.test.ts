import { describe, expect, test } from "bun:test"
import { classifyIlinkResponse, GatewayError } from "./errors"
import { splitWeixinText } from "./weixin"
import { Replier } from "./reply"

/**
 * 微信网关单元测试（2026-08-27 全面检查补充）：
 * 错误分类器 / 超长分段 / 指令路由。
 * 对话与 /run 真实链路由冒烟脚本（scripts/gateway-smoke.ts、gateway-task-smoke.ts）覆盖。
 */

describe("iLink 错误分类器", () => {
	test("ret=0 为成功语义（null）", () => {
		expect(classifyIlinkResponse(0, undefined, "")).toBeNull()
	})

	test("ret=-14 判定为会话过期", () => {
		const err = classifyIlinkResponse(-14, undefined, "session timeout")
		expect(err).toBeInstanceOf(GatewayError)
		expect(err!.kind).toBe("session_expired")
		expect(err!.hint).toContain("扫码")
	})

	test("ret=-2 prepare failed 判定为凭证失效（非限流）", () => {
		const err = classifyIlinkResponse(-2, undefined, "prepare failed")
		expect(err!.kind).toBe("credential_stale")
		expect(err!.hint).toContain("给机器人发一条消息")
	})

	test("ret=-2 unknown error 判定为会话过期", () => {
		expect(classifyIlinkResponse(-2, undefined, "unknown error")!.kind).toBe("session_expired")
	})

	test("ret=-2 其他文案判定为限流", () => {
		expect(classifyIlinkResponse(-2, undefined, "busy")!.kind).toBe("rate_limited")
	})

	test("未知码判定为 unknown 并携带原始响应", () => {
		const err = classifyIlinkResponse(-99, undefined, "weird")
		expect(err!.kind).toBe("unknown")
		expect(err!.raw).toEqual({ ret: -99, errcode: undefined, errmsg: "weird" })
	})

	test("ret 缺失时以 errcode 兜底", () => {
		expect(classifyIlinkResponse(undefined, -14, "x")!.kind).toBe("session_expired")
	})
})

describe("微信超长文本分段", () => {
	test("短文本原样返回", () => {
		expect(splitWeixinText("你好", 2000)).toEqual(["你好"])
	})

	test("超长文本按上限切分且无内容丢失", () => {
		const text = "x".repeat(4500)
		const chunks = splitWeixinText(text, 2000)
		expect(chunks.length).toBe(3)
		expect(chunks[0]!.length).toBe(2000)
		expect(chunks.join("")).toBe(text)
	})

	test("恰好等于上限不分段", () => {
		expect(splitWeixinText("y".repeat(2000), 2000)).toEqual(["y".repeat(2000)])
	})
})

describe("应答路由", () => {
	test("/status 不走 LLM 直接返回状态", async () => {
		const replier = new Replier()
		const status = await replier.reply("unit-chat", "/status")
		expect(status).toContain("网关状态")
		expect(status).toContain("任务通道")
	})

	test("/status 大小写不敏感", async () => {
		const replier = new Replier()
		const status = await replier.reply("unit-chat", "/STATUS")
		expect(status).toContain("网关状态")
	})
})
