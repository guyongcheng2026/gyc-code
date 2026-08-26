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
export const VIRTUAL_MAX_WINDOW = 200

export const VIRTUAL_DEFAULT_STATE: VirtualWindowState = { anchorID: undefined, full: false }

/** 当前完整渲染起点：index < renderFrom 的消息折叠为单行摘要。 */
export function virtualRenderFrom(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
): number {
  if (state.full) return 0
  const id = state.anchorID
  if (!id) return Math.max(0, messages.length - VIRTUAL_WINDOW)
  const idx = messages.findIndex((m) => m.id === id)
  // 锚点消息被 revert 删除等场景：安全回退全展开
  return idx === -1 ? 0 : idx
}

/** 滚动到顶/点击提示行：向上多展开一批（步进 EXPAND_STEP，到顶转 full）。 */
export function virtualExpandMore(
  state: VirtualWindowState,
  messages: ReadonlyArray<{ id: string }>,
): VirtualWindowState {
  const from = virtualRenderFrom(state, messages)
  if (from === 0) return state
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
