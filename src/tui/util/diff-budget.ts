/**
 * 会话 diff 的字节预算（长会话内存增长的另一半来源）。
 *
 * 背景：sync.tsx 的 store 里 `session_diff[sessionID]` 存的是完整
 * SnapshotFileDiff[]，每项含一整份 patch 字符串。该数组随编辑次数单调增长
 * 且**无字节上限**；配合 20 个会话的 LRU（MAX_HYDRATED_SESSIONS），最坏情况
 * 下同时驻留 20 份完整 patch，是长会话 RSS 虚高的主要来源之一。
 *
 * 策略：写入前按字节预算裁剪，保留**最新**的文件（用户当前关注的正是刚改的
 * 那些），并把被裁数量带给 UI，避免「静默丢 diff」的误解。
 */
import type { SnapshotFileDiff } from "@gyccode/protocol/v2"

/** 单会话 diff 常驻字节上限 8MB：覆盖日常大量编辑，超出部分仅保留最新文件。 */
export const MAX_DIFF_BYTES = 8 * 1024 * 1024

/** 累计 patch 的 UTF-8 字节数（file 路径不计入，其体量可忽略）。 */
export function diffBytes(diffs: ReadonlyArray<SnapshotFileDiff>): number {
  let total = 0
  for (const entry of diffs) total += Buffer.byteLength(entry.patch ?? "", "utf8")
  return total
}

export interface CappedDiff {
  /** 裁剪后的 diff 列表（保留最新的文件）。 */
  diff: SnapshotFileDiff[]
  /** 是否发生裁剪。 */
  truncated: boolean
  /** 被裁掉的文件数。 */
  dropped: number
}

/**
 * 按字节预算裁剪 diff 列表，从尾部（最新）向前保留。
 *
 * 至少保留最后一项：即便单个 patch 就超预算，也不能返回空列表——否则 diff 视图
 * 会「莫名其妙没有任何变更」，比超预算更难排查。
 *
 * maxBytes ≤ 0 视为「不裁剪」，交由调用方传入合法预算。
 */
export function capDiffByBytes(
  diffs: ReadonlyArray<SnapshotFileDiff>,
  maxBytes: number = MAX_DIFF_BYTES,
): CappedDiff {
  const budget = Math.floor(maxBytes)
  if (budget <= 0 || diffBytes(diffs) <= budget) {
    return { diff: diffs as SnapshotFileDiff[], truncated: false, dropped: 0 }
  }

  const kept: SnapshotFileDiff[] = []
  let total = 0
  for (let i = diffs.length - 1; i >= 0; i--) {
    const entry = diffs[i]
    if (entry === undefined) continue
    const size = Buffer.byteLength(entry.patch ?? "", "utf8")
    if (kept.length > 0 && total + size > budget) break
    kept.push(entry)
    total += size
  }
  kept.reverse()
  const dropped = diffs.length - kept.length
  return { diff: kept, truncated: dropped > 0, dropped }
}
