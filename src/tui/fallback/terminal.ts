import { ENTER_SEQ, LEAVE_SEQ, renderDelta, renderFull } from "./diff"
import { Screen } from "./screen"

/**
 * 自研 fallback 渲染器：终端抽象与帧调度。
 *
 * TerminalBackend 可注入：ProcessBackend 绑定真实 stdout/stdin，
 * MemoryBackend 供测试与无 TTY 场景使用。FallbackRenderer 负责帧合并
 * （同一 tick 内多次 present 只输出一次）与 resize 全量重绘。
 */

export interface TerminalBackend {
	write(data: string): void
	getWidth(): number
	getHeight(): number
	setRawMode(on: boolean): void
	onResize(cb: () => void): () => void
	onInput(cb: (chunk: string) => void): () => void
	start(): void
	stop(): void
}

export class ProcessBackend implements TerminalBackend {
	private resizeCbs = new Set<() => void>()
	private inputCbs = new Set<(chunk: string) => void>()
	private dataHandler: ((chunk: Buffer) => void) | undefined

	constructor(private readonly stdout: NodeJS.WriteStream, private readonly stdin: NodeJS.ReadStream) {}

	write(data: string): void {
		this.stdout.write(data)
	}

	getWidth(): number {
		return this.stdout.columns || 80
	}

	getHeight(): number {
		return this.stdout.rows || 24
	}

	setRawMode(on: boolean): void {
		if (this.stdin.isTTY) this.stdin.setRawMode(on)
	}

	onResize(cb: () => void): () => void {
		this.resizeCbs.add(cb)
		this.stdout.on("resize", cb)
		return () => {
			this.resizeCbs.delete(cb)
			this.stdout.off("resize", cb)
		}
	}

	onInput(cb: (chunk: string) => void): () => void {
		this.inputCbs.add(cb)
		if (!this.dataHandler) {
			this.dataHandler = (chunk: Buffer) => {
				const text = chunk.toString("utf8")
				for (const handler of this.inputCbs) handler(text)
			}
			this.stdin.on("data", this.dataHandler)
		}
		return () => {
			this.inputCbs.delete(cb)
			if (this.inputCbs.size === 0 && this.dataHandler) {
				this.stdin.off("data", this.dataHandler)
				this.dataHandler = undefined
			}
		}
	}

	start(): void {}

	stop(): void {}
}

export class MemoryBackend implements TerminalBackend {
	public output = ""
	public width: number
	public height: number
	public rawMode = false
	private resizeCb: (() => void) | undefined
	private inputCb: ((chunk: string) => void) | undefined

	constructor(width = 80, height = 24) {
		this.width = width
		this.height = height
	}

	write(data: string): void {
		this.output += data
	}

	getWidth(): number {
		return this.width
	}

	getHeight(): number {
		return this.height
	}

	setRawMode(on: boolean): void {
		this.rawMode = on
	}

	onResize(cb: () => void): () => void {
		this.resizeCb = cb
		return () => {
			this.resizeCb = undefined
		}
	}

	start(): void {}

	stop(): void {}

	onInput(cb: (chunk: string) => void): () => void {
		this.inputCb = cb
		return () => {
			this.inputCb = undefined
		}
	}

	emitInput(text: string): void {
		this.inputCb?.(text)
	}

	emitResize(width: number, height: number): void {
		this.width = width
		this.height = height
		this.resizeCb?.()
	}
}

export class FallbackRenderer {
	private screen: Screen
	private prevScreen: Screen | undefined
	private scheduled = false
	private started = false
	private offResize: (() => void) | undefined

	constructor(private readonly backend: TerminalBackend) {
		this.screen = new Screen(backend.getWidth(), backend.getHeight())
	}

	get currentScreen(): Screen {
		return this.screen
	}

	start(): void {
		this.backend.start()
		this.backend.setRawMode(true)
		this.offResize = this.backend.onResize(() => this.handleResize())
		this.screen = new Screen(this.backend.getWidth(), this.backend.getHeight())
		this.prevScreen = undefined
		this.started = true
		this.backend.write(ENTER_SEQ)
		this.flushFull()
	}

	/** 提交一帧：合并同 tick 多次调用，异步输出增量。 */
	present(mutate: (screen: Screen) => void): void {
		mutate(this.screen)
		if (this.scheduled) return
		this.scheduled = true
		queueMicrotask(() => {
			this.scheduled = false
			if (!this.started) return
			const delta = this.prevScreen ? renderDelta(this.prevScreen, this.screen) : renderFull(this.screen)
			if (delta.length > 0) {
				this.backend.write(delta)
				this.prevScreen = this.snapshotCurrent()
			}
		})
	}

	stop(): void {
		this.started = false
		this.offResize?.()
		this.offResize = undefined
		this.backend.setRawMode(false)
		this.backend.write(LEAVE_SEQ)
		this.backend.stop()
	}

	private handleResize(): void {
		if (!this.started) return
		this.screen.resize(this.backend.getWidth(), this.backend.getHeight())
		this.prevScreen = undefined
		this.flushFull()
	}

	private flushFull(): void {
		this.backend.write(renderFull(this.screen))
		this.prevScreen = this.snapshotCurrent()
	}

	private snapshotCurrent(): Screen {
		return this.screen.clone()
	}
}
