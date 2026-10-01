// Simple in-memory read cache for file contents

import type { TextFileEncoding } from "@gyccode/core/util/text-encoding"
import { FSUtil } from "@gyccode/core/fs-util"

export const FILE_UNCHANGED_STUB = "<file unchanged>"

// Bound the cache so a long-running session cannot grow memory without limit.
// LRU-ish: when full, the oldest inserted entry is evicted (Map preserves insertion order).
const MAX_ENTRIES = 200

// Bound the read-set with the same LRU-ish eviction so it cannot grow without
// limit. Eviction only turns the read-before-write guard into a safe
// false-negative (a file may need to be re-read), never a false positive.
const MAX_READ_SET = 200

// Minimal stat shape used by the cache - only fields we need for change detection.
export type StatLike = {
  /** Modification time - may be undefined if the underlying API does not provide it */
  mtime?: Date
  /** File size in bytes */
  size?: number
  /** "File" | "Directory" - we only cache regular files */
  type?: string
}

// Normalize a path to a canonical cache key. Matches the `read` tool, which
// normalizes on Windows; without this, write/edit lookups on Windows would miss
// the read-state marker (backslash vs forward slash) and wrongly reject a write
// with "File has not been read". Non-Windows is a no-op.
const key = (filepath: string) => FSUtil.normalizePath(filepath)

// Shared singleton maps. All callers share the same underlying map + read-set,
// so the cache is effectively a singleton across tools (and the read-before-write
// guard is consistent across read/write/edit in the same session).
const map = new Map<string, { content: string; encoding: TextFileEncoding; stat: StatLike | typeof FILE_UNCHANGED_STUB }>()
const readSet = new Set<string>()

/**
 * 记录一次 read 并维持不变式 `readSet ⊇ map.keys()`。
 *
 * 两个容器容量相同，但淘汰语义曾经错位：readSet 是真 LRU（delete + add 会
 * 重排），map 是 FIFO（命中已有键不重排）。于是「读 A → 读 B → 再读 A」之后
 * 填满到第 201 个键时，map 淘汰 A、readSet 淘汰 B，结果 A 在 readSet 却不在
 * map，B 在 map 却不在 readSet——随后读 B 命中缓存返回 `<file unchanged>`，
 * 而 write/edit 又因 hasRead(B) 为 false 报「File has not been read」，正是
 * 长会话里的误拦。因此淘汰 readSet 时跳过仍在 map 中的键。
 */
function trackRead(k: string) {
  readSet.delete(k)
  readSet.add(k)
  if (readSet.size <= MAX_READ_SET) return
  for (const candidate of readSet) {
    if (candidate === k) continue
    if (map.has(candidate)) continue // 仍在缓存里，丢了就会造成上面那处不一致
    readSet.delete(candidate)
    if (readSet.size <= MAX_READ_SET) return
  }
  // map 里全是仍需保护的键：宁可让 readSet 略微超界，也不能制造误拦。
}

/**
 * Returns a cache object that stores file contents together with their stats,
 * and tracks which files have been read in this session (for the
 * read-before-write guard in write/edit tools).
 */
export const ReadCache = () => {
  return {
    /** Retrieve cache entry for a path, if present */
    get(filepath: string) {
      return map.get(key(filepath))
    },
    /** Retrieve only the stored StatLike, if present */
    getStat(filepath: string) {
      const entry = map.get(key(filepath))
      return entry?.stat as StatLike | typeof FILE_UNCHANGED_STUB | undefined
    },
    /** Store a file's content and stat */
    set(filepath: string, content: string, stat: StatLike | typeof FILE_UNCHANGED_STUB, encoding: TextFileEncoding = "utf-8") {
      const k = key(filepath)
      // 命中已有键时先删除再写入，让 map 也成为真正的 LRU——否则它按 FIFO 淘汰，
      // 与 readSet 的淘汰节奏长期错位。
      map.delete(k)
      while (map.size >= MAX_ENTRIES) {
        const oldest = map.keys().next().value
        if (oldest === undefined) break
        map.delete(oldest)
      }
      map.set(k, { content, encoding, stat })
      // Reading (or writing) a file means the model has seen its current content.
      trackRead(k)
    },
    /** Remove a cache entry - useful after write/edit operations */
    invalidate(filepath: string) {
      map.delete(key(filepath))
    },
    /** True when the file was read (or written) in this session. */
    hasRead(filepath: string) {
      return readSet.has(key(filepath))
    },
    /** Record that the file has been read in this session. */
    markRead(filepath: string) {
      trackRead(key(filepath))
    },
  }
}
