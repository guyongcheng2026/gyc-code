import { ENTER_SEQ, LEAVE_SEQ, renderDelta, renderFull } from "./diff"
import { Screen } from "./screen"
import { renderScreenToLines } from "./snapshot"
import { renderBudget, type RenderBudget } from "./capability"

const DEFAULT_BUDGET: RenderBudget = { maxFps: 60, mouseEnabled: true, kittyKeyboard: true }

/**
 * 鑷爺 fallback 娓叉煋鍣細缁堢鎶借薄涓庡抚璋冨害銆? *
 * TerminalBackend 鍙敞鍏ワ細ProcessBackend 缁戝畾鐪熷疄 stdout/stdin锛? * MemoryBackend 渚涙祴璇曚笌鏃?TTY 鍦烘櫙浣跨敤銆侳allbackRenderer 璐熻矗甯у悎骞? * 锛堝悓涓€ tick 鍐呭娆?present 鍙緭鍑轰竴娆★級涓?resize 鍏ㄩ噺閲嶇粯銆? */

export interface TerminalBackend {
	write(data: string): void
	getWidth(): number
	getHeight(): number
	setRawMode(on: boolean): void
	onResize(cb: () => void): () => void
	onInput(cb: (chunk: string) => void): () => void
	/** 鍚敤 SGR 1003 mouse tracking銆傝繑鍥炲彇娑堝嚱鏁?*/
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

	/** 娓叉煋鍣ㄦ槸鍚﹀凡閿€姣侊紙瀵归綈 RendererBackend.isDestroyed 濂戠害锛夈€?*/
	get isDestroyed(): boolean {
		return !this.started
	}

	get budget(): RenderBudget {
		return this.renderBudget
	}

	get currentScreen(): Screen {
		return this.screen
	}

	/** 璁㈤槄缁堢 resize 浜嬩欢锛堝澶栨毚闇诧紝渚涙娊璞″眰浣跨敤锛夈€?*/
	onResize(cb: () => void): () => void {
		return this.backend.onResize(cb)
	}

	/**
	 * 娉ㄥ唽 resize 閲嶇粯閽╁瓙锛圫1 slice 2锛氭秷闄ゆ棫甯冨眬闂抚锛夈€?	 *
	 * 鏃犻挬瀛愭椂 handleResize 鐩存帴杈撳嚭 resize 鍚庣殑鏃у唴瀹癸紙甯冨眬鏈洿鏂帮紝鍙劅鐭?	 * 闂抚锛夛紱鏈夐挬瀛愭椂鍏堟墽琛岄挬瀛愶紙娑堣垂鑰呴噸甯冨眬閲嶅啓 Screen 鍐呭锛夛紝鍐嶅叏閲?	 * 杈撳嚭鈥斺€斿缁堣緭鍑烘柊甯冨眬锛屾棤鍙屽抚銆?	 */
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

	/** 鎻愪氦涓€甯э細鍚堝苟鍚?tick 澶氭璋冪敤锛屽紓姝ヨ緭鍑哄閲忋€侳PS 鑺傛祦锛坧lain TTY 10fps / 鏍囧噯 60fps锛夈€?*/
	present(mutate: (screen: Screen) => void): void {
		mutate(this.screen)
		this.pendingFlush = true
		if (this.scheduled) return
		this.scheduled = true
		queueMicrotask(() => {
			this.scheduled = false
			if (!this.started) return
			// FPS 鑺傛祦锛歜udget.maxFps=0 琛ㄧず涓嶉檺棰戯紱>0 鏃舵渶灏忓抚闂撮殧 = 1000/maxFps ms
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
			// 鏈夋秷璐硅€呴挬瀛愶細鍏堥噸甯冨眬閲嶅啓鍐呭锛屽啀杈撳嚭锛堟棤闂抚锛?			this.screen.clear()
			try {
				this.resizeRepaint()
			} catch {
				// 重绘失败不阻断后续渲染，忽略
			}
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
