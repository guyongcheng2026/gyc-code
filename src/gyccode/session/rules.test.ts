import { describe, expect, it } from "bun:test"
import { parseRuleFrontmatter, matchRules, globToRegExp } from "./rules"

const RULE_WITH_GLOBS = `---
globs:
  - "src/**/*.ts"
condition:
  language: zh
---
Always use Effect for all effects in src.`

const RULE_UNCONDITIONAL = `---
globs: ["docs/**"]
---
Docs must stay in Chinese.`

const RULE_NO_FRONTMATTER = `Plain rule text without frontmatter.`

describe("parseRuleFrontmatter", () => {
  it("parses globs array and condition", () => {
    const r = parseRuleFrontmatter(RULE_WITH_GLOBS)
    expect(r?.globs).toEqual(["src/**/*.ts"])
    expect(r?.condition).toEqual({ language: "zh" })
    expect(r?.body).toContain("Always use Effect")
  })
  it("parses single-line globs array", () => {
    const r = parseRuleFrontmatter(RULE_UNCONDITIONAL)
    expect(r?.globs).toEqual(["docs/**"])
  })
  it("returns undefined for no frontmatter", () => {
    expect(parseRuleFrontmatter(RULE_NO_FRONTMATTER)).toBeUndefined()
  })
})

describe("matchRules", () => {
  const ruleZh = { filepath: "rules/zh.md", globs: ["src/**/*.ts"], condition: { language: "zh" }, body: "zh rule" }
  const ruleAll = { filepath: "rules/all.md", globs: ["src/**/*.ts"], body: "all rule" }

  it("matches globs for a target file", () => {
    const m = matchRules([ruleZh, ruleAll], { filepath: "src/app.ts", language: "zh", os: "win32" })
    expect(m.map((r) => r.filepath)).toContain("rules/zh.md")
    expect(m.map((r) => r.filepath)).toContain("rules/all.md")
  })
  it("does not match when globs miss", () => {
    const m = matchRules([ruleZh], { filepath: "docs/guide.md", language: "zh", os: "win32" })
    expect(m).toEqual([])
  })
  it("filters by language condition", () => {
    const m = matchRules([ruleZh], { filepath: "src/app.ts", language: "en", os: "win32" })
    expect(m).toEqual([])
  })
  it("matches unconditioned rules regardless of language", () => {
    const m = matchRules([ruleAll], { filepath: "src/app.ts", language: "en", os: "win32" })
    expect(m.map((r) => r.filepath)).toContain("rules/all.md")
  })
  it("filters by os condition", () => {
    const ruleOs = { filepath: "rules/os.md", globs: ["src/**"], condition: { os: "darwin" }, body: "os rule" }
    const m = matchRules([ruleOs], { filepath: "src/app.ts", language: "zh", os: "win32" })
    expect(m).toEqual([])
    const m2 = matchRules([ruleOs], { filepath: "src/app.ts", language: "zh", os: "darwin" })
    expect(m2.map((r) => r.filepath)).toContain("rules/os.md")
  })
})

describe("globToRegExp", () => {
  it("matches ** across directories", () => {
    expect(globToRegExp("src/**/*.ts").test("src/a/b/c.ts")).toBe(true)
    expect(globToRegExp("src/**/*.ts").test("src/app.ts")).toBe(true)
  })
  it("does not match outside the pattern", () => {
    expect(globToRegExp("src/**/*.ts").test("docs/app.ts")).toBe(false)
  })
})