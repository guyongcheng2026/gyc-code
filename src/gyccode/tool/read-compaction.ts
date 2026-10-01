/**
 * P1-3（对标指标 6 · 文件操作 · §1.3「read 无自动 compaction」）。
 *
 * 此前 read 命中字节上限时只丢一句 `Use offset=… to continue.`（read.ts 的
 * `truncated` 分支），模型必须自己再花一次 read/grep 去翻页。本模块把它改成
 * 默认折叠：把完整内容落盘，返回给模型的只保留「符号大纲 + 首尾样本 + 指针」。
 *
 * 落盘复用 `Truncate.Service.write`，与 grep/glob/bash 等工具共用同一套截断目录
 * 与保留期清理，不另造一套存储。
 */
import { Effect } from "effect"
import * as Truncate from "./truncate"

/** 骨架中保留的首部行数 */
const HEAD_LINES = 40
/** 骨架中保留的尾部行数 */
const TAIL_LINES = 40
/** 大纲最多列出的符号声明条数，超出只给计数与省略提示 */
const MAX_OUTLINE = 200
/** 单条符号声明在���纲中的最大长度，防止一行超长签名把骨架撑爆 */
const SIGNATURE_MAX_LENGTH = 160

/**
 * 符号声明识别（覆盖本仓常见的 TS/JS、Python、Go、Rust、C 系）。
 * 只认「关键字在行首（允许缩进）」的写法，避免正文里出现的同名词被当成大纲。
 */
const DECLARATION =
  /^\s*(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:pub(?:\([^)]*\))?\s+)?(?:abstract\s+)?(?:async\s+)?(?:function|class|interface|type|enum|struct|impl|trait|module|namespace|package|def|fn|func|sub|proc|method)\b/

/** 绑定形式的声明：只有初始化为函数/箭头函数/对象字面量时才计入大纲 */
const BINDING =
  /^\s*(?:export\s+)?(?:declare\s+)?(?:const|let|var|val)\s+[A-Za-z_$][\w$]*\s*(?::[^=]*)?=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*(?:<[^>]*>)?\s*=>)/

/** 是否为值得进入大纲的符号声明行 */
export const isSignature = (line: string): boolean => DECLARATION.test(line) || BINDING.test(line)

export type SkeletonInput = {
  /** 原文件路径，用于在指针里告诉模型该去哪儿读 */
  filepath: string
  /** 文件的全部行（不是 read 窗口，是整份内容） */
  lines: string[]
  /** 完整内容的落盘路径 */
  savedPath: string
}

export type Skeleton = {
  /** 可直接作为 read 输出的字符串（保留 path/type/content 外壳） */
  content: string
  /** 实际列出的符号声明条数 */
  outlineCount: number
  /** 大纲是否因超上限而被省略 */
  outlineTruncated: boolean
}

/**
 * 是否应当折叠。
 *
 * 只在「模型没指定窗口、且本次读取确实被截断」时折叠：此时模型本来就没拿到
 * 全文，折叠只增不减；而模型显式给了 offset/limit 时，它要的就是那个窗口，
 * 换成全文骨架反而是答非所问。
 */
export const shouldCompact = (input: { truncated: boolean; offset?: number; limit?: number }): boolean =>
  input.truncated && !input.offset && !input.limit

/** 构建「符号大纲 + 首尾样本 + 指针」骨架（纯函数，无 IO，便于测试） */
export const buildSkeleton = (input: SkeletonInput): Skeleton => {
  const { filepath, lines, savedPath } = input
  const total = lines.length

  const head = lines.slice(0, Math.min(HEAD_LINES, total))
  // 尾部起点不能落在头部之内，否则小文件会首尾重复一遍
  const tailStart = Math.max(head.length, total - TAIL_LINES)
  const tail = tailStart < total ? lines.slice(tailStart) : []

  const outline: string[] = []
  let omitted = 0
  for (let i = 0; i < total; i++) {
    const line = lines[i]
    if (line === undefined) continue
    if (!isSignature(line)) continue
    if (outline.length >= MAX_OUTLINE) {
      omitted++
      continue
    }
    outline.push(`${i + 1}: ${line.trim().slice(0, SIGNATURE_MAX_LENGTH)}`)
  }

  const sizeLabel = `${Math.round(Buffer.byteLength(lines.join("\n"), "utf-8") / 1024)} KB`
  const parts: string[] = [
    `<path>${filepath}</path>`,
    `<type>file</type>`,
    "<content>",
    "",
    `文件共 ${total} 行（约 ${sizeLabel}），超出单次输出上限，已自动折叠为结构骨架。`,
    "以下为符号大纲、首尾样本与定位指针，无需再翻页即可判断该看哪里。",
    "",
    "<outline>",
    ...(outline.length > 0 ? outline : ["未发现符号声明（该文件可能不是源码，或不含顶层声明）"]),
    ...(omitted > 0 ? [`...另有 ${omitted} 条符号声明未列出`] : []),
    "</outline>",
    "",
  ]

  if (head.length > 0) {
    parts.push(`<head lines="1-${head.length}">`, ...head.map((line, i) => `${i + 1}: ${line}`), "</head>", "")
  }
  if (tail.length > 0) {
    parts.push(
      `<tail lines="${tailStart + 1}-${total}">`,
      ...tail.map((line, i) => `${tailStart + i + 1}: ${line}`),
      "</tail>",
      "",
    )
  }

  parts.push(
    "<pointers>",
    `完整内容已落盘：${savedPath}`,
    `- 取指定片段：read filePath="${filepath}" offset=<行号> limit=<行数>`,
    `- 按内容定位：grep -n "关键词" "${filepath}"`,
    "</pointers>",
    "</compacted>",
    "</content>",
  )

  return {
    content: parts.join("\n"),
    outlineCount: outline.length,
    outlineTruncated: omitted > 0,
  }
}

/**
 * 折叠入口：完整内容落盘 + 返回骨架。
 *
 * `Truncate.Interface` 由调用方（read 的 init）传入而非从环境取：工具的
 * `execute` 必须留在 R=never 的通道里，服务只能在 init 阶段解析后闭包捕获
 * （与 shell.ts / bash-background.ts 同一写法）。
 */
export const compact = Effect.fn("ReadTool.compact")(function* (
  truncate: Truncate.Interface,
  input: { filepath: string; text: string },
) {
  const savedPath = yield* truncate.write(input.text)
  return buildSkeleton({ filepath: input.filepath, lines: input.text.split("\n"), savedPath })
})