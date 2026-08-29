/**
 * fallback 轻量 i18n 框架。
 *
 * 极简设计：键值对 + locale 切换 + 嵌套插值。**不引入任何 i18n 库**。
 *
 * 设计目标：
 *  1. 零依赖（保持 fallback 自研纯净）
 *  2. 类型安全：所有 key 通过 TypeScript 字面量类型约束
 *  3. 运行时可热切换 locale
 *  4. 嵌套插值：`"hello {name}"` + `{ name: "world" }` → `"hello world"`
 *  5. 缺语言降级：缺 key 时回退到 default locale（zh-CN）
 *
 * 用法：
 *   const t = createI18n({
 *     "zh-CN": { "exit.confirm": "确认退出？" },
 *     "en": { "exit.confirm": "Exit?" },
 *   } as const, { locale: "zh-CN" })
 *   t("exit.confirm")  // → "确认退出？"
 *   t("exit.confirm", { name: "谷总" })  // 插值（key 需支持）
 */

export type Locale = string

export type TranslationKey<K extends string> = K

export interface I18n<K extends string> {
	/** 切换当前 locale */
	setLocale(locale: Locale): void
	/** 当前 locale */
	getLocale(): Locale
	/** 翻译：缺 key 时回退到 defaultLocale，再缺则原样返回 key */
	t(key: K, params?: Record<string, string | number>): string
	/** 注册新 locale 包 */
	register(locale: Locale, table: Partial<Record<K, string>>): void
}

export interface CreateI18nOptions<K extends string> {
	/** 初始 locale，默认 zh-CN */
	locale?: Locale
	/** 缺 key 时回退 locale，默认 zh-CN */
	defaultLocale?: Locale
}

export function createI18n<
	K extends string,
	T extends Record<Locale, Partial<Record<K, string>>>,
>(tables: T, options: CreateI18nOptions<K> = {}): I18n<K> {
	const defaultLocale = (options.defaultLocale ?? "zh-CN") as Locale
	let current = (options.locale ?? defaultLocale) as Locale
	const map = new Map<Locale, Partial<Record<K, string>>>()
	for (const [loc, table] of Object.entries(tables)) {
		map.set(loc, table)
	}

	return {
		setLocale(locale) {
			current = locale
		},
		getLocale() {
			return current
		},
		t(key, params) {
			const lookup = (table: Partial<Record<K, string>> | undefined): string | undefined => table?.[key]
			let value = lookup(map.get(current)) ?? lookup(map.get(defaultLocale)) ?? key
			if (params) {
				for (const [k, v] of Object.entries(params)) {
					value = value.replace(new RegExp(`\\{${k}\\}`, "g"), String(v))
				}
			}
			return value
		},
		register(locale, table) {
			const existing = map.get(locale) ?? {}
			map.set(locale, { ...existing, ...table })
		},
	}
}
