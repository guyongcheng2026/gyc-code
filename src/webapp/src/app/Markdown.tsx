import { memo, useEffect, useState, type ReactNode } from "react"
import { highlightCode, supportedLang } from "./highlight"
import "katex/dist/katex.min.css"

/**
 * 自研轻量 Markdown 渲染器（对齐 DSH MarkdownText 的核心能力子集）。
 *
 * 支持：围栏代码块（语言横幅+复制+超长折叠+shiki 语法高亮）、行内代码、
 * 粗体/斜体/删除线、链接（仅 http/https/mailto，安全外链属性）、图片（仅绝对 http(s)）、
 * 标题、无序/有序列表、引用块、表格、水平线、TeX 公式（KaTeX：$…$、$$…$$、\(…\)、\[…\]）。
 *
 * 性能：按块拆分渲染，每块 memo —— 流式输出时只有尾部块重建，
 * 已冻结块的 React 元素直接复用（对齐 DSH 增量解析思路）。
 */

const MAX_CODE_LINES = 16

// ---------- TeX 公式（KaTeX 懒加载；渲染失败降级原文本） ----------
const MathTex = memo(function MathTex({ tex, display }: { tex: string; display: boolean }) {
  const [html, setHtml] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  useEffect(() => {
    let disposed = false
    void import("katex").then(
      (k) => {
        if (disposed) return
        try {
          setHtml(k.renderToString(tex, { displayMode: display, throwOnError: true }))
        } catch {
          setFailed(true)
        }
      },
      () => {
        if (!disposed) setFailed(true)
      },
    )
    return () => {
      disposed = true
    }
  }, [tex, display])
  if (failed) return <code className="md-inline-code">{tex}</code>
  if (!html) return <code className="md-inline-code">{display ? `$$${tex}$$` : `$${tex}$`}</code>
  return (
    <span
      className={display ? "md-math-block" : "md-math-inline"}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

// ---------- 安全链接 ----------
function safeHref(url: string): string | null {
  const trimmed = url.trim()
  if (/^https?:\/\//i.test(trimmed) || /^mailto:/i.test(trimmed)) return trimmed
  return null
}

// ---------- 行内解析 ----------
// 顺序：行内代码 → 链接/图片 → 粗体 → 斜体 → 删除线
function renderInline(text: string, keyPrefix = ""): ReactNode[] {
  const out: ReactNode[] = []
  let buf = ""
  let i = 0
  let ki = 0
  const key = () => `${keyPrefix}i${ki++}`

  const flush = () => {
    if (buf) {
      out.push(buf)
      buf = ""
    }
  }

  while (i < text.length) {
    const rest = text.slice(i)

    // 行内代码 `...`
    if (rest.startsWith("`")) {
      const end = text.indexOf("`", i + 1)
      if (end > i) {
        flush()
        out.push(
          <code key={key()} className="md-inline-code">
            {text.slice(i + 1, end)}
          </code>,
        )
        i = end + 1
        continue
      }
    }

    // 行内公式 $…$ / $$…$$（块级之外的短公式）与 \(…\)
    const inlineMath = /^(\$\$([^$\n]+)\$\$|\$([^$\s][^$\n]*?)\$|\\\((.+?)\\\))/.exec(rest)
    if (inlineMath) {
      const tex = inlineMath[2] ?? inlineMath[3] ?? inlineMath[4] ?? ""
      if (tex) {
        flush()
        out.push(<MathTex key={key()} tex={tex} display={inlineMath[2] !== undefined} />)
        i += inlineMath[0].length
        continue
      }
    }

    // 图片 ![alt](url)
    const img = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(rest)
    if (img) {
      const href = safeHref(img[2])
      flush()
      out.push(
        href ? (
          <img key={key()} src={href} alt={img[1]} loading="lazy" className="md-img" referrerPolicy="no-referrer" />
        ) : (
          img[1]
        ),
      )
      i += img[0].length
      continue
    }

    // 链接 [text](url)
    const link = /^\[([^\]]+)\]\(([^)\s]+)\)/.exec(rest)
    if (link) {
      const href = safeHref(link[2])
      flush()
      out.push(
        href ? (
          <a key={key()} href={href} target="_blank" rel="noreferrer noopener" className="md-link">
            {link[1]}
          </a>
        ) : (
          link[1]
        ),
      )
      i += link[0].length
      continue
    }

    // 粗体 **x** / 斜体 *x* / 删除线 ~~x~~
    const style = /^(\*\*([^*]+)\*\*|\*([^*\s][^*]*?)\*|~~([^~]+)~~)/.exec(rest)
    if (style) {
      flush()
      if (style[2] !== undefined) out.push(<strong key={key()}>{style[2]}</strong>)
      else if (style[3] !== undefined) out.push(<em key={key()}>{style[3]}</em>)
      else out.push(<del key={key()} className="md-del">{style[4]}</del>)
      i += style[0].length
      continue
    }

    buf += text[i]
    i += 1
  }
  flush()
  return out
}

// ---------- 代码块（语言横幅 + 复制 + 超长折叠 + shiki 高亮） ----------
export const CodeBlock = memo(function CodeBlock({ code, lang }: { code: string; lang?: string }) {
  const [expanded, setExpanded] = useState(false)
  const [copied, setCopied] = useState(false)
  // shiki 异步高亮：null = 未高亮/不支持（纯文本降级）
  const [html, setHtml] = useState<string | null>(null)
  const lines = code.replace(/\n$/, "").split("\n")
  const truncated = !expanded && lines.length > MAX_CODE_LINES
  const shown = truncated ? [...lines.slice(0, 8), "⋯", ...lines.slice(-6)] : lines
  const highlighted = supportedLang(lang) !== null

  useEffect(() => {
    if (!highlighted) return
    let disposed = false
    void highlightCode(code, lang ?? "").then((out) => {
      if (!disposed && out) setHtml(out)
    })
    return () => {
      disposed = true
    }
  }, [code, lang, highlighted])

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1200)
    } catch {
      // 剪贴板不可用则忽略
    }
  }

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-header">
        <span className="md-codeblock-lang">{lang || "text"}</span>
        <span style={{ flex: 1 }} />
        {lines.length > MAX_CODE_LINES ? (
          <button className="btn btn-ghost md-codeblock-btn" onClick={() => setExpanded((v) => !v)}>
            {expanded ? "收起" : `展开全部 ${lines.length} 行`}
          </button>
        ) : null}
        <button className="btn btn-ghost md-codeblock-btn" onClick={copy}>
          {copied ? "已复制" : "复制"}
        </button>
      </div>
      {html ? (
        <div className="md-codeblock-pre md-codeblock-hl" dangerouslySetInnerHTML={{ __html: html }} />
      ) : (
        <pre className="md-codeblock-pre">
          {shown.map((line, idx) => (
            <div key={idx} className="md-codeblock-line">
              {line === "" ? "\u00A0" : line}
            </div>
          ))}
        </pre>
      )}
    </div>
  )
})

// ---------- 块解析 ----------
type Block =
  | { kind: "code"; lang: string; code: string }
  | { kind: "heading"; level: number; text: string }
  | { kind: "ul"; items: string[] }
  | { kind: "ol"; items: string[] }
  | { kind: "quote"; lines: string[] }
  | { kind: "table"; header: string[]; rows: string[][] }
  | { kind: "math"; tex: string }
  | { kind: "hr" }
  | { kind: "p"; text: string }

function splitRow(line: string): string[] {
  return line
    .replace(/^\||\|$/g, "")
    .split("|")
    .map((c) => c.trim())
}

export function parseBlocks(src: string): Block[] {
  const blocks: Block[] = []
  const lines = src.split("\n")
  let i = 0
  let para: string[] = []

  const flushPara = () => {
    if (para.length > 0) {
      blocks.push({ kind: "p", text: para.join("\n") })
      para = []
    }
  }

  while (i < lines.length) {
    const line = lines[i]

    // 块级公式 $$…$$（围栏式）与 \[…\]
    const mathFence = /^\s*\$\$\s*$/.test(line) ? "$$" : /^\s*\\\[\s*$/.test(line) ? "\\[" : undefined
    if (mathFence) {
      flushPara()
      const close = mathFence === "$$" ? /^\s*\$\$\s*$/ : /^\s*\\\]\s*$/
      const body: string[] = []
      i += 1
      while (i < lines.length && !close.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // 跳过收尾
      blocks.push({ kind: "math", tex: body.join("\n") })
      continue
    }
    // 单行块级公式 $$…$$
    const oneLineMath = /^\s*\$\$([^$]+)\$\$\s*$/.exec(line)
    if (oneLineMath) {
      flushPara()
      blocks.push({ kind: "math", tex: oneLineMath[1] })
      i += 1
      continue
    }

    // 围栏代码块
    const fence = /^\s*```(\S*)\s*$/.exec(line)
    if (fence) {
      flushPara()
      const lang = fence[1] ?? ""
      const body: string[] = []
      i += 1
      while (i < lines.length && !/^\s*```\s*$/.test(lines[i])) {
        body.push(lines[i])
        i += 1
      }
      i += 1 // 跳过收尾 ```
      blocks.push({ kind: "code", lang, code: body.join("\n") })
      continue
    }

    // 空行
    if (line.trim() === "") {
      flushPara()
      i += 1
      continue
    }

    // 标题
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      flushPara()
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] })
      i += 1
      continue
    }

    // 水平线
    if (/^\s*([-*_])\s*(\1\s*){2,}$/.test(line)) {
      flushPara()
      blocks.push({ kind: "hr" })
      i += 1
      continue
    }

    // 表格（当前行含 | 且下一行是分隔行）
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|[\s:|-]*$/.test(lines[i + 1])) {
      flushPara()
      const header = splitRow(line.trim())
      i += 2
      const rows: string[][] = []
      while (i < lines.length && lines[i].includes("|") && lines[i].trim() !== "") {
        rows.push(splitRow(lines[i].trim()))
        i += 1
      }
      blocks.push({ kind: "table", header, rows })
      continue
    }

    // 引用块
    if (/^\s*>\s?/.test(line)) {
      flushPara()
      const quote: string[] = []
      while (i < lines.length && /^\s*>\s?/.test(lines[i])) {
        quote.push(lines[i].replace(/^\s*>\s?/, ""))
        i += 1
      }
      blocks.push({ kind: "quote", lines: quote })
      continue
    }

    // 无序列表
    if (/^\s*[-*+]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*[-*+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*[-*+]\s+/, ""))
        i += 1
      }
      blocks.push({ kind: "ul", items })
      continue
    }

    // 有序列表
    if (/^\s*\d+[.)]\s+/.test(line)) {
      flushPara()
      const items: string[] = []
      while (i < lines.length && /^\s*\d+[.)]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\s*\d+[.)]\s+/, ""))
        i += 1
      }
      blocks.push({ kind: "ol", items })
      continue
    }

    para.push(line)
    i += 1
  }
  flushPara()
  return blocks
}

// ---------- 单块渲染（memo：流式时冻结块直接复用） ----------
const BlockView = memo(function BlockView({ block, seq }: { block: Block; seq: number }) {
  switch (block.kind) {
    case "code":
      return <CodeBlock code={block.code} lang={block.lang} />
    case "heading": {
      const Tag = `h${block.level}` as "h1" | "h2" | "h3" | "h4"
      return <Tag className={`md-h md-h${block.level}`}>{renderInline(block.text, `h${seq}`)}</Tag>
    }
    case "ul":
      return (
        <ul className="md-ul">
          {block.items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `u${seq}_${idx}`)}</li>
          ))}
        </ul>
      )
    case "ol":
      return (
        <ol className="md-ol">
          {block.items.map((it, idx) => (
            <li key={idx}>{renderInline(it, `o${seq}_${idx}`)}</li>
          ))}
        </ol>
      )
    case "quote":
      return (
        <blockquote className="md-quote">
          {block.lines.map((l, idx) => (
            <div key={idx}>{renderInline(l, `q${seq}_${idx}`)}</div>
          ))}
        </blockquote>
      )
    case "table":
      return (
        <div className="md-table-wrap">
          <table className="md-table">
            <thead>
              <tr>
                {block.header.map((c, idx) => (
                  <th key={idx}>{renderInline(c, `th${seq}_${idx}`)}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {block.rows.map((row, ri) => (
                <tr key={ri}>
                  {row.map((c, ci) => (
                    <td key={ci}>{renderInline(c, `td${seq}_${ri}_${ci}`)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )
    case "hr":
      return <hr className="md-hr" />
    case "math":
      return <MathTex tex={block.tex} display />
    case "p":
      return <p className="md-p">{renderInline(block.text, `p${seq}`)}</p>
    default:
      return null
  }
})

// ---------- 对外入口 ----------
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="md-body">
      {blocks.map((b, idx) => (
        <BlockView key={idx} block={b} seq={idx} />
      ))}
    </div>
  )
})
