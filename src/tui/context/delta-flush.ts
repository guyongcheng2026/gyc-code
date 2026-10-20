// 流式 delta 的自适应上屏调度器。
// 对标 pi agent 的 16ms（60fps）流式节奏（pi-tui MIN_RENDER_INTERVAL_MS=16，
// 每个 message_update 直接 requestRender）：
// - 涓流（token 间隔 ≥ 窗口）：立即排空，逐 token 直出，首字延迟趋近 0
// - 洪泛：按固定窗口合并为一次 store 写，避免每 token 触发整块 markdown
//   重解析（tree-sitter WASM），这正是旧版 30ms 固定攒批的初衷
export const DELTA_FLUSH_MS = 30

export function nextFlushDelayMs(lastFlushAt: number, now: number, intervalMs = DELTA_FLUSH_MS): number {
  const elapsed = now - lastFlushAt
  // elapsed < 0（时钟回拨）与已满窗口同样立即排空，避免算出负延迟
  if (elapsed < 0 || elapsed >= intervalMs) return 0
  return intervalMs - elapsed
}

export type DeltaFlushController = {
  schedule(): void
  dispose(): void
}

export function createDeltaFlushController(flush: () => void, intervalMs = DELTA_FLUSH_MS): DeltaFlushController {
  let timer: ReturnType<typeof setTimeout> | undefined
  let lastFlushAt = 0
  return {
    schedule() {
      if (timer !== undefined) return
      timer = setTimeout(
        () => {
          timer = undefined
          lastFlushAt = performance.now()
          flush()
        },
        nextFlushDelayMs(lastFlushAt, performance.now(), intervalMs),
      )
    },
    dispose() {
      if (timer === undefined) return
      clearTimeout(timer)
      timer = undefined
    },
  }
}

/**
 * 丢弃计数的默认限频窗口（毫秒）。
 *
 * 为什么必须限频：流式期可达 60 次/秒，逐条落库会写爆 error_audit 表。
 */
export const DROP_LOG_INTERVAL_MS = 60_000

export type DropCounter = {
  /**
   * 记录一次丢弃。同一键在窗口内只放行一条日志，其余只累加计数。
   * 返回值里 emit 指示本次是否应当输出日志。
   */
  record(key: string, count: number): { emit: boolean; dropped: number; suppressed: number }
  /** 累计丢弃总条数。 */
  total(): number
  /** 累计被限频抑制的条数。 */
  suppressed(): number
}

export function createDropCounter(intervalMs = DROP_LOG_INTERVAL_MS): DropCounter {
  const emittedAt = new Map<string, number>()
  let total = 0
  let suppressedCount = 0
  return {
    record(key, count) {
      total += count
      const now = Date.now()
      const last = emittedAt.get(key)
      if (last !== undefined && now - last < intervalMs) {
        suppressedCount += count
        return { emit: false, dropped: total, suppressed: suppressedCount }
      }
      emittedAt.set(key, now)
      return { emit: true, dropped: total, suppressed: suppressedCount }
    },
    total() {
      return total
    },
    suppressed() {
      return suppressedCount
    },
  }
}

/**
 * 到达序水位线：解决「message.updated（带 completed）先于最后一批 delta 落库」
 * 导致末尾文字迟到一帧的问题。
 *
 * 事件派发是同步 FIFO（src/tui/context/sdk.tsx 的 flush 里逐个 emit），故
 * 「到达序」即「处理序」：给每次到达的事件分配一个单调递增的 seq 后，
 *   - delta 到达时把 seq 记进该 pending delta；
 *   - message.updated 带来 time.completed 时，把该消息的完成水位线记为当前 seq。
 * flush 时判定：
 *   - delta.seq ≤ 完成水位线 → 它早于完成事件到达，只是被 30ms 攒批延迟 → 必须写入；
 *   - delta.seq > 完成水位线 → 晚于完成事件到达 → 丢弃，不污染已完结消息。
 *
 * 不选「在 message.updated 里先冲刷再置完成」，是因为那会打散攒批收益
 * （洪泛期每条 message.updated 都触发一次 store 写，与「避免高频 token 逐个
 * 触发 markdown 重解析」的初衷冲突），且仍需额外的完成态拒收判断。
 */

/** 单条待写入的流式增量。seq 为该增量所累积文本的最早到达序。 */
export type PendingDelta = {
  sessionID: string
  messageID: string
  partID: string
  field: string
  text: string
  seq: number
}

/** 到达序分桶：before = 早于/等于完成水位线（必须写入），after = 晚于（丢弃）。 */
export type DeltaArrival = "before" | "after"

/**
 * 按到达序判定 delta 相对完成事件的先后。
 *
 * 无完成水位线（消息尚未完成）时一律视为 before，必须写入。
 */
export function classifyDeltaArrival(seq: number, completedSeq: number | undefined): DeltaArrival {
  if (completedSeq === undefined) return "before"
  return seq <= completedSeq ? "before" : "after"
}

/**
 * pending delta 的攒批 key。
 *
 * 早/晚两个分桶必须落到不同 key：否则「完成前到达的半段文本」与「完成后到达
 * 的残留文本」会并成一条，既丢不掉残留、又会把残留写进已完结消息。
 */
export function pendingDeltaKey(
  messageID: string,
  partID: string,
  field: string,
  arrival: DeltaArrival,
): string {
  const base = `${messageID}:${partID}:${field}`
  return arrival === "after" ? `${base}#late` : base
}

/**
 * 到达序水位线表：messageID → 完成事件到达序。
 *
 * 首次完成事件即消息的终态锚点；重复到达的 completed 事件不放宽水位线
 * （否则会把两次完成之间的残留 delta 又放回「必须写入」侧，重新引入污染）。
 */
export type CompletionWatermark = {
  mark(messageID: string, seq: number): void
  get(messageID: string): number | undefined
  read(): ReadonlyMap<string, number>
  /** 丢弃某个消息的水位线（消息被删除/淘汰时调用）。 */
  delete(messageID: string): void
  /** 只保留 keepIDs 内的水位线，返回删除条数。 */
  prune(keepIDs: Iterable<string>): number
}

export function createCompletionWatermark(): CompletionWatermark {
  const watermarks = new Map<string, number>()
  return {
    mark(messageID, seq) {
      const current = watermarks.get(messageID)
      if (current !== undefined && current <= seq) return
      watermarks.set(messageID, seq)
    },
    get(messageID) {
      return watermarks.get(messageID)
    },
    delete(messageID) {
      watermarks.delete(messageID)
    },
    prune(keepIDs) {
      const keep = new Set(keepIDs)
      let removed = 0
      for (const messageID of [...watermarks.keys()]) {
        if (keep.has(messageID)) continue
        watermarks.delete(messageID)
        removed += 1
      }
      return removed
    },
    read() {
      return watermarks
    },
  }
}

/**
 * 按完成水位线把待写入的 delta 分为「必须写入」与「必须丢弃」两组。
 *
 * 完成水位线按所属 messageID 查（pending delta 的 key 是
 * messageID:partID:field，但判定只看 messageID）。
 */
export function classifyPendingDeltas<T extends { messageID: string; seq: number }>(
  deltas: Iterable<T>,
  completedSeq: ReadonlyMap<string, number>,
): { apply: T[]; drop: T[] } {
  const apply: T[] = []
  const drop: T[] = []
  for (const delta of deltas) {
    const watermark = completedSeq.get(delta.messageID)
    if (watermark !== undefined && delta.seq > watermark) drop.push(delta)
    else apply.push(delta)
  }
  return { apply, drop }
}
