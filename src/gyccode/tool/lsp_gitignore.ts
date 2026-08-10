import { execSync } from "child_process"
import path from "path"

const BATCH_SIZE = 50

function extractFilePath(loc: unknown): string | null {
  if (!loc || typeof loc !== "object") return null
  const obj = loc as Record<string, unknown>
  // Try uri first (LSP standard)
  if (typeof obj.uri === "string") {
    const uri = obj.uri
    if (uri.startsWith("file://")) {
      return decodeURIComponent(uri.slice(7))
    }
    return uri
  }
  // Try filePath / path
  if (typeof obj.filePath === "string") return obj.filePath
  if (typeof obj.path === "string") return obj.path
  return null
}

export function filterGitIgnoredLocations(locations: unknown[]): unknown[] {
  if (locations.length === 0) return locations

  const filePaths: string[] = []
  const locMap = new Map<string, unknown[]>()

  for (const loc of locations) {
    const fp = extractFilePath(loc)
    if (fp) {
      if (!locMap.has(fp)) locMap.set(fp, [])
      locMap.get(fp)!.push(loc)
      filePaths.push(fp)
    } else {
      // Keep locations without extractable paths
      if (!locMap.has("__no_path__")) locMap.set("__no_path__", [])
      locMap.get("__no_path__")!.push(loc)
    }
  }

  if (filePaths.length === 0) return locations

  // Deduplicate filePaths for git check-ignore
  const uniquePaths = [...new Set(filePaths)]

  const ignored = new Set<string>()
  for (let i = 0; i < uniquePaths.length; i += BATCH_SIZE) {
    const batch = uniquePaths.slice(i, i + BATCH_SIZE)
    try {
      const output = execSync("git check-ignore --stdin", {
        input: batch.join("\n"),
        encoding: "utf8",
        stdio: ["pipe", "pipe", "ignore"],
      })
      for (const line of output.trim().split("\n")) {
        if (line) ignored.add(line)
      }
    } catch {
      // git check-ignore returns non-zero when no matches, ignore error
    }
  }

  // Filter out ignored paths
  const result: unknown[] = []
  for (const [fp, locs] of locMap) {
    if (fp === "__no_path__" || !ignored.has(fp)) {
      result.push(...locs)
    }
  }
  return result
}
