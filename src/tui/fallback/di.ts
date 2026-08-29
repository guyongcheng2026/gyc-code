/**
 * fallback 轻量 DI 容器。
 *
 * 决策：**不引入 Effect 库**。原因：
 *  1. Effect 4.0 学习曲线陡（Layer/ManagedRuntime/ServiceMap 体系）
 *  2. fallback 链路浅，DI 需求仅"几样服务跨层传递"（renderer/clipboard/toast/i18n）
 *  3. 引入即增加 50KB+ 体积 + 复杂类型推导
 *
 * 替代方案：本模块提供极简 Service Locator：
 *  - register()：注册单例（惰性初始化）
 *  - resolve()：按 token 取回，缺则抛错
 *  - tryResolve()：缺返回 undefined
 *  - 类型通过 ServiceToken<T> 保证
 *
 * 用法：
 *   const RendererToken = createServiceToken<FallbackRenderer>("renderer")
 *   container.register(RendererToken, () => new FallbackRenderer(backend))
 *   const r = container.resolve(RendererToken)
 */

export interface ServiceToken<T> {
	readonly _brand: T
	readonly name: string
}

export function createServiceToken<T>(name: string): ServiceToken<T> {
	return { _brand: undefined as never, name }
}

export type ServiceFactory<T> = () => T

export class ServiceContainer {
	private factories = new Map<string, ServiceFactory<unknown>>()
	private instances = new Map<string, unknown>()

	register<T>(token: ServiceToken<T>, factory: ServiceFactory<T>): void {
		this.factories.set(token.name, factory)
	}

	resolve<T>(token: ServiceToken<T>): T {
		const existing = this.instances.get(token.name) as T | undefined
		if (existing !== undefined) return existing
		const factory = this.factories.get(token.name) as ServiceFactory<T> | undefined
		if (!factory) throw new Error(`Service not registered: ${token.name}`)
		const inst = factory()
		this.instances.set(token.name, inst)
		return inst
	}

	tryResolve<T>(token: ServiceToken<T>): T | undefined {
		try {
			return this.resolve(token)
		} catch {
			return undefined
		}
	}

	has(token: ServiceToken<unknown>): boolean {
		return this.factories.has(token.name)
	}

	clear(): void {
		this.factories.clear()
		this.instances.clear()
	}
}

/** 全局默认容器（典型单例） */
export const defaultContainer = new ServiceContainer()
