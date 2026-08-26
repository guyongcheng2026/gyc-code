/**
 * P2 立项前置：RendererBackend 抽象层（接口冻结稿）。
 *
 * 目标：为「渲染会话」提供与具体渲染器无关的最小契约，使 opentui 与自研
 * fallback 成为可编译切换的双实现（GYC_TUI_BACKEND 分流）。
 *
 * 边界（正是文档 P2 要求）：
 * - 本文件只冻结契约与工厂签名，不接入产线调用点（那是 S0）。
 * - 接口成员以 src/tui/app.tsx 对 renderer 的实际使用面为基准收窄，
 *   未使用的 opentui 专属能力不进入契约（保持最小）。
 * - 构建开关 GYC_RESERVE=renderer 存在但本文件不依赖，仅提供类型。
 */

/** RendererBackend 事件集：与 opentui CliRenderer 事件面收窄对齐。 */
export type RendererBackendEvent = "resize" | "frame" | "destroy"

/** 统一的渲染会话契约。 */
export interface RendererBackend {
	readonly isDestroyed: boolean
	readonly width: number
	readonly height: number

	/** 请求下一次完整渲染（增量帧仍由实现自行差分）。 */
	requestRender(): void

	/** 订阅/取消订阅事件。返回取消订阅函数。 */
	on(event: RendererBackendEvent, listener: () => void): () => void
	/** 一次性的 destroy 订阅（对齐 app.tsx `renderer.once("destroy", ...)`）。 */
	once(event: "destroy", listener: () => void): void

	/** 终端窗口标题（空串复位）。 */
	setTerminalTitle(title: string): void

	/** 鼠标事件开关（注释性 setter 保留属性语义）。 */
	useMouse: boolean

	/** 挂起/恢复渲染循环（例如 job control SIGTSTP/SIGCONT）。 */
	suspend(): void
	resume(): void

	/** 设置渲染背景色。入参为渲染器载体可接受的色值（opentui 为 RGBA）或空。 */
	setBackgroundColor(color: unknown): void

	/** 调试覆盖层开关（opentui 的 debugOverlay：console overlay）。 */
	toggleDebugOverlay(): void
}

/**
 * 创建后端的前置选项。当前两个实现都从既有渲染器/后端对象适配而来，
 * 因此工厂仅做分流、不直接持有参差形态。产线接入（S0）前保留为设计签名。
 */
export type RendererBackendKind = "opentui" | "fallback" | "auto"