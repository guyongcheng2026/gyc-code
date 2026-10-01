import { describe, expect, it } from "bun:test"
import {
  expandTokens,
  normalizeIdentifier,
  rankMatches,
  rankPaths,
  scorePath,
  tokenize,
} from "./search-relevance"

/**
 * P1-1 检索增强 / P1-2 相关度排序（对标指标 9 · 搜索 · 报告 §4.2）。
 *
 * 纯本地、零依赖：只吃字符串与已取回的匹配结果，不碰 IO、不碰模型。
 * 这些用例锁的是「排序信号」本身，search.ts 与 tool/grep.ts 只是接线。
 */

interface SubmatchLike {
  readonly text: string
  readonly start: number
  readonly end: number
}

const match = (path: string, line: number, text: string, submatches?: readonly SubmatchLike[]) => ({
  path,
  line,
  text,
  ...(submatches ? { submatches } : {}),
})

describe("normalizeIdentifier", () => {
  it("把 camelCase / PascalCase / kebab-case / 蛇形统一成小写蛇形", () => {
    expect(normalizeIdentifier("userName")).toBe("user_name")
    expect(normalizeIdentifier("UserName")).toBe("user_name")
    expect(normalizeIdentifier("foo-bar")).toBe("foo_bar")
    expect(normalizeIdentifier("foo_bar")).toBe("foo_bar")
    expect(normalizeIdentifier("  a  b  ")).toBe("a_b")
  })

  it("缩写接单词要能切开（XMLHttpRequest → xml_http_request）", () => {
    expect(normalizeIdentifier("HTTPServer")).toBe("http_server")
    expect(normalizeIdentifier("XMLHttpRequest")).toBe("xml_http_request")
  })

  it("中文等 CJK 字符原样保留，不能被分隔符规则吃掉", () => {
    expect(normalizeIdentifier("登录")).toBe("登录")
    expect(normalizeIdentifier("登录-逻辑")).toBe("登录_逻辑")
  })

  it("空串归一成空串", () => {
    expect(normalizeIdentifier("")).toBe("")
  })
})

describe("tokenize", () => {
  it("拆出子词并保留整形（userName → user / name / user_name）", () => {
    const tokens = tokenize("userName")
    expect(tokens).toContain("user")
    expect(tokens).toContain("name")
    expect(tokens).toContain("user_name")
  })

  it("中文没有分隔符时额外产出双字窗口，便于「登录逻辑」命中「登录」", () => {
    const tokens = tokenize("登录逻辑")
    expect(tokens).toContain("登录")
    expect(tokens).toContain("逻辑")
  })

  it("空查询不产出词元", () => {
    expect(tokenize("   ")).toEqual([])
  })
})

describe("expandTokens", () => {
  it("代码域别名把同义表述拉进召回（auth → login）", () => {
    const expanded = expandTokens("auth")
    expect(expanded.primary).toContain("auth")
    expect(expanded.aliases).toContain("login")
  })

  it("原词自身的别名不算作别名，避免自我加权", () => {
    expect(expandTokens("login").aliases).not.toContain("login")
  })

  it("查不到的词不硬造别名，宁缺勿滥以免误召回", () => {
    expect(expandTokens("zzzzq").aliases).toEqual([])
  })
})

describe("scorePath", () => {
  it("文件名完整命中优于仅子串包含", () => {
    expect(scorePath("read", "src/tool/read.ts")).toBeGreaterThan(scorePath("read", "a/b/c/readme.ts"))
  })

  it("目录段命中也有分（路径分词匹配）", () => {
    expect(scorePath("auth", "src/core/auth/handler.ts")).toBeGreaterThan(0)
    expect(scorePath("auth", "src/core/tool/read.ts")).toBe(0)
  })

  it("驼峰查询命中下划线文件名（大小写与分隔符归一）", () => {
    expect(scorePath("userName", "src/model/user_name.ts")).toBeGreaterThan(0)
    expect(scorePath("UserName", "src/model/user_name.ts")).toBeGreaterThan(0)
  })

  it("别名召回：查 auth 能给 login 命中的路径打分", () => {
    expect(scorePath("auth", "src/app/login.ts")).toBeGreaterThan(0)
  })

  it("中文查询命中中文路径", () => {
    expect(scorePath("登录逻辑", "src/app/登录.ts")).toBeGreaterThan(0)
  })

  it("完全无关的路径得 0 分", () => {
    expect(scorePath("auth", "src/gyccode/tool/read-cache.ts")).toBe(0)
  })
})

describe("rankPaths", () => {
  it("路径信号可以压过 fff 原始分，这就是 P1-1 的混合召回", () => {
    const items = [{ path: "src/gyccode/tool/read.ts" }, { path: "src/core/filesystem/search.ts" }]
    const ranked = rankPaths(items, "search", (item) => (item.path.includes("tool") ? 100 : 0))
    expect(ranked[0]?.item.path).toBe("src/core/filesystem/search.ts")
    expect(ranked[0]?.relevance ?? 0).toBeGreaterThan(0)
  })

  it("路径分打平时由底层引擎分（fff score）决胜", () => {
    const items = [{ path: "a/x.ts" }, { path: "b/x.ts" }]
    const ranked = rankPaths(items, "zzzzq", (item) => (item.path.startsWith("a") ? 5 : 1))
    expect(ranked[0]?.item.path).toBe("a/x.ts")
  })

  it("完全同分时更浅的路径优先，保持既有 tiebreak", () => {
    const items = [{ path: "a/b/c/deep.ts" }, { path: "shallow.ts" }]
    const ranked = rankPaths(items, "zzzzq")
    expect(ranked[0]?.item.path).toBe("shallow.ts")
  })

  it("返回 item 就是原对象引用，调用方字段不被改动", () => {
    const items = [{ path: "src/a.ts" }]
    const ranked = rankPaths(items, "a")
    expect(ranked[0]?.item).toBe(items[0])
  })

  it("空输入不炸", () => {
    expect(rankPaths([], "a")).toEqual([])
  })
})

describe("rankMatches", () => {
  it("符号声明行排在普通调用行之前", () => {
    const usage = match("src/a.ts", 10, "  return userName.trim()")
    const declaration = match("src/a.ts", 3, "export function getUserName(userName: string) {")
    const ranked = rankMatches([usage, declaration], "userName")
    expect(ranked[0]?.item).toBe(declaration)
  })

  it("标识符精确命中排在只是包含它的长标识符之前", () => {
    const partial = match("src/a.ts", 2, "const value = userNameSuffix")
    const exact = match("src/a.ts", 1, "const value = userName")
    const ranked = rankMatches([partial, exact], "userName")
    expect(ranked[0]?.item).toBe(exact)
  })

  it("文件名带查询词的文件整体靠前（路径权重）", () => {
    const elsewhere = match("src/misc/a.ts", 5, "foo userName bar")
    const named = match("src/auth/user_name.ts", 5, "foo userName bar")
    const ranked = rankMatches([elsewhere, named], "userName")
    expect(ranked[0]?.item).toBe(named)
  })

  it("同文件多命中聚合成一个高分文件，胜过只有一次命中的文件", () => {
    const many = [
      match("src/misc/a.ts", 10, "x userName"),
      match("src/misc/a.ts", 40, "y userName"),
      match("src/misc/a.ts", 90, "z userName"),
    ]
    const single = match("src/b.ts", 5, "w userName")
    const ranked = rankMatches([...many, single], "userName")
    expect(ranked[0]?.item).toBe(many[0])
  })

  it("同一文件里相邻行的连续命中加分，胜过相隔极远的两行", () => {
    const near = [match("src/a.ts", 10, "alpha userName"), match("src/a.ts", 11, "beta userName")]
    const far = [match("src/b.ts", 10, "alpha userName"), match("src/b.ts", 900, "beta userName")]
    const nearScore = rankMatches(near, "userName")[0]?.relevance ?? 0
    const farScore = rankMatches(far, "userName")[0]?.relevance ?? 0
    expect(nearScore).toBeGreaterThan(farScore)
  })

  it("匹配密度更高的行加分（同样的命中数，行越短越集中）", () => {
    const sparse = match("src/a.ts", 1, "x userName " + "y".repeat(300))
    const dense = match("src/a.ts", 2, "userName")
    const ranked = rankMatches([sparse, dense], "userName")
    expect(ranked[0]?.item).toBe(dense)
  })

  it("命中位置靠前的行加分", () => {
    const late = match("src/a.ts", 1, "  ".repeat(60) + "userName")
    const early = match("src/a.ts", 2, "userName" + " ".repeat(120))
    const ranked = rankMatches([late, early], "userName")
    expect(ranked[0]?.item).toBe(early)
  })

  it("没有 submatches 时自行扫描行内词元，tool/grep 路径同样能打分", () => {
    const ranked = rankMatches([match("src/a.ts", 1, "function login() { return userName }")], "userName")
    expect(ranked[0]?.relevance ?? 0).toBeGreaterThan(0)
  })

  it("返回 item 就是原对象引用，不改动既有字段（Match 结构保持兼容）", () => {
    const original = match("src/a.ts", 1, "userName")
    const ranked = rankMatches([original], "userName")
    expect(ranked[0]?.item).toBe(original)
    expect((ranked[0]?.item as { relevance?: unknown }).relevance).toBeUndefined()
  })

  it("空输入不炸", () => {
    expect(rankMatches([], "x")).toEqual([])
  })

  it("排序是确定性的：同分时按路径再按行号", () => {
    const a = match("src/a.ts", 9, "userName")
    const b = match("src/a.ts", 3, "userName")
    const first = rankMatches([a, b], "userName").map((row) => row.item.line)
    const second = rankMatches([b, a], "userName").map((row) => row.item.line)
    expect(first).toEqual([3, 9])
    expect(second).toEqual([3, 9])
  })
})

describe("性能守卫", () => {
  it("5000 条匹配重排保持毫秒级，证明没有退化到 O(n^2)", () => {
    const many = Array.from({ length: 5000 }, (_, index) =>
      match(
        `src/dir${index % 50}/file${index}.ts`,
        (index % 900) + 1,
        `const userName${index % 7} = call(userName, user_name, "${"y".repeat(40)}")`,
      ),
    )
    const started = performance.now()
    const ranked = rankMatches(many, "userName")
    const elapsed = performance.now() - started
    expect(ranked).toHaveLength(5000)
    expect(elapsed).toBeLessThan(500)
  })

  it("5000 条路径打分保持毫秒级", () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({
      path: `src/core/mod${index % 60}/search_${index}.ts`,
    }))
    const started = performance.now()
    const ranked = rankPaths(many, "searchFile")
    const elapsed = performance.now() - started
    expect(ranked).toHaveLength(5000)
    expect(elapsed).toBeLessThan(500)
  })
})