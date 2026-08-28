// 执行类工具 —— Bash（超时/输出截断）与 Glob/Grep（node:fs 遍历，零依赖）

import { spawn } from "node:child_process"
import { readdirSync, readFileSync, statSync } from "node:fs"
import * as path from "node:path"
import { buildTool } from "../tool"

const BASH_TIMEOUT_MS = 120_000
const MAX_OUTPUT_CHARS = 30_000

export function createBashTool() {
  return buildTool({
    name: "Bash",
    description:
      "在用户机器上执行 bash 命令（Windows 下经 cmd /c 执行）。输出截断至 30000 字符。超时 120 秒。",
    inputSchema: {
      type: "object",
      properties: {
        command: { type: "string", description: "要执行的命令" },
        timeout_ms: { type: "number", description: "超时毫秒数（可选，默认 120000）" },
      },
      required: ["command"],
    },
    call: async (input, context) => {
      const command = String(input.command)
      const timeoutMs =
        typeof input.timeout_ms === "number" ? input.timeout_ms : BASH_TIMEOUT_MS
      const isWindows = process.platform === "win32"
      const child = spawn(isWindows ? "cmd" : "bash", isWindows ? ["/c", command] : ["-c", command], {
        cwd: context.cwd,
        windowsHide: true,
      })
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString("utf-8") })
      child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString("utf-8") })
      const code = await new Promise<number | null>((resolve) => {
        const timer = setTimeout(() => {
          child.kill()
          resolve(null)
        }, timeoutMs)
        child.on("close", (exitCode) => {
          clearTimeout(timer)
          resolve(exitCode)
        })
        child.on("error", () => {
          clearTimeout(timer)
          resolve(-1)
        })
      })
      if (code === null) {
        return { content: `命令超时（${timeoutMs}ms）已终止。\n${truncate(stdout + stderr)}`, isError: true }
      }
      const combined = (stdout + (stderr ? `\n[stderr]\n${stderr}` : "")).trim()
      if (code !== 0) {
        return {
          content: `命令退出码 ${code}。\n${truncate(combined) || "（无输出）"}`,
          isError: true,
        }
      }
      return { content: truncate(combined) || "（命令执行成功，无输出）" }
    },
  })
}

function truncate(text: string): string {
  return text.length > MAX_OUTPUT_CHARS
    ? text.slice(0, MAX_OUTPUT_CHARS) + `\n…（输出已截断，共 ${text.length} 字符）`
    : text
}

// ---------------------------------------------------------------------------
// Glob / Grep —— 零依赖遍历实现（参照 GlobTool/GrepTool 的行为语义）
// ---------------------------------------------------------------------------

function walkFiles(root: string, depthLimit = 12): string[] {
  const results: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > depthLimit) return
    let entries: string[]
    try {
      entries = readdirSync(dir)
    } catch {
      return
    }
    for (const entry of entries) {
      if (entry === "node_modules" || entry === ".git" || entry.startsWith("$")) continue
      const full = path.join(dir, entry)
      let s
      try {
        s = statSync(full)
      } catch {
        continue
      }
      if (s.isDirectory()) walk(full, depth + 1)
      else results.push(full)
    }
  }
  walk(root, 0)
  return results
}

function globToRegExp(pattern: string): RegExp {
  // 逐字符解析：**/ 匹配零层或多层目录，** 跨目录，* 单层内通配
  const src = pattern.replaceAll("\\", "/")
  let re = ""
  for (let i = 0; i < src.length; i++) {
    const char = src[i]
    if (char === "*") {
      if (src[i + 1] === "*") {
        if (src[i + 2] === "/") {
          re += "(?:.*/)?"
          i += 2
        } else {
          re += ".*"
          i += 1
        }
      } else {
        re += "[^/]*"
      }
    } else if (char === "?") {
      re += "."
    } else {
      re += char.replace(/[.+^${}()|[\]\\]/g, "\\$&")
    }
  }
  return new RegExp(`^${re}$`, "i")
}

export function createGlobTool() {
  return buildTool({
    name: "Glob",
    description: "按 glob 模式（如 **/*.ts）匹配文件路径，返回绝对路径列表。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "glob 模式" },
        path: { type: "string", description: "搜索根目录（可选，默认 cwd）" },
      },
      required: ["pattern"],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    call: async (input, context) => {
      const root = typeof input.path === "string" ? path.resolve(context.cwd, String(input.path)) : context.cwd
      const regex = globToRegExp(String(input.pattern))
      const matches = walkFiles(root)
        .map(file => ({ file, rel: path.relative(root, file) }))
        .filter(({ rel }) => regex.test(rel) || regex.test(rel.replaceAll("\\", "/")))
        .slice(0, 200)
        .map(({ file }) => file)
      return {
        content: matches.length > 0 ? matches.join("\n") : "未找到匹配文件",
      }
    },
  })
}

export function createGrepTool() {
  return buildTool({
    name: "Grep",
    description: "在目录内按正则搜索文件内容，输出 文件路径:行号:匹配行。最多 100 条。",
    inputSchema: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "正则表达式" },
        path: { type: "string", description: "搜索目录（可选，默认 cwd）" },
        include: { type: "string", description: "文件名 glob 过滤（如 *.ts，可选）" },
      },
      required: ["pattern"],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    call: async (input, context) => {
      const root = typeof input.path === "string" ? path.resolve(context.cwd, String(input.path)) : context.cwd
      let regex: RegExp
      try {
        regex = new RegExp(String(input.pattern), "i")
      } catch (error) {
        return { content: `无效正则: ${String(error)}`, isError: true }
      }
      const includeRegex = typeof input.include === "string" ? globToRegExp(String(input.include)) : null
      const results: string[] = []
      for (const file of walkFiles(root)) {
        if (includeRegex && !includeRegex.test(path.basename(file))) continue
        if (statSync(file).size > 1_500_000) continue
        let lines: string[]
        try {
          lines = readFileSync(file, "utf-8").split("\n")
        } catch {
          continue
        }
        for (let i = 0; i < lines.length && results.length < 100; i++) {
          if (regex.test(lines[i] ?? "")) {
            results.push(`${file}:${i + 1}:${lines[i]!.trim().slice(0, 200)}`)
          }
        }
        if (results.length >= 100) break
      }
      return { content: results.length > 0 ? results.join("\n") : "未找到匹配内容" }
    },
  })
}
