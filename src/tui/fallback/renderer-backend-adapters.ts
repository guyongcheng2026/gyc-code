/**
 * P2 立项前置：RendererBackend 双实现（可编译切换）。
 *
 * - OpentuiRendererBackend：包装 opentui CliRenderer 的收窄子集。
 *   不在本层直接 import @opentui/core，用最小结构性接口（structural type）
 *   承接调用点所需成员，避免测试载荷带起原生依赖；产线 S0 合并时由
 *   app.tsx 的 createCliRenderer 结果天然满足该结构。
 * - FallbackRendererBackend：包装自研 FallbackRenderer（纯 JS）。
 *
 * 两者实现同一契约（renderer-backend.ts），供 App 层在 S0 之后通过
 * GYC_TUI_BACKEND 分流。当前仅提供类型与适配，不接产线调用点（S0）。
 */
import type { RendererBackend, RendererBackendEvent } from "./renderer-backend"
import type { FallbackRenderer } from "./terminal"

/**
 * opentui CliRenderer 的结构性子集——只保留 app.tsx 实际使用到的成员。
 */
export interface CliRendererLike {
	readonly isDestroyed: boolean
	readonly width: number
	readonly height: number
	requestRender(): void
	on(event: string, listener: () => void): unknown
	off?(event: string, listener: () => void): unknown
	once(event: string, listener: () => void): unknown
	setTerminalTitle(title: string): void
	useMouse: boolean
	suspend(): void
	resume(): void
	setBackgroundColor(color: unknown): void
	toggleDebugOverlay(): void
}

/** opentui 适配：直接透传。 */
export class OpentuiRendererBackend implements RendererBackend {
	constructor(private readonly renderer: CliRendererLike) {}

	get isDestroyed() {
		return this.renderer.isDestroyed
	}
	get width() {
		return this.renderer.width
	}
	get height() {
		return this.renderer.height
	}

	requestRender() {
		this.renderer.requestRender()
	}

	on(event: RendererBackendEvent, listener: () => void): () => void {
		if (event === "frame") {
			// opentui 无 frame 事件面，作为 requestRender 的占位消费点（见接口注释）
		}
		this.renderer.on(event, listener)
		return () => {
			this.renderer.off?.(event, listener)
		}
	}

	once(event: "destroy", listener: () => void): void {
		this.renderer.once(event, listener)
	}

	setTerminalTitle(title: string) {
		this.renderer.setTerminalTitle(title)
	}

	set useMouse(v: boolean) {
		this.renderer.useMouse = v
	}
	get useMouse() {
		return this.renderer.useMouse
	}

	suspend() {
		this.renderer.suspend()
	}
	resume() {
		this.renderer.resume()
	}

	setBackgroundColor(color: unknown) {
		this.renderer.setBackgroundColor(color)
	}

	toggleDebugOverlay() {
		this.renderer.toggleDebugOverlay()
	}
}

/** fallback 适配：present 作为 requestRender；resize 转发给订阅者。 */
export class FallbackRendererBackend implements RendererBackend {
	private eventListeners = new Map<RendererBackendEvent, Set<() => void>>()
	private offResizeInternal: (() => void) | undefined
	private _isDestroyed = false

	constructor(private readonly renderer: FallbackRenderer) {
		this.offResizeInternal = this.renderer.onResize(() => this.emit("resize"))
	}

	get isDestroyed() {
		return this._isDestroyed
	}
	get width() {
		return this.renderer.getWidth()
	}
	get height() {
		return this.renderer.getHeight()
	}

	requestRender() {
		this.renderer.present(() => {})
	}

	on(event: RendererBackendEvent, listener: () => void): () => void {
		let set = this.eventListeners.get(event)
		if (!set) {
			set = new Set()
			this.eventListeners.set(event, set)
		}
		set.add(listener)
		return () => {
			set.delete(listener)
		}
	}

	once(event: "destroy", listener: () => void): void {
		const off = this.on(event, () => {
			off()
			listener()
		})
	}

	setTerminalTitle(title: string) {
		this.renderer.setTerminalTitle(title)
	}

	set useMouse(_v: boolean) {}
	get useMouse() {
		return false
	}

	suspend() {}
	resume() {}

	setBackgroundColor(_color: unknown) {}

	toggleDebugOverlay() {}

	/** 销毁适配层：解绑 resize 转发并置 isDestroyed。 */
	destroy() {
		this.offResizeInternal?.()
		this.offResizeInternal = undefined
		this._isDestroyed = true
		this.emit("destroy")
	}

	private emit(event: RendererBackendEvent) {
		this.eventListeners.get(event)?.forEach((l) => l())
	}
}