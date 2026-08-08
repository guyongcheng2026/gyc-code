import { Effect } from "effect"

export interface TeamMemoryConfig {
  /** Shared memory directory path */
  sharedPath: string
  /** Team identifier */
  teamId: string
  /** Whether team memory is enabled */
  enabled: boolean
}

export const DEFAULT_TEAM_CONFIG: TeamMemoryConfig = {
  sharedPath: ".gyc/team-memory",
  teamId: "default",
  enabled: false,
}

export interface TeamMemoryEntry {
  author: string
  timestamp: number
  content: string
  tags: string[]
}

export function formatTeamEntry(entry: TeamMemoryEntry): string {
  const date = new Date(entry.timestamp).toISOString()
  const tags = entry.tags.length > 0 ? ` #${entry.tags.join(" #")}` : ""
  return `## ${date} by ${entry.author}${tags}\n${entry.content}\n`
}

export function parseTeamEntry(raw: string): TeamMemoryEntry | null {
  const headerMatch = raw.match(/^##\s+(.+?)\s+by\s+(\S+)(?:\s+#(.+))?$/m)
  if (!headerMatch) return null

  const content = raw.replace(/^##.*$/m, "").trim()
  const tags = headerMatch[3]?.split(/\s+#/).map(t => t.trim()) ?? []

  return {
    author: headerMatch[2],
    timestamp: new Date(headerMatch[1]).getTime(),
    content,
    tags,
  }
}

export function searchTeamEntries(
  entries: readonly TeamMemoryEntry[],
  query: string,
): TeamMemoryEntry[] {
  const lower = query.toLowerCase()
  return entries.filter(
    e =>
      e.content.toLowerCase().includes(lower) ||
      e.tags.some(t => t.toLowerCase().includes(lower)) ||
      e.author.toLowerCase().includes(lower),
  )
}

export function mergeTeamEntries(
  existing: readonly TeamMemoryEntry[],
  incoming: readonly TeamMemoryEntry[],
): TeamMemoryEntry[] {
  const seen = new Set(existing.map(e => `${e.author}:${e.timestamp}:${e.content.slice(0, 50)}`))
  const merged = [...existing]
  for (const entry of incoming) {
    const key = `${entry.author}:${entry.timestamp}:${entry.content.slice(0, 50)}`
    if (!seen.has(key)) {
      seen.add(key)
      merged.push(entry)
    }
  }
  return merged.sort((a, b) => b.timestamp - a.timestamp)
}
