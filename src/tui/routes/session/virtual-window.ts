// 消息视口虚拟化的纯窗口计算逻辑（从 session/index.tsx 提炼，便于单测）。
//
// 长会话的 <For> 全量挂载所有消息的 markdown/tree-sitter 组件树，是主
// 进程唯一内存增长源（100+ 条消息可达 300MB+）。窗口化渲染：
// - 尾部 VIRTUAL_WINDOW 条完整渲染（流式 pending 天然在窗口内）
// - 更早消息渲染为单行摘要（无 markdown 子树，成本 ~1/50）
// - 展开锚定消息 ID（而非绝对索引），revert/undo 改变列表时不错位
// - 短会话（≤VIRTUAL_WINDOW 条）renderFrom 恒为 0：零折叠、零行为变化

export interface VirtualWindowState {
  /** 展开到的最早消息 ID；undefined = 默认尾部窗口（随新消息前移） */
  readonly anchorID: string | undefined
  /** 已展开全部；新消息全渲染，超过 MAX_WINDOW 回默认窗口防无限增长 */
  readonly full: boolean
}

export const VIRTUAL_WINDOW = 40
export const VIRTUAL_EXPAND_STEP = 60

/**
 * 单个会话同时完整渲染的消息条数上限（原生句柄预算）。
 *
 * opentui 0.5.6 的原生句柄表上限为 65,535（实测第 65,535 次 createTextBuffer
 * 即返回无效句柄）。句柄按「同时存活」计：单个 <text> 约占 3 个句柄
 * （text_buffer + text_buffer_view + native_renderable），带边框的 <box>
 * 另占 1 个。按真实消息结构（正文 1 个 text + 每工具 1~2 个 + 尾部 1 个，
 * 外层 2~3 个 box）实测每条消息约 21 个句柄，「每条 2 个工具」的结构在
 * 2,700 条全量渲染时逼近上限、每条 6 个工具时 1,300 条即耗尽。
 *
 * 本常量是「用户主动向上展开」时的终点：默认窗口（VIRTUAL_WINDOW = 40）
 * 之外的继续展开最多只能把完整渲染区推到最近 600 条，更早的消息一律降级为
 * 单行摘要（受 VIRTUAL_COLLAPSED_SUMMARY_LIMIT 约束）或不挂载节点。
 * 600 × 21 + 500 摘要 × 5 ≈ 15,100 个句柄，相对 65,535 留有 4 倍以上余量，
 * 足以容纳 prompt / sidebar / 浮层等常驻 renderable。
 *
 * 取 600 而非更小：≤600 条的会话预算起点恒为 0，行为与引入预算前逐位一致，
 * 预算只在真正超长（2,000+ 条）的会话上才起作用。
 */
export const VIRTUAL_MAX_WINDOW = 600

/**
 * 折叠区实际挂载的摘要节点上限。
 *
 * 折叠消息并非「零成本」：每条 CollapsedMessage 仍会挂一个 <box>+<text>，
 * 约占 5 个 opentui 原生句柄（text_buffer + text_buffer_view +
 * syntax_style + native_renderable + box 的 native_renderable）。
 * 千条以上的超长会话逐条渲染折叠摘要即会逼近该上限，表现为打开会话即崩溃
 * 降级安全模式后退出。故折叠区只保留最近 LIMIT 条摘要节点，更早的消息
 * 仍计入消息总数与滚动条高度，但不挂载 renderable。
 *
 * 该上限对全部状态生效（含「已全展开」与「锚定翻阅」）：这两条路径过去会
 * 直接返回 0 取消裁剪，是超长会话崩溃的主要来源。
 */
export const VIRTUAL_COLLAPSED_SUMMARY_LIMIT = 500

export const VIRTUAL_DEFAULT_STATE: VirtualWindowState = { anchorID: undefined, full: false }

/**
 * 句柄预算允许的完整渲染区起点：渲染区最多保留最近 VIRTUAL_MAX_WINDOW 条。
 * 短会话（消息数 ≤ 上限）返回 0，即零折叠，行为与虚拟化前完全一致。
 */
function budgetRenderFrom(length: number): number {
  return Math.max(0, length - VIRTUAL_MAX_WINDOW)
}

/** 当前完整渲染起点：index < renderFrom 的消息折叠为单行摘要。 */
export function virtualRenderFrom(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
): number {
  const ceiling = budgetRenderFrom(messages.length)
  if (state.full) return ceiling
  const id = state.anchorID
  if (!id) return Math.max(0, messages.length - VIRTUAL_WINDOW)
  const idx = messages.findIndex((m) => m.id === id)
  // 锚点消息被 revert 删除等场景：回退到句柄预算起点（而非全展开）
  if (idx === -1) return ceiling
  // renderFrom 越大 = 完整渲染的消息越少，故取 max(锚点, 预算起点)：
  // 锚点落在预算内按锚点定位；早于预算起点时钉在起点，更早的消息降级为摘要。
  return Math.max(idx, ceiling)
}

/**
 * 折叠区摘要节点的实际挂载起点：index < 该值的消息完全不挂 renderable。
 *
 * 与 virtualRenderFrom 的区别：后者决定「哪条之前算折叠」（仍渲染单行摘要），
 * 本函数在此之上再按 VIRTUAL_COLLAPSED_SUMMARY_LIMIT 截断，防止超长会话
 * 把原生句柄表撑爆。区间 [virtualCollapsedRenderFrom, virtualRenderFrom)
 * 渲染单行摘要，[virtualRenderFrom, ∞) 完整渲染。
 *
 * 截断对全部状态生效：默认窗口、锚定翻阅、已全展开都只保留最近 LIMIT 条
 * 摘要节点。
 */
export function virtualCollapsedRenderFrom(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
): number {
  const from = virtualRenderFrom(state, messages)
  return Math.max(0, from - VIRTUAL_COLLAPSED_SUMMARY_LIMIT)
}

/** 是否已顶到句柄预算上限：继续向上展开也不会再渲染更多完整消息。 */
export function virtualExpansionCapped(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
): boolean {
  return virtualRenderFrom(state, messages) <= budgetRenderFrom(messages.length)
}

/** 滚动到顶/点击提示行：向上多展开一批（步进 EXPAND_STEP，到顶转 full）。 */
export function virtualExpandMore(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
): VirtualWindowState {
  const from = virtualRenderFrom(state, messages)
  if (from === 0) return state
  // 顶到句柄预算上限：保持不动（继续展开只会空转改写锚点，不释放任何句柄）
  if (from <= budgetRenderFrom(messages.length)) return state
  const next = Math.max(0, from - VIRTUAL_EXPAND_STEP)
  if (next === 0) return { anchorID: undefined, full: true }
  return { anchorID: messages[next]?.id, full: false }
}

/** 消息跳转目标在折叠区时展开（含目标上方少量上下文），否则不动。 */
export function virtualEnsureVisible(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
  messageID: string,
): VirtualWindowState {
  const idx = messages.findIndex((m) => m.id === messageID)
  if (idx === -1) return state
  const from = virtualRenderFrom(state, messages)
  if (idx >= from) return state
  const next = Math.max(0, idx - 5)
  if (next === 0) return { anchorID: undefined, full: true }
  return { anchorID: messages[next]?.id, full: false }
}

/**
 * 新消息到达时的状态迁移：
 * - full：消息总数超 MAX_WINDOW 时回默认窗口（防内存无限增长）
 * - anchor 锚定 + 用户在底部：回默认尾部窗口（历史无需保持展开）
 * - anchor 锚定 + 用户在看历史：保持锚点（窗口自然变长，等回底/超限收敛）
 */
export function virtualOnNewMessage(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
  atBottom: boolean,
): VirtualWindowState {
  if (state.full) {
    return messages.length > VIRTUAL_MAX_WINDOW ? VIRTUAL_DEFAULT_STATE : state
  }
  if (state.anchorID && atBottom) return VIRTUAL_DEFAULT_STATE
  return state
}
