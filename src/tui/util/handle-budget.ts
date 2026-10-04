/**
 * opentui 原生句柄预算（长会话 / 超长会话崩溃的根治闸门）。
 *
 * 背景：opentui 0.5.6 的原生句柄表上限为 65,535（实测第 65,535 次
 * createTextBuffer 即返回无效句柄，表现为「打开会话即退出」）。句柄按
 * 「同时存活」计：单个 <text> 约占 3 个句柄（text_buffer + text_buffer_view +
 * native_renderable），带边框的 <box> 另占 1 个。
 *
 * 既有虚拟化（virtual-window.ts）只约束**消息条数**，不约束：
 *   - 单条消息内部的行数（一条 5 万行的工具输出即可独占全部预算）
 *   - 消息区之外的常驻 renderable（diff-viewer / sidebar / which-key / 浮层）
 * 本模块提供全局计数与估算，供渲染点查询是否还能挂载富渲染。
 *
 * 设计取舍：opentui 未暴露「已用句柄数」读取接口，故采用**保守估算 + 全局
 * 累计**：估算函数按行数与折行给出下界，HandleBudget 负责进程内累计与释放。
 * 估算偏保守（宁可提前降级为纯文本，也不撞上限崩溃）。
 */

/** opentui 0.5.6 原生句柄表硬上限（实测值）。 */
export const NATIVE_HANDLE_LIMIT = 65_535

/**
 * 为常驻 renderable 预留的额度：prompt 输入框、sidebar、which-key、
 * dialog 浮层等与消息数量无关的节点。
 *
 * 取 15,000 约占上限 23%，为这些常驻节点 + 布局中间态留出 4 倍余量。
 */
export const RESERVED_HANDLES = 15_000

/** 内容区可用句柄预算 = 总上限 − 常驻预留。 */
export const CONTENT_HANDLE_BUDGET = NATIVE_HANDLE_LIMIT - RESERVED_HANDLES

/** 单个 <text> 每渲染行占用的句柄数（text_buffer + view + native_renderable）。 */
export const HANDLES_PER_TEXT_ROW = 3

/** 块级结构（markdown 块 / <box>）额外占用的句柄数。 */
export const HANDLES_PER_BLOCK = 1

/** 估算折行用的默认列宽（真实列宽未知时的保守下界）。 */
const DEFAULT_COLS = 80

/**
 * 估算文本渲染后的视觉行数（含折行）。
 *
 * cols ≤ 1 归一为 1：终端宽度为 0/1 时除零会产生 Infinity 或死循环。
 */
export function visualRows(text: string, cols: number = DEFAULT_COLS): number {
  const width = Math.max(1, Math.floor(cols))
  let rows = 0
  let start = 0
  while (start <= text.length) {
    const end = text.indexOf("\n", start)
    const lineEnd = end === -1 ? text.length : end
    // 长度为 0 的行也占 1 行（空 <text> 同样创建句柄）
    rows += Math.max(1, Math.ceil((lineEnd - start) / width))
    if (end === -1) break
    start = end + 1
  }
  return Math.max(1, rows)
}

/**
 * 估算一段内容挂载为富渲染（markdown / diff / code）时占用的句柄数。
 *
 * 结构：每行按 HANDLES_PER_TEXT_ROW 计，空行分隔出的块各加 HANDLES_PER_BLOCK
 * （markdown 块级渲染会为块创建独立的 style/renderable）。
 */
export function estimateContentHandles(text: string, cols: number = DEFAULT_COLS): number {
  const rows = visualRows(text, cols)
  // 连续空行分隔出的块数（上限取行数，避免异常输入下额外遍历）
  let blocks = 0
  let blank = false
  let start = 0
  while (start <= text.length) {
    const end = text.indexOf("\n", start)
    const lineEnd = end === -1 ? text.length : end
    const isBlank = text.slice(start, lineEnd).trim().length === 0
    if (isBlank) blank = true
    else {
      if (blank) blocks += 1
      blank = false
    }
    if (end === -1) break
    start = end + 1
  }
  return rows * HANDLES_PER_TEXT_ROW + blocks * HANDLES_PER_BLOCK
}

/** 进程内句柄占用计数器：reserve / release 成对使用，fits 仅查询。 */
export class HandleBudget {
  #limit: number
  #used = 0

  constructor(limit: number = CONTENT_HANDLE_BUDGET) {
    this.#limit = Math.max(0, Math.floor(limit))
  }

  /**
   * 占用 n 个句柄；额度不足返回 false 且不改变占用。
   *
   * 必须拒掉非有限值：入参来自 estimateContentHandles（纯算术，输入含调用方给的列宽）。
   * 一旦算出 NaN，`#used + NaN > limit` 恒为 false，于是 NaN 被累加进 #used，
   * 此后所有比较都是 false —— 闸门被永久焊死，且没有任何报错。
   * 这不是理论风险：reserve 此前只有测试调用，是 LimitedContent 真正挂上富渲染后
   * 才第一次进入生产路径的。
   */
  reserve(n: number): boolean {
    if (!Number.isFinite(n)) return false
    const amount = Math.max(0, Math.floor(n))
    if (this.#used + amount > this.#limit) return false
    this.#used += amount
    return true
  }

  /** 归还 n 个句柄；下限钳到 0，避免 release 顺序颠倒导致负数。非有限值按 0 处理。 */
  release(n: number): void {
    if (!Number.isFinite(n)) return
    const amount = Math.max(0, Math.floor(n))
    this.#used = Math.max(0, this.#used - amount)
  }

  /** 仅查询是否会超限，不改变占用。非有限值一律判为装得下（与 reserve 的拒绝策略一致）。 */
  fits(n: number): boolean {
    if (!Number.isFinite(n)) return false
    return this.#used + Math.max(0, Math.floor(n)) <= this.#limit
  }

  /** 仅查询预留额度是否够用（fits 的别名语义：不占用）。 */
  tryReserve(n: number): boolean {
    return this.reserve(n)
  }

  used(): number {
    return this.#used
  }

  available(): number {
    return Math.max(0, this.#limit - this.#used)
  }

  limit(): number {
    return this.#limit
  }

  exhausted(): boolean {
    return this.#used >= this.#limit
  }

  reset(): void {
    this.#used = 0
  }
}

/** 进程级单例：渲染点共用同一份占用。 */
export const globalHandleBudget = new HandleBudget(CONTENT_HANDLE_BUDGET)

/**
 * 判断一段内容是否还能按富文本挂载；不可用时调用方应降级为纯文本摘要。
 *
 * 纯查询，不产生占用（占用由调用方在节点挂载/卸载时自行 reserve/release）。
 */
export function canRenderRich(text: string, cols: number = DEFAULT_COLS, budget = globalHandleBudget): boolean {
  return budget.fits(estimateContentHandles(text, cols))
}
