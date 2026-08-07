// Hermes memory bridge — gyc-cli ↔ Hermes bidirectional sync
// Based on @yunguang/memory UnifiedMemoryManager

import { readFile, writeFile } from "fs/promises"
import path from "path"

const HERMES_MEMORY_PATH = path.join(
  process.env.HERMES_HOME || "~/.codex",
  "memory",
  "hermes_gyccode_memory.md",
)

export interface HermesMemoryEntry {
  key: string
  value: string
  tags?: string[]
}

const SEP = "\n§\n"
const KEY_PREFIX = "#memory_"

/** Read memory entries from Hermes memory file */
export async function readHermesMemories(): Promise<HermesMemoryEntry[]> {
  try {
    const content = await readFile(HERMES_MEMORY_PATH, "utf-8")
    const blocks = content.split(SEP).filter(Boolean)
    return blocks.map((block, i) => ({
      key: KEY_PREFIX + i,
      value: block.trim(),
      tags: block.match(/#\w+/g) || [],
    }))
  } catch {
    return []
  }
}

/** Write a single entry to Hermes memory file */
export async function writeHermesMemoryFile(
  entry: HermesMemoryEntry,
  append = true,
): Promise<void> {
  const line = `${KEY_PREFIX}${entry.key}\n${entry.value}${SEP}`
  if (append) {
    const existing = await readFile(HERMES_MEMORY_PATH, "utf-8").catch(() => "")
    await writeFile(HERMES_MEMORY_PATH, existing + line, "utf-8")
  } else {
    await writeFile(HERMES_MEMORY_PATH, line, "utf-8")
  }
}

/** Sync all Hermes memories (experimental) */
export async function syncHermesMemories(): Promise<HermesMemoryEntry[]> {
  const entries = await readHermesMemories()
  const content = entries.map((e) => e.value).join(SEP)
  if (content) {
    await writeFile(HERMES_MEMORY_PATH, content, "utf-8")
  }
  return entries
}
