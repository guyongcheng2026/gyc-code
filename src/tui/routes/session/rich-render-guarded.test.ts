import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * 长会话 / 超长会话崩溃（`Failed to create TextBuffer`）的回归闸门。
 *
 * opentui 0.5.6 的原生句柄表上限 65,535，`<markdown>` / `<code>` / `<diff>` 内部
 * 按行创建 text_buffer。`src/tui/util/handle-budget.ts` 提供了预算闸门，
 * `src/tui/component/limited-content.tsx` 提供了行数/字节折叠 + 预算降级的统一入口。
 *
 * 之前只有 3 处渲染点接了 LimitedContent，而 `<code>`（Write 工具写出的文件内容）、
 * apply_patch 的逐文件 `<diff>`、diff-viewer 面板、权限审批弹窗这 4 条路径是直连的
 * —— 一次写大文件或一次改几十个文件就能单独吃光句柄表，表现为「打开会话即退出」。
 *
 * 判定方式：从每个富渲染标签的位置反查它是否落在某个 `<LimitedContent>` 的
 * `rich` 属性表达式区间内。区间配对取代了此前的「向上 80 行字串匹配」——后者会
 * 把「同文件别处存在 LimitedContent」误判为已保护。
 *
 * 这里锁的是**接线关系**而非运行时行为：opentui 的真实渲染需要原生终端，
 * 纯 bun test 里起不来。用源码结构断言是本仓既有做法（见 read-sensitive.test.ts）。
 */

// 本文件位于 src/tui/routes/session/ 下，仓库根需上溯三级。
const SRC = path.join(import.meta.dir, "..", "..", "..")

const read = (relative: string) => readFileSync(path.join(SRC, relative), "utf8")

/** 富渲染标签：内部按行创建原生 text_buffer，句柄成本随行数线性增长。 */
const ROW_GROWING_TAGS = ["markdown", "code", "diff"] as const

/**
 * 跳过字符串/注释地做括号配对，返回配对区间 [start, end)。
 *
 * 模板串整体跳过（含 `${}` 内部的括号），否则模板里的 `}` 会被误判为结束。
 */
function matchBrace(source: string, open: number): number {
  let depth = 0
  let i = open
  while (i < source.length) {
    const ch = source[i]!
    if (ch === '"' || ch === "'") {
      i = skipQuoted(source, i, ch)
      continue
    }
    if (ch === "`") {
      i = skipTemplate(source, i)
      continue
    }
    if (ch === "/" && source[i + 1] === "/") {
      const nl = source.indexOf("\n", i)
      i = nl === -1 ? source.length : nl
      continue
    }
    if (ch === "/" && source[i + 1] === "*") {
      const end = source.indexOf("*/", i + 2)
      i = end === -1 ? source.length : end + 2
      continue
    }
    if (ch === "{") depth += 1
    else if (ch === "}") {
      depth -= 1
      if (depth === 0) return i + 1
    }
    i += 1
  }
  return source.length
}

/** 跳过普通引号字符串（处理反斜杠转义），返回结束位置。 */
function skipQuoted(source: string, start: number, quote: string): number {
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]!
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === quote) return i + 1
    i += 1
  }
  return source.length
}

/** 跳过模板串（连同其中的 `${}` 插值），返回结束位置。 */
function skipTemplate(source: string, start: number): number {
  let i = start + 1
  while (i < source.length) {
    const ch = source[i]!
    if (ch === "\\") {
      i += 2
      continue
    }
    if (ch === "`") return i + 1
    i += 1
  }
  return source.length
}

/**
 * 找出标签的结束位置（`>` 或 `/>`）。
 *
 * 不能直接用 indexOf(">")：属性区里的箭头函数 `=>` 含 `>`，
 * 直接截断会把 rich 属性挡在属性区之外。
 */
function findTagEnd(source: string, from: number): number {
  let i = from
  while (i < source.length) {
    const ch = source[i]!
    if (ch === '"' || ch === "'") {
      i = skipQuoted(source, i, ch)
      continue
    }
    if (ch === "`") {
      i = skipTemplate(source, i)
      continue
    }
    if (ch === "=" && source[i + 1] === ">") {
      i += 2
      continue
    }
    if (ch === ">") return i
    i += 1
  }
  return source.length
}

/**
 * 找出所有 `<LimitedContent ... rich={...}>` 的 rich 表达式区间。
 *
 * rich 的值在 JSX 里必为 `{...}` 表达式容器，其区间即该容器的花括号配对范围。
 */
function findRichRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const tag = /<LimitedContent\b/g
  let match: RegExpExecArray | null
  while ((match = tag.exec(source)) !== null) {
    const after = match.index + match[0].length
    // 属性区：从标签名之后到标签结束之前
    const attrEnd = findTagEnd(source, after)
    const attrZone = source.slice(after, attrEnd)
    const richAt = attrZone.search(/\brich\s*=/)
    if (richAt === -1) continue
    const braceAt = attrZone.indexOf("{", richAt)
    if (braceAt === -1) continue
    const valueStart = after + braceAt
    ranges.push([valueStart, matchBrace(source, valueStart)])
    tag.lastIndex = after
  }
  return ranges
}

/**
 * 找出所有 JSX 块注释（花括号包裹的块注释）的区间。
 *
 * 注释里出现的 "<code>" 等字样不是 JSX 开标签，必须排除——否则会被
 * 当成未受保护的渲染点，产出假失败。
 */
function findCommentRanges(source: string): Array<[number, number]> {
  const ranges: Array<[number, number]> = []
  const pattern = /\{\s*\/\*/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const end = source.indexOf("*/", match.index + match[0].length)
    if (end === -1) break
    ranges.push([match.index, end + 2])
    pattern.lastIndex = end + 2
  }
  return ranges
}

/** 找出所有富渲染标签的开标签位置（排除注释行与 JSX 注释内的误命中）。 */
function findTagPositions(source: string, tag: string): number[] {
  const hits: number[] = []
  const comments = findCommentRanges(source)
  const pattern = new RegExp(`<${tag}(?=[\\s/>])`, "g")
  let match: RegExpExecArray | null
  while ((match = pattern.exec(source)) !== null) {
    const lineStart = source.lastIndexOf("\n", match.index) + 1
    const linePrefix = source.slice(lineStart, match.index).trimStart()
    // 注释行里的 "<diff" 不是 JSX 开标签
    if (linePrefix.startsWith("//") || linePrefix.startsWith("*") || linePrefix.startsWith("/*")) continue
    // JSX 注释块里的 "<code>" 同样不是开标签
    if (comments.some(([start, end]) => match!.index >= start && match!.index < end)) continue
    hits.push(match.index)
  }
  return hits
}

/** 该位置的富标签是否被某个 LimitedContent 的 rich 分支包裹。 */
function isGuardedByRich(source: string, position: number): boolean {
  return findRichRanges(source).some(([start, end]) => position >= start && position < end)
}

describe("富渲染标签必须落在 LimitedContent 的 rich 分支内", () => {
  const richPoints: { file: string; tag: (typeof ROW_GROWING_TAGS)[number] }[] = [
    { file: "tui/routes/session/index.tsx", tag: "markdown" },
    { file: "tui/routes/session/index.tsx", tag: "code" },
    { file: "tui/routes/session/index.tsx", tag: "diff" },
    { file: "tui/feature-plugins/system/diff-viewer.tsx", tag: "diff" },
    { file: "tui/routes/session/permission.tsx", tag: "diff" },
  ]

  for (const { file, tag } of richPoints) {
    test(`${file} 的 <${tag}> 落在 LimitedContent 的 rich 区间内`, () => {
      const source = read(file)
      const hits = findTagPositions(source, tag)
      expect(hits.length).toBeGreaterThan(0)

      for (const hit of hits) {
        expect(
          isGuardedByRich(source, hit),
          `${file} 的 <${tag}>（偏移 ${hit}）未被 LimitedContent 的 rich 分支包裹——` +
            `这条渲染路径会绕过句柄预算，长会话下可能直接撞上 opentui 句柄上限`,
        ).toBe(true)
      }
    })
  }
})

describe("区间配对检测器自身的行为（合成夹具）", () => {
  test("正例：rich 区间内的富标签判为已保护", () => {
    const source = `<LimitedContent text={t} rich={(t) => (<diff diff={t} />)} />`
    const hits = findTagPositions(source, "diff")
    expect(hits.length).toBe(1)
    expect(isGuardedByRich(source, hits[0]!)).toBe(true)
  })

  test("负例：同文件别处存在 LimitedContent，但富标签不在其 rich 区间内", () => {
    const source = [
      `<LimitedContent text={a} rich={(a) => (<text>{a}</text>)} />`,
      `<diff diff={b} />`,
    ].join("\n")
    const hits = findTagPositions(source, "diff")
    expect(hits.length).toBe(1)
    expect(isGuardedByRich(source, hits[0]!)).toBe(false)
  })

  test("负例：富标签落在 plain 分支内不视为已保护", () => {
    const source = `<LimitedContent text={t} rich={(t) => (<text>{t}</text>)} plain={(t) => (<diff diff={t} />)} />`
    const hits = findTagPositions(source, "diff")
    expect(hits.length).toBe(1)
    expect(isGuardedByRich(source, hits[0]!)).toBe(false)
  })

  test("负例：JSX 注释里的标签不计入渲染点", () => {
    const source = [
      `{/* 说明文字里提到 <code>，但这不是渲染点 */}`,
      `<LimitedContent rich={(t) => (<code content={t} />)} />`,
    ].join("\n")
    const hits = findTagPositions(source, "code")
    expect(hits.length).toBe(1)
    expect(isGuardedByRich(source, hits[0]!)).toBe(true)
  })

  test("正例：嵌套花括号与字符串不影响区间配对", () => {
    const source = `<LimitedContent rich={(t) => (<diff diff={t} note={"}"} />)} />`
    const hits = findTagPositions(source, "diff")
    expect(hits.length).toBe(1)
    expect(isGuardedByRich(source, hits[0]!)).toBe(true)
  })
})

describe("句柄成本恒定的标签无需句柄闸门", () => {
  test("<line_number> 自身是单个 renderable，其内部代码内容由 LimitedContent 保护", () => {
    const source = read("tui/routes/session/index.tsx")
    const hits = findTagPositions(source, "line_number")
    expect(hits.length).toBeGreaterThan(0)
    const ranges = findRichRanges(source)
    for (const hit of hits) {
      // line_number 自身只占 1 个句柄（不按行增长），无需闸门；
      // 但它包着的代码正文会按行创建句柄，必须落在紧随其后的 rich 区间内。
      const next = ranges.find(([start]) => start > hit)
      expect(next, `<line_number>（偏移 ${hit}）之后没有 LimitedContent 的 rich 分支`).toBeDefined()
      expect(next![0] - hit).toBeLessThan(2000)
    }
  })

  test("<scrollbox> / <box> / <text> 的句柄成本不随内容行数增长", () => {
    // 这些标签各自只占 1~3 个句柄（不按行创建 text_buffer），
    // 因此不需要句柄闸门；此处锁定该前提不被悄悄改掉。
    const source = read("tui/util/handle-budget.ts")
    expect(source).toContain("HANDLES_PER_TEXT_ROW")
    expect(source).toContain("HANDLES_PER_BLOCK")
  })
})

describe("LimitedContent 接线完整性", () => {
  test("Write 工具把写出的内容也送进闸门（<code> 此前是直连的）", () => {
    const source = read("tui/routes/session/index.tsx")
    const writeStart = source.indexOf("function Write(props: ToolProps)")
    expect(writeStart).toBeGreaterThan(-1)
    const body = source.slice(writeStart, writeStart + 2200)
    expect(body).toContain("<LimitedContent")
    // 折叠提示必须让用户看见降级发生，不做静默截断
    expect(read("tui/component/limited-content.tsx")).toContain("已折叠")
  })

  test("apply_patch 的逐文件 diff 走闸门（一次改 N 个文件 = N 份 diff 并存）", () => {
    const source = read("tui/routes/session/index.tsx")
    const patchStart = source.indexOf("function ApplyPatch(props: ToolProps)")
    expect(patchStart).toBeGreaterThan(-1)
    const body = source.slice(patchStart, patchStart + 3000)
    expect(body).toContain("<LimitedContent")
  })

  test("diff-viewer 面板为每个文件的 patch 提供列宽（否则折行估算退化到默认 80）", () => {
    const source = read("tui/feature-plugins/system/diff-viewer.tsx")
    expect(source).toContain("cols={patchPaneWidth()}")
  })

  test("权限审批弹窗的 diff 也过闸门（模态界面停留时间长，风险更高）", () => {
    const source = read("tui/routes/session/permission.tsx")
    expect(source).toContain("cols={dimensions().width}")
    expect(source).toContain("<LimitedContent")
  })
})

describe("句柄预算闸门本身的行为", () => {
  test("预算按行数线性估算（而不是固定值）", () => {
    const source = read("tui/util/handle-budget.ts")
    // 估算公式必须随行数增长：visualRows(text) * HANDLES_PER_TEXT_ROW
    expect(source).toMatch(/visualRows\(text, cols\)/)
    expect(source).toMatch(/HANDLES_PER_TEXT_ROW/)
    // 上限常量必须在位
    expect(source).toContain("NATIVE_HANDLE_LIMIT")
  })

  test("预算被真实占用与归还（不是纯查询）", () => {
    const source = read("tui/component/limited-content.tsx")
    // reserve 与 release 必须成对出现：只 reserve 不 release 会让占用只增不减
    expect(source).toContain("globalHandleBudget.reserve")
    expect(source).toContain("globalHandleBudget.release")
  })

  test("常驻额度与内容额度分账（常驻浮层不再挤占会话正文）", () => {
    const source = read("tui/util/handle-budget.ts")
    expect(source).toContain("RESERVED_HANDLES")
    expect(source).toContain("reservePersistent")
    expect(source).toContain("releasePersistent")
  })

  test("安全模式降级通道仍然存在（原生崩溃后的最后兜底）", () => {
    const source = read("tui/fallback/safe-mode.ts")
    expect(source).toContain("runFallbackSafeMode")
    // 一次性降级护栏，防止「崩溃→降级→再崩」循环
    expect(source).toContain("claimFallbackOnce")
  })
})
