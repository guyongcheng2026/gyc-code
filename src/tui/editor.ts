import type { CliRenderer } from "@opentui/core"
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs"
import { readFile, rm, writeFile } from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { spawn } from "node:child_process"
import type { Stream } from "node:stream"
import { resolveZedDbPath, resolveZedSelection } from "./editor-zed"

type EditorStdio = "inherit" | "pipe" | "ignore" | number | Stream

export function normalizePromptContent(content: string) {
  if (content.endsWith("\r\n")) {
    const body = content.slice(0, -2)
    return !body.includes("\n") && !body.includes("\r") ? body : content
  }

  if (content.endsWith("\n")) {
    const body = content.slice(0, -1)
    return !body.includes("\n") && !body.includes("\r") ? body : content
  }

  return content
}

export async function openEditor(input: { value: string; renderer: CliRenderer; cwd?: string; stdin?: EditorStdio }) {
  const editor = process.env.VISUAL || process.env.EDITOR
  if (!editor) return
  const file = path.join(os.tmpdir(), `${Date.now()}.md`)
  await writeFile(file, input.value)
  input.renderer.suspend()
  input.renderer.currentRenderBuffer.clear()
  try {
    await new Promise<void>((resolve, reject) => {
      // 解析带引号的 $VISUAL/$EDITOR（支持 "C:\Program Files\...\code.exe" 形式）；
      // 不再启用 shell：args 数组原生传参，含空格的 tmp 路径不会被拆断
      const parts = [...editor.matchAll(/"([^"]*)"|(\S+)/g)].map((m) => m[1] ?? m[2]) as string[]
      const args = [...parts.slice(1), file]
      const spawnOpts = {
        cwd: input.cwd && existsSync(input.cwd) ? input.cwd : process.cwd(),
        stdio: [input.stdin ?? "inherit", "inherit", "inherit"] as const,
      }
      const child = spawn(parts[0]!, args, spawnOpts)
      const settle = (c: ReturnType<typeof spawn>) => {
        c.on("exit", (code, signal) => {
          if (code === 0) return resolve()
          reject(new Error(`Editor exited with ${signal ? `signal ${signal}` : `code ${code}`}`))
        })
      }
      settle(child)
      // Windows 上 .cmd/.bat shim（如 code）无法被非 shell spawn 执行：
      // spawn error 时降级为 shell 模式并对含空格参数加引号重试
      child.once("error", (err: NodeJS.ErrnoException) => {
        if (err.code !== "ENOENT" && err.code !== "EINVAL") {
          reject(err)
          return
        }
        const quoted = [parts[0]!, ...parts.slice(1), file].map((a) => (a.includes(" ") ? `"${a}"` : a))
        const retry = spawn(quoted.join(" "), {
          ...spawnOpts,
          shell: process.platform === "win32",
        })
        retry.on("error", reject)
        settle(retry)
      })
    })
    return (await readFile(file, "utf8")) || undefined
  } finally {
    await rm(file, { force: true }).catch(() => {})
    input.renderer.currentRenderBuffer.clear()
    input.renderer.resume()
    input.renderer.requestRender()
  }
}

export function discoverEditorConnection(directory: string) {
  const root = path.join(os.homedir(), ".claude", "ide")
  const contains = (parent: string) => {
    const resolved = path.resolve(parent)
    const relative = path.relative(resolved, path.resolve(directory))
    return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative)) ? resolved.length : 0
  }
  try {
    return readdirSync(root)
      .filter((entry) => entry.endsWith(".lock"))
      .flatMap((entry) => {
        const file = path.join(root, entry)
        const port = Number.parseInt(path.basename(file, ".lock"), 10)
        if (!Number.isInteger(port) || port <= 0 || port > 65535) return []
        try {
          const value = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>
          if (value.transport !== undefined && value.transport !== "ws") return []
          const folders = Array.isArray(value.workspaceFolders)
            ? value.workspaceFolders.filter((item): item is string => typeof item === "string")
            : []
          const score = Math.max(0, ...folders.map(contains))
          if (!score) return []
          return [
            {
              url: `ws://127.0.0.1:${port}`,
              authToken: typeof value.authToken === "string" ? value.authToken : undefined,
              source: `lock:${port}`,
              score,
              mtime: statSync(file).mtimeMs,
            },
          ]
        } catch {
          return []
        }
      })
      .sort((left, right) => right.score - left.score || right.mtime - left.mtime)
      .map(({ url, authToken, source }) => ({ url, authToken, source }))[0]
  } catch {
    return undefined
  }
}

export const editorIntegration = {
  connection: discoverEditorConnection,
  selection: (directory: string) => resolveZedSelection(resolveZedDbPath() ?? "", directory),
}
