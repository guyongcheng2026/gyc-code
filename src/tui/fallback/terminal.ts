import { ENTER_SEQ, LEAVE_SEQ, renderDelta, renderFull } from "./diff"
import { Screen } from "./screen"
import { renderScreenToLines } from "./snapshot"
import { renderBudget, type RenderBudget } from "./capability"

const DEFAULT_BUDGET: RenderBudget = { maxFps: 60, mouseEnabled: true, kittyKeyboard: true }

/**
 * 自研 fallback 渲染器：终端抽象与帧调度�? *
 * TerminalBackend 可注入：ProcessBackend 绑定真实 stdout/stdin�? * MemoryBackend 供测试与�?TTY 场景使用。FallbackRenderer 负责帧合�? * （同丢� tick 内多�?present 只输出一次）�?resize 全量重绘�? */

export interface TerminalBackend {
	write(data: string): void
	getWidth(): number
	getHeight(): number
	setRawMode(on: boolean): void
	onResize(cb: () => void): () => void
	onInput(cb: (chunk: string) => void): () => void
	/** 启用 SGR 1003 mouse tracking。返回取消函�?*/
	onMouse?(cb: (event: MouseEvent) => void): () => void
	start(): void
	stop(): void
}

export interface MouseEvent {
	button: 0 | 1 | 2 | 3 | 4 | 5 | 64 | 65
	x: number
	y: number
	type: "press" | "release" | "drag" | "scroll"
}

export class ProcessBackend implements TerminalBackend {
  private resizeCbs = new Set<() => void>()
  private inputCbs = new Set<(chunk: string) => void>()
  private mouseCbs = new Set<(event: MouseEvent) => void>()
  private dataHandler: ((chunk: Buffer) => void) | undefined
  private carry: string = ""
  private mouseEnabled = false

  constructor(private readonly stdout: NodeJS.WriteStream, private readonly stdin: NodeJS.ReadStream) {}

  write(data: string): void {
    const merged = this.carry + data
    let safe = merged.length
    while (safe > 0) {
      const b = merged.charCodeAt(safe - 1)
      if (b < 0x80 || b > 0xBF) break
      safe--
    }
    this.carry = merged.slice(safe)
    if (safe > 0) this.stdout.write(merged.slice(0, safe))
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

	private parseMouseSGR(buf: string): { event: MouseEvent; consumed: number } | null {
		if (buf[0] !== "\x1b" || buf[1] !== "[" || buf[2] !== "<") return null
		const end = buf.indexOf("M", 3)
		if (end === -1) return null
		const body = buf.slice(3, end)
		const parts = body.split(";")
		if (parts.length !== 3) return null
		const cb = Number(parts[0])
		const x = Number(parts[1]) - 1
		const y = Number(parts[2]) - 1
		if (Number.isNaN(cb) || Number.isNaN(x) || Number.isNaN(y)) return null
		const motion = (cb & 32) !== 0
		const scrollUp = cb === 64
		const scrollDown = cb === 65
		const release = (cb & 3) === 3
		const buttonCode = (cb & 3) as 0 | 1 | 2
		const event: MouseEvent = {
			button: scrollUp ? 64 : scrollDown ? 65 : release ? 3 : buttonCode,
			x,
			y,
			type: release ? "release" : motion ? "drag" : scrollUp || scrollDown ? "scroll" : "press",
		}
		return { event, consumed: end + 1 }
	}

	private dispatchMouse(buf: string): string {
		while (buf.length > 0) {
			const parsed = this.parseMouseSGR(buf)
			if (parsed) {
				for (const cb of this.mouseCbs) cb(parsed.event)
				buf = buf.slice(parsed.consumed)
			} else {
				break
			}
		}
		return buf
	}

	onMouse(cb: (event: MouseEvent) => void): () => void {
		this.mouseCbs.add(cb)
		if (!this.mouseEnabled) {
			this.mouseEnabled = true
			this.stdout.write("\x1b[?1003h\x1b[?1006h")
		}
		return () => {
			this.mouseCbs.delete(cb)
			if (this.mouseCbs.size === 0 && this.mouseEnabled) {
				this.mouseEnabled = false
				this.stdout.write("\x1b[?1006l\x1b[?1003l")
			}
		}
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
				let text = chunk.toString("utf8")
				if (this.mouseCbs.size > 0) text = this.dispatchMouse(text)
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
	private pendingFlush = false
	private started = false
	private offResize: (() => void) | undefined
	private resizeRepaint: (() => void) | undefined
	private readonly renderBudget: RenderBudget
	private lastFrameTime = 0

	constructor(private readonly backend: TerminalBackend, budget: RenderBudget = DEFAULT_BUDGET) {
		this.screen = new Screen(backend.getWidth(), backend.getHeight())
		this.renderBudget = budget
	}

	/** 渲染器是否已锢�毁（对齐 RendererBackend.isDestroyed 契约）��?*/
	get isDestroyed(): boolean {
		return !this.started
	}

	get budget(): RenderBudget {
		return this.renderBudget
	}

	get currentScreen(): Screen {
		return this.screen
	}

	/** 订阅终端 resize 事件（对外暴露，供抽象层使用）��?*/
	onResize(cb: () => void): () => void {
		return this.backend.onResize(cb)
	}

	/**
	 * 注册 resize 重绘钩子（S1 slice 2：消除旧布局闪帧）��?	 *
	 * 无钩子时 handleResize 直接输出 resize 后的旧内容（布局未更新，可感�?	 * 闪帧）；有钩子时先执行钩子（消费者重布局重写 Screen 内容），再全�?	 * 输出—��始终输出新布局，无双帧�?	 */
	setResizeRepaint(cb: () => void): void {
		this.resizeRepaint = cb
	}

	getWidth(): number {
		return this.backend.getWidth()
	}

	getHeight(): number {
		return this.backend.getHeight()
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

	/** 提交丢�帧：合并�?tick 多次调用，异步输出增量��FPS 节流（plain TTY 10fps / 标准 60fps）��?*/
	present(mutate: (screen: Screen) => void): void {
		mutate(this.screen)
		this.pendingFlush = true
		if (this.scheduled) return
		this.scheduled = true
		queueMicrotask(() => {
			this.scheduled = false
			if (!this.started) return
			// FPS 节流：budget.maxFps=0 表示不限频；>0 时最小帧间隔 = 1000/maxFps ms
			if (this.renderBudget.maxFps > 0) {
				const minInterval = 1000 / this.renderBudget.maxFps
				const elapsed = performance.now() - this.lastFrameTime
				if (elapsed < minInterval) {
					setTimeout(() => {
						if (!this.started || !this.pendingFlush) return
						this.pendingFlush = false
						this.flushFrame()
					}, minInterval - elapsed)
					return
				}
			}
			this.pendingFlush = false
			this.flushFrame()
		})
	}

	private flushFrame(): void {
		if (!this.started) return
		const delta = this.prevScreen ? renderDelta(this.prevScreen, this.screen) : renderFull(this.screen)
		if (delta.length > 0) {
			this.backend.write(delta)
			this.prevScreen = this.snapshotCurrent()
		} else if (this.prevScreen !== undefined) {
			this.prevScreen.syncStampsFrom(this.screen)
		}
		this.lastFrameTime = performance.now()
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
		if (this.resizeRepaint) {
			// 有消费��钩子：先重布局重写内容，再输出（无闪帧�?			this.screen.clear()
			try {
				this.resizeRepaint()
			} catch {}
		}
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
