import { readdir, readFile, stat } from "node:fs/promises"
import { join, extname, relative } from "node:path"
import { tool } from "@gyccode/protocol/plugin/tool"

const SKIP_DIRS = new Set(["node_modules", ".git", ".gyc", "dist", "dist-test", "build", "coverage", ".next"])
const SKIP_EXTS = new Set([".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".tgz", ".zip", ".lockb", ".wasm"])

/** 递归统计目录：返回 { 文件数, 各扩展名行数, 各扩展名文件数 } */
async function walk(dir, depth, maxDepth) {
  let files = 0
  const byExt = new Map() // ext -> { files, lines }
  if (depth > maxDepth) return { files, byExt }

  let entries = []
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return { files, byExt }
  }

  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      const sub = await walk(join(dir, entry.name), depth + 1, maxDepth)
      files += sub.files
      for (const [ext, info] of sub.byExt) {
        const cur = byExt.get(ext) ?? { files: 0, lines: 0 }
        cur.files += info.files
        cur.lines += info.lines
        byExt.set(ext, cur)
      }
    } else if (entry.isFile()) {
      const ext = extname(entry.name).toLowerCase()
      if (SKIP_EXTS.has(ext)) continue
      files += 1
      const cur = byExt.get(ext) ?? { files: 0, lines: 0 }
      cur.files += 1
      try {
        const buf = await readFile(join(dir, entry.name))
        cur.lines += buf.toString("utf8").split("\n").length - 1
      } catch {
        /* 二进制/读取失败跳过行数统计 */
      }
      byExt.set(ext, cur)
    }
  }
  return { files, byExt }
}

/**
 * gyc-workspace-stats：统计当前项目文件数与代码行数。
 * 用法：让助手调用 workspace_stats 工具，或自行在会话中提及。
 */
export default async function statsPlugin() {
  return {
    tool: {
      workspace_stats: tool({
        description: "统计当前项目（worktree）的文件数与代码行数，按扩展名分组；跳过 node_modules/.git/dist 等目录",
        args: {
          maxDepth: tool.schema.number().optional().describe("最大递归深度（默认 4）"),
        },
        async execute(args, ctx) {
          const maxDepth = Math.min(Math.max(args.maxDepth ?? 4, 1), 8)
          const root = ctx.worktree || ctx.directory
          const { files, byExt } = await walk(root, 0, maxDepth)

          const rows = Array.from(byExt.entries())
            .sort((a, b) => b[1].lines - a[1].lines)
            .map(([ext, info]) => `${ext || "(无扩展名)"}：${info.files} 文件 / ${info.lines.toLocaleString()} 行`)
          const totalLines = Array.from(byExt.values()).reduce((sum, info) => sum + info.lines, 0)

          return {
            title: "workspace_stats",
            output: [
              `项目：${relative(process.cwd(), root) || root}`,
              `总计：${files.toLocaleString()} 文件 / ${totalLines.toLocaleString()} 行`,
              "",
              ...rows.slice(0, 15),
            ].join("\n"),
          }
        },
      }),
    },
  }
}
