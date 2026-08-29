import { describe, expect, test } from "bun:test"
import { createServiceToken, ServiceContainer } from "./di"

describe("ServiceContainer", () => {
	const StringToken = createServiceToken<string>("string-svc")
	const NumToken = createServiceToken<number>("num-svc")

	test("register + resolve 返回单例", () => {
		const c = new ServiceContainer()
		c.register(StringToken, () => "hello")
		expect(c.resolve(StringToken)).toBe("hello")
	})

	test("resolve 两次返回同一实例（惰性单例）", () => {
		const c = new ServiceContainer()
		let count = 0
		c.register(NumToken, () => ++count)
		const a = c.resolve(NumToken)
		const b = c.resolve(NumToken)
		expect(a).toBe(b)
		expect(count).toBe(1)
	})

	test("resolve 未注册抛错", () => {
		const c = new ServiceContainer()
		expect(() => c.resolve(StringToken)).toThrow()
	})

	test("tryResolve 未注册返回 undefined", () => {
		const c = new ServiceContainer()
		expect(c.tryResolve(StringToken)).toBeUndefined()
	})

	test("has", () => {
		const c = new ServiceContainer()
		expect(c.has(StringToken)).toBe(false)
		c.register(StringToken, () => "hi")
		expect(c.has(StringToken)).toBe(true)
	})

	test("clear", () => {
		const c = new ServiceContainer()
		c.register(StringToken, () => "x")
		c.clear()
		expect(c.has(StringToken)).toBe(false)
	})
})
