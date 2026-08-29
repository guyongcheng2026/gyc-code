import { describe, expect, test } from "bun:test"
import { createI18n } from "./i18n"

const tables = {
	"zh-CN": {
		"app.title": "gyc-code fallback",
		"exit.confirm": "确认退出？",
		"copy.done": "已复制 {count} 条消息",
	},
	"en": {
		"app.title": "gyc-code fallback",
		"exit.confirm": "Exit?",
		"copy.done": "Copied {count} messages",
	},
} as const

type Key = keyof typeof tables["zh-CN"]

describe("i18n", () => {
	test("默认 zh-CN 翻译", () => {
		const i18n = createI18n(tables)
		expect(i18n.t("app.title")).toBe("gyc-code fallback")
	})

	test("setLocale 切换到 en", () => {
		const i18n = createI18n(tables)
		i18n.setLocale("en")
		expect(i18n.t("exit.confirm")).toBe("Exit?")
	})

	test("缺 key 回退到 defaultLocale", () => {
		const i18n = createI18n({ "zh-CN": { "only.zh": "仅有中文" } as Record<string, string>, "en": {} }, { locale: "en" })
		expect(i18n.t("only.zh")).toBe("仅有中文")
	})

	test("再缺返回 key 本身", () => {
		const i18n = createI18n(tables)
		expect(i18n.t("nonexistent" as Key)).toBe("nonexistent")
	})

	test("插值：{count} 替换", () => {
		const i18n = createI18n(tables)
		expect(i18n.t("copy.done", { count: 3 })).toBe("已复制 3 条消息")
		i18n.setLocale("en")
		expect(i18n.t("copy.done", { count: 5 })).toBe("Copied 5 messages")
	})

	test("register 热加载新 locale", () => {
		const i18n = createI18n(tables)
		i18n.register("ja", { "app.title": "gyc-code フォールバック" })
		i18n.setLocale("ja")
		expect(i18n.t("app.title")).toBe("gyc-code フォールバック")
	})

	test("getLocale 返回当前语言", () => {
		const i18n = createI18n(tables)
		expect(i18n.getLocale()).toBe("zh-CN")
		i18n.setLocale("en")
		expect(i18n.getLocale()).toBe("en")
	})
})
