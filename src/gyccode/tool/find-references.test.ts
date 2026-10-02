import { describe, expect, test } from "bun:test"
import {
  countByKind,
  dedupeHits,
  escapeRegExp,
  formatHits,
  symbolPattern,
  truncateLine,
  type SymbolHit,
} from "./find-references"

describe("escapeRegExp", () => {
  test("转义正则元字符，普通标识符原样返回", () => {
    expect(escapeRegExp("foo")).toBe("foo")
    expect(escapeRegExp("a.b")).toBe("a\\.b")
    expect(escapeRegExp("a+b*c?")).toBe("a\\+b\\*c\\?")
    expect(escapeRegExp("$foo(bar)")).toBe("\\$foo\\(bar\\)")
    expect(escapeRegExp("a|b[c]{d}^e$f")).toBe("a\\|b\\[c\\]\\{d\\}\\^e\\$f")
  })
})

describe("symbolPattern", () => {
  test("用标识符边界包裹，避免 foo 命中 foobar", () => {
    const re = new RegExp(symbolPattern("foo"))
    expect(re.test("foo()")).toBe(true)
    expect(re.test("const foo = 1")).toBe(true)
    expect(re.test("foobar()")).toBe(false)
    expect(re.test("barfoo")).toBe(false)
  })

  test("以 $ 开头的符号仍按完整标识符边界匹配", () => {
    const re = new RegExp(symbolPattern("$foo"))
    expect(re.test("$foo()")).toBe(true)
    expect(re.test("a$foo()")).toBe(false)
  })

  test("中文符号名可匹配", () => {
    const re = new RegExp(symbolPattern("登录"))
    expect(re.test("await 登录(用户)")).toBe(true)
    expect(re.test("重新登录逻辑")).toBe(false)
  })
})

describe("truncateLine", () => {
  test("与 search.ts 一致：超过 2000 字符截断并补省略号", () => {
    const long = "x".repeat(2_500)
    const out = truncateLine(long)
    expect(out.length).toBe(2_003)
    expect(out.endsWith("...")).toBe(true)
  })

  test("未超限原样返回", () => {
    expect(truncateLine("const a = 1")).toBe("const a = 1")
    expect(truncateLine("y".repeat(2_000)).length).toBe(2_000)
  })
})

describe("dedupeHits", () => {
  test("同一 file:line 多次命中合并为一条", () => {
    const hits: SymbolHit[] = [
      { path: "src/a.ts", line: 3, kind: "reference", text: "x" },
      { path: "src/a.ts", line: 3, kind: "reference", text: "x" },
      { path: "src/b.ts", line: 9, kind: "reference", text: "y" },
    ]
    expect(dedupeHits(hits)).toHaveLength(2)
  })

  test("同一 file:line 同时被识别为定义与引用时，定义优先", () => {
    const hits: SymbolHit[] = [
      { path: "src/a.ts", line: 3, kind: "reference", text: "x" },
      { path: "src/a.ts", line: 3, kind: "definition", text: "x" },
    ]
    expect(dedupeHits(hits)).toEqual([{ path: "src/a.ts", line: 3, kind: "definition", text: "x" }])
  })

  test("按 file、line 升序稳定输出", () => {
    const hits: SymbolHit[] = [
      { path: "src/b.ts", line: 2, kind: "reference", text: "" },
      { path: "src/a.ts", line: 10, kind: "reference", text: "" },
      { path: "src/a.ts", line: 1, kind: "definition", text: "" },
    ]
    expect(dedupeHits(hits).map((h) => `${h.path}:${h.line}`)).toEqual([
      "src/a.ts:1",
      "src/a.ts:10",
      "src/b.ts:2",
    ])
  })
})

describe("countByKind", () => {
  test("分别统计定义与引用数", () => {
    const hits: SymbolHit[] = [
      { path: "a.ts", line: 1, kind: "definition", text: "" },
      { path: "a.ts", line: 2, kind: "reference", text: "" },
      { path: "b.ts", line: 3, kind: "reference", text: "" },
    ]
    expect(countByKind(hits)).toEqual({ definitions: 1, references: 2, total: 3 })
  })
})

describe("formatHits", () => {
  const hits: SymbolHit[] = [
    { path: "src/a.ts", line: 10, kind: "definition", text: "export function foo() {}" },
    { path: "src/b.ts", line: 5, kind: "reference", text: "foo(1)" },
    { path: "src/b.ts", line: 8, kind: "reference", text: "await foo(2)" },
  ]

  test("输出 file:line 并标注定义/引用", () => {
    const out = formatHits("foo", hits, { lsp: true, truncated: false })
    expect(out).toContain("src/a.ts:10")
    expect(out).toContain("src/b.ts:5")
    expect(out).toContain("src/b.ts:8")
    expect(out).toContain("定义")
    expect(out).toContain("引用")
    expect(out).toContain("1 处定义")
    expect(out).toContain("2 处引用")
  })

  test("无结果时不武断下结论，并声明输出为不可信数据", () => {
    const out = formatHits("foo", [], { lsp: true, truncated: false })
    expect(out).toContain("未找到")
    expect(out).toContain("不要据此断定")
    expect(out).toContain("不可信数据")
  })

  test("LSP 不可用时显式声明已降级为文本匹配", () => {
    const out = formatHits("foo", hits, { lsp: false, truncated: false })
    expect(out).toContain("未使用 LSP")
    expect(out).toContain("文本匹配")
  })

  test("LSP 可用时不出现降级提示", () => {
    const out = formatHits("foo", hits, { lsp: true, truncated: false })
    expect(out).not.toContain("未使用 LSP")
  })

  test("截断时给出明确提示", () => {
    const out = formatHits("foo", hits, { lsp: true, truncated: true })
    expect(out).toContain("已截断")
  })

  test("行文本超长时截断，防止单行淹没上下文", () => {
    const out = formatHits("foo", [{ path: "a.ts", line: 1, kind: "reference", text: "z".repeat(3_000) }], {
      lsp: true,
      truncated: false,
    })
    expect(out).toContain("...")
    expect(out).not.toContain("z".repeat(3_000))
  })
})
