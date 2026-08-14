import { spawn } from "child_process"

const BATCH_SIZE = 50
// 超时上限：git check-ignore 正常 <100ms，挂起时（NFS/git lock）快速失败
const CHECK_IGNORE_TIMEOUT_MS = 5_000

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

/**
 * 异步执行 git check-ignore，返回被 git 忽略的路径集合。
 *
 * 关键修复：
 * 1. 从 execSync 改为异步 spawn —— execSync 阻塞事件循环，2000 并发下是性能瓶颈。
 * 2. 传入 cwd —— 原实现无 cwd，在非 git 仓库目录下 git 报错被 catch 吞掉，
 *    导致所有路径都被保留（不过滤），功能失效。
 */
function checkIgnore(filePaths: string[], cwd: string): Promise<Set<string>> {
  return new Promise((resolve) => {
    const ignored = new Set<string>()
    if (filePaths.length === 0) {
      resolve(ignored)
      return
    }
    const child = spawn("git", ["check-ignore", "--stdin"], {
      cwd,
      stdio: ["pipe", "pipe", "ignore"],
      windowsHide: true,
    })

    // 超时保护：git check-ignore 正常 <100ms，挂起时快速失败避免阻塞 LLM 工具
    const timer = setTimeout(() => {
      child.kill("SIGKILL")
      resolve(ignored)
    }, CHECK_IGNORE_TIMEOUT_MS)

    let stdout = ""
    child.stdout.on("data", (chunk) => {
      stdout += chunk
    })

    child.on("error", () => {
      clearTimeout(timer)
      resolve(ignored)
    })

    child.on("close", () => {
      clearTimeout(timer)
      for (const line of stdout.trim().split("\n")) {
        if (line) ignored.add(line)
      }
      resolve(ignored)
    })

    // git check-ignore returns non-zero when no matches; that's not an error
    child.stdin.on("error", () => {
      clearTimeout(timer)
      resolve(ignored)
    })
    child.stdin.end(filePaths.join("\n"))
  })
}

export async function filterGitIgnoredLocations(
  locations: unknown[],
  cwd: string,
): Promise<unknown[]> {
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
    const batchIgnored = await checkIgnore(batch, cwd)
    for (const p of batchIgnored) ignored.add(p)
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
