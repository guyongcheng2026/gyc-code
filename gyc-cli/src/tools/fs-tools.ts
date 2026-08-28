// gyc cli 文件类工具（Read / Write / Edit）：
// - Read：带行号输出（cat -n 格式）、2000 行/2000 字符截断、readFileState 记录 mtime
// - Write：要求先 Read（file state 校验）、写入后更新 readFileState
// - Edit：exact string 替换（唯一性校验）、old_string 必须与文件精确匹配

import { statSync, readFileSync, writeFileSync } from "node:fs"
import * as path from "node:path"
import { buildTool } from "../tool"

const MAX_LINES = 2000
const MAX_LINE_CHARS = 2000

export function createReadTool() {
  return buildTool({
    name: "Read",
    description:
      "读取本地文件。输出带行号（cat -n 格式）。长文件截断至 2000 行。必须用本工具读取文件后再编辑。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "文件的绝对路径" },
        offset: { type: "number", description: "起始行号（可选）" },
        limit: { type: "number", description: "读取行数上限（可选）" },
      },
      required: ["file_path"],
    },
    isReadOnly: () => true,
    isConcurrencySafe: () => true,
    validateInput: async (input, context) => {
      const filePath = resolvePath(context.cwd, String(input.file_path))
      try {
        const s = statSync(filePath)
        if (s.isDirectory()) {
          return { result: false, message: `路径是目录而非文件: ${filePath}` }
        }
      } catch {
        return { result: false, message: `文件不存在: ${filePath}` }
      }
      return { result: true }
    },
    call: async (input, context) => {
      const filePath = resolvePath(context.cwd, String(input.file_path))
      const content = readFileSync(filePath, "utf-8")
      const allLines = content.split("\n")
      const offset = typeof input.offset === "number" ? Math.max(0, input.offset - 1) : 0
      const limit = typeof input.limit === "number" ? input.limit : MAX_LINES
      const slice = allLines.slice(offset, offset + limit)
      const clipped = slice.map(line =>
        line.length > MAX_LINE_CHARS ? line.slice(0, MAX_LINE_CHARS) + "…" : line,
      )
      const numbered = clipped.map((line, i) => `${String(offset + i + 1).padStart(6)}\t${line}`)
      const truncated = allLines.length > offset + limit
        ? `\n\n（文件共 ${allLines.length} 行，已显示 ${offset + 1}-${offset + slice.length} 行）`
        : ""
      context.readFileState.set(filePath, { mtime: statSync(filePath).mtimeMs, content })
      return {
        content: `${filePath}\n${numbered.join("\n")}${truncated}`,
      }
    },
  })
}

export function createWriteTool() {
  return buildTool({
    name: "Write",
    description: "写入文件（覆盖）。若目标文件已存在，必须先用 Read 读取，否则会失败。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "目标文件的绝对路径" },
        content: { type: "string", description: "完整文件内容" },
      },
      required: ["file_path", "content"],
    },
    validateInput: async (input, context) => {
      const filePath = resolvePath(context.cwd, String(input.file_path))
      try {
        statSync(filePath)
        if (!context.readFileState.has(filePath)) {
          return {
            result: false,
            message: `文件已存在但未读取过。请先用 Read 读取 ${filePath} 再覆盖写入。`,
          }
        }
      } catch {
        // 新文件，无需先读
      }
      return { result: true }
    },
    call: async (input, context) => {
      const filePath = resolvePath(context.cwd, String(input.file_path))
      writeFileSync(filePath, String(input.content), "utf-8")
      context.readFileState.set(filePath, {
        mtime: statSync(filePath).mtimeMs,
        content: String(input.content),
      })
      const size = Buffer.byteLength(String(input.content))
      return { content: `文件已写入: ${filePath}（${size} 字节）` }
    },
  })
}

export function createEditTool() {
  return buildTool({
    name: "Edit",
    description:
      "对文件做精确字符串替换。old_string 必须与文件内容精确匹配且唯一；多处匹配时需提供 replace_all 或更多上下文。",
    inputSchema: {
      type: "object",
      properties: {
        file_path: { type: "string", description: "目标文件的绝对路径" },
        old_string: { type: "string", description: "要替换的原文（必须精确匹配）" },
        new_string: { type: "string", description: "替换后的新文本" },
        replace_all: { type: "boolean", description: "替换所有匹配项（默认 false）" },
      },
      required: ["file_path", "old_string", "new_string"],
    },
    validateInput: async (input, context) => {
      const filePath = resolvePath(context.cwd, String(input.file_path))
      if (!context.readFileState.has(filePath)) {
        return {
          result: false,
          message: `编辑前必须先用 Read 读取 ${filePath}（防盲目修改）。`,
        }
      }
      return { result: true }
    },
    call: async (input, context) => {
      const filePath = resolvePath(context.cwd, String(input.file_path))
      const oldString = String(input.old_string)
      const newString = String(input.new_string)
      if (oldString === newString) {
        return { content: "old_string 与 new_string 相同，未做修改。", isError: true }
      }
      const content = readFileSync(filePath, "utf-8")
      const count = content.split(oldString).length - 1
      if (count === 0) {
        return { content: `old_string 在文件中不存在: ${filePath}`, isError: true }
      }
      if (count > 1 && input.replace_all !== true) {
        return {
          content: `old_string 出现 ${count} 次（非唯一）。请提供更多上下文使其唯一，或设置 replace_all=true。`,
          isError: true,
        }
      }
      const updated =
        input.replace_all === true
          ? content.replaceAll(oldString, newString)
          : content.replace(oldString, newString)
      writeFileSync(filePath, updated, "utf-8")
      context.readFileState.set(filePath, {
        mtime: statSync(filePath).mtimeMs,
        content: updated,
      })
      return { content: `已更新: ${filePath}（替换 ${input.replace_all === true ? count : 1} 处）` }
    },
  })
}

function resolvePath(cwd: string, p: string): string {
  return path.isAbsolute(p) ? p : path.resolve(cwd, p)
}
