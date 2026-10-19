import type { Key } from "../input"

/**
 * M7：keymap 核心（命令注册、绑定、按键匹配、序列前缀、leader 超时）。
 *
 * 对齐产线 `src/tui/keymap.tsx` 用到的核心成员：`stringifyKeyStroke`、
 * `Binding`、`KeymapProvider`、`useKeymap`、`useBindings`、`dispatchCommand`。
 *
 * 明确不支持（产线迁移时需适配层，见计划文档 M7）：
 *  - layer/mode 栈（`registerLayerFields` + `setData` 的 mode 守卫）
 *  - which-key 提示、`registerManagedTextareaLayer`、base-layout fallback
 */

/** 规范化按键名：`ctrl+c` / `up` / `a` / `shift+up` / 序列用空格分隔 `g g`。 */
export function stringifyKeyStroke(key: Key): string | undefined {
	switch (key.type) {
		case "text":
			return key.text.length === 1 ? key.text : undefined
		case "up":
		case "down":
		case "left":
		case "right":
		case "pageup":
		case "pagedown":
		case "home":
		case "end":
		case "enter":
		case "backspace":
		case "escape":
		case "ctrl-c":
			return withModifiers(key.type, key.modifiers)
		case "ctrl":
			// 0x01–0x1a 的控制字符本身携带 ctrl 语义（无修饰键元数据），固定加 ctrl 前缀
			return withModifiers(`ctrl+${key.key}`, key.modifiers)
		default:
			// paste/focus/mouse/cursor-request 不进 keymap
			return undefined
	}
}

function withModifiers(name: string, modifiers: Key["modifiers"]): string {
	const parts: string[] = []
	if (modifiers?.ctrl === true) parts.push("ctrl")
	if (modifiers?.alt === true) parts.push("alt")
	if (modifiers?.shift === true) parts.push("shift")
	if (modifiers?.meta === true) parts.push("meta")
	parts.push(name)
	return parts.join("+")
}

export interface Binding {
	/** 单键（`ctrl+c`）或序列（`g g`，空格分隔） */
	keys: string
	command: string
	args?: unknown
	/** 是否在命令列表中隐藏（对齐产线 command.hidden） */
	hidden?: boolean
}

export interface KeymapCommand {
	readonly name: string
	run: (args?: unknown) => void
	hidden?: boolean
}

export interface KeymapOptions {
	/** 序列等待超时（ms）；0 = 不超时。默认 1000。 */
	leaderTimeout?: number
}

interface BindingNode {
	command?: { name: string; args?: unknown }
	children: Map<string, BindingNode>
}

export class Keymap {
	private commands = new Map<string, KeymapCommand>()
	private root: BindingNode = { children: new Map() }
	private pending: string[] = []
	private timer: ReturnType<typeof setTimeout> | undefined
	private readonly leaderTimeout: number

	constructor(options: KeymapOptions = {}) {
		this.leaderTimeout = options.leaderTimeout ?? 1000
	}

	/** 注册命令；同名覆盖。 */
	registerCommand(name: string, run: (args?: unknown) => void, hidden = false): void {
		this.commands.set(name, { name, run, hidden })
	}

	registerCommands(map: Record<string, (args?: unknown) => void>): void {
		for (const [name, run] of Object.entries(map)) this.registerCommand(name, run)
	}

	/** 绑定按键到命令；同键覆盖。 */
	bind(...bindings: Binding[]): void {
		this.root = { children: new Map() }
		for (const binding of bindings) {
			const strokes = binding.keys.trim().split(/\s+/)
			let node = this.root
			for (const stroke of strokes) {
				let next = node.children.get(stroke)
				if (next === undefined) {
					next = { children: new Map() }
					node.children.set(stroke, next)
				}
				node = next
			}
			node.command = { name: binding.command, args: binding.args }
		}
	}

	getCommands(): readonly KeymapCommand[] {
		return [...this.commands.values()]
	}

	/** 当前等待中的序列前缀（未组成完整绑定）。 */
	getPending(): string | undefined {
		return this.pending.length > 0 ? this.pending.join(" ") : undefined
	}

	clearPending(): void {
		this.pending = []
		this.clearTimer()
	}

	/**
	 * 处理按键：完整匹配 → 执行命令；前缀匹配 → 进入等待（消费按键）；
	 * 都不匹配 → 清空等待并放行（返回 false）。
	 */
	handleKey(key: Key): boolean {
		const stroke = stringifyKeyStroke(key)
		if (stroke === undefined) return false
		const candidates = [...this.pending, stroke]

		let node: BindingNode | undefined = this.root
		for (const part of candidates) {
			node = node?.children.get(part)
			if (node === undefined) break
		}
		if (node === undefined) {
			this.clearPending()
			return false
		}
		if (node.command !== undefined) {
			const command = this.commands.get(node.command.name)
			this.clearPending()
			if (command !== undefined) {
				command.run(node.command.args)
				return true
			}
			// 绑定指向未注册命令：视为未消费（放行）
			return false
		}
		// 前缀命中：进入等待，启动 leader 超时
		this.pending = candidates
		this.armTimer()
		return true
	}

	private armTimer(): void {
		this.clearTimer()
		if (this.leaderTimeout <= 0) return
		this.timer = setTimeout(() => this.clearPending(), this.leaderTimeout)
	}

	private clearTimer(): void {
		if (this.timer !== undefined) {
			clearTimeout(this.timer)
			this.timer = undefined
		}
	}
}
