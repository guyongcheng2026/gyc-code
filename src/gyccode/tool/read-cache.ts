// Simple in-memory read cache for file contents

import type { TextFileEncoding } from "@gyccode/core/util/text-encoding"

export const FILE_UNCHANGED_STUB = "<file unchanged>"

// Bound the cache so a long-running session cannot grow memory without limit.
// LRU-ish: when full, the oldest inserted entry is evicted (Map preserves insertion order).
const MAX_ENTRIES = 200

// Minimal stat shape used by the cache - only fields we need for change detection.
export type StatLike = {
  /** Modification time - may be undefined if the underlying API does not provide it */
  mtime?: Date
  /** File size in bytes */
  size?: number
  /** "File" | "Directory" - we only cache regular files */
  type?: string
}

// Shared singleton maps. All callers share the same underlying map + read-set,
// so the cache is effectively a singleton across tools (and the read-before-write
// guard is consistent across read/write/edit in the same session).
const map = new Map<string, { content: string; encoding: TextFileEncoding; stat: StatLike | typeof FILE_UNCHANGED_STUB }>()
const readSet = new Set<string>()

/**
 * Returns a cache object that stores file contents together with their stats,
 * and tracks which files have been read in this session (for the
 * read-before-write guard in write/edit tools).
 */
export const ReadCache = () => {
  return {
    /** Retrieve cache entry for a path, if present */
    get(filepath: string) {
      return map.get(filepath)
    },
    /** Retrieve only the stored StatLike, if present */
    getStat(filepath: string) {
      const entry = map.get(filepath)
      return entry?.stat as StatLike | typeof FILE_UNCHANGED_STUB | undefined
    },
    /** Store a file's content and stat */
    set(filepath: string, content: string, stat: StatLike | typeof FILE_UNCHANGED_STUB, encoding: TextFileEncoding = "utf-8") {
      // Evict the oldest entry when the cache exceeds its bound (and the key is new).
      if (map.size >= MAX_ENTRIES && !map.has(filepath)) {
        const oldest = map.keys().next().value
        if (oldest !== undefined) map.delete(oldest)
      }
      map.set(filepath, { content, encoding, stat })
      // Reading (or writing) a file means the model has seen its current content.
      readSet.add(filepath)
    },
    /** Remove a cache entry - useful after write/edit operations */
    invalidate(filepath: string) {
      map.delete(filepath)
    },
    /** True when the file was read (or written) in this session. */
    hasRead(filepath: string) {
      return readSet.has(filepath)
    },
    /** Record that the file has been read in this session. */
    markRead(filepath: string) {
      readSet.add(filepath)
    },
  }
}
