import { describe, expect, test } from "bun:test"
import { classifyIlinkResponse, GatewayError } from "./errors"
import { readWeixinEnv, splitWeixinText } from "./weixin"
import { formatTaskCompleteMessage, isTaskNotifySwitchOff, notifyTaskComplete } from "./notify"
import type { TaskNotifyDeps } from "./notify"
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

describe("网关任务完成推送：开关判定", () => {
	test("关闭取值全部识别为关", () => {
		for (const value of ["0", "false", "OFF", " off ", "no", "disabled", "none"])
			expect(isTaskNotifySwitchOff(value)).toBe(true)
	})

	test("空值与开启取值均视为开", () => {
		for (const value of ["", "1", "true", "on", "yes"]) expect(isTaskNotifySwitchOff(value)).toBe(false)
	})
})

describe("网关任务完成推送：文案格式", () => {
	test("含标题、耗时与摘要", () => {
		const text = formatTaskCompleteMessage({ title: "修复登录", durationMs: 65_400, summary: "已提交" })
		expect(text).toBe("gyc 任务完成：修复登录（耗时 65 秒）\n已提交")
	})

	test("标题与摘要缺省时用通用文案", () => {
		expect(formatTaskCompleteMessage({})).toBe("gyc 任务完成")
	})

	test("耗时按秒四舍五入且不为负", () => {
		expect(formatTaskCompleteMessage({ durationMs: 999 })).toContain("耗时 1 秒")
		expect(formatTaskCompleteMessage({ durationMs: -5 })).toContain("耗时 0 秒")
	})

	test("超长摘要自动截断，避免触发二次分段", () => {
		expect(formatTaskCompleteMessage({ summary: "x".repeat(500) }).length).toBeLessThanOrEqual(410)
	})
})

describe("网关任务完成推送：推送链路", () => {
	const ok = { ok: true, messageId: "m-1" }
	const deps = (over: Partial<TaskNotifyDeps> = {}): TaskNotifyDeps => ({
		enabled: () => true,
		resolveTarget: () => "chat-1",
		send: async () => ok,
		...over,
	})

	test("开关关闭时不推送", async () => {
		let sent = 0
		const result = await notifyTaskComplete({ title: "t" }, deps({ enabled: () => false, send: async () => (sent++, ok) }))
		expect(sent).toBe(0)
		expect(result).toBeUndefined()
	})

	test("未配置凭证时静默跳过", async () => {
		let sent = 0
		const result = await notifyTaskComplete(
			{ title: "t" },
			deps({ resolveTarget: () => undefined, send: async () => (sent++, ok) }),
		)
		expect(sent).toBe(0)
		expect(result).toBeUndefined()
	})

	test("投递目标为空串同样按未配置处理", async () => {
		let sent = 0
		await notifyTaskComplete({ title: "t" }, deps({ resolveTarget: () => "", send: async () => (sent++, ok) }))
		expect(sent).toBe(0)
	})

	test("正常推送把格式化文案发往目标会话", async () => {
		const calls: Array<[string, string]> = []
		const result = await notifyTaskComplete(
			{ title: "构建" },
			deps({ send: async (chatId, text) => (calls.push([chatId, text]), ok) }),
		)
		expect(calls).toEqual([["chat-1", "gyc 任务完成：构建"]])
		expect(result).toEqual(ok)
	})

	test("发送失败以失败结果返回，不向调用方抛错", async () => {
		const failure = { ok: false, error: "凭证失效", kind: "credential_stale" as const }
		expect(await notifyTaskComplete({ title: "t" }, deps({ send: async () => failure }))).toEqual(failure)
	})

	test("发送抛异常也不影响调用方", async () => {
		const result = await notifyTaskComplete({ title: "t" }, deps({ send: async () => { throw new Error("boom") } }))
		expect(result).toBeUndefined()
	})

	test("开关判定自身抛异常同样被兜住", async () => {
		const result = await notifyTaskComplete({ title: "t" }, deps({ enabled: () => { throw new Error("nope") } }))
		expect(result).toBeUndefined()
	})
})

describe("网关环境变量读取", () => {
	test("文件值优先于进程环境", () => {
		const key = "GYC_TEST_ENV_PRIORITY"
		process.env[key] = "env-值"
		try {
			expect(readWeixinEnv(key, { [key]: "文件值" })).toBe("文件值")
			expect(readWeixinEnv(key, {})).toBe("env-值")
		} finally {
			delete process.env[key]
		}
	})

	test("文件与环境都缺省时返回空串", () => {
		expect(readWeixinEnv("GYC_TEST_ENV_ABSENT", {})).toBe("")
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
