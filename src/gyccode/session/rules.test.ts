import { describe, expect, it } from "bun:test"
import { parseRuleFrontmatter, matchRules, globToRegExp, loadRulesFromDirs } from "./rules"

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
  it("ignores commented language lines outside condition", () => {
    const r = parseRuleFrontmatter(`---\n# language: en\nglobs: ["src/**"]\n---\nbody`)
    expect(r?.condition).toBeUndefined()
    expect(r?.globs).toEqual(["src/**"])
  })
  it("parses language inside condition even with a comment elsewhere", () => {
    const r = parseRuleFrontmatter(`---\n# language: en\ncondition:\n  language: zh\n---\nbody`)
    expect(r?.condition).toEqual({ language: "zh" })
  })
  it("scopes os to the condition block", () => {
    const r = parseRuleFrontmatter(`---\nos: darwin\ncondition:\n  os: win32\n---\nbody`)
    expect(r?.condition).toEqual({ os: "win32" })
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
  it("matches a relative glob against an absolute filepath via rel", () => {
    const rule = { filepath: "rules/r.md", globs: ["src/**/*.ts"], body: "x" }
    const m = matchRules([rule], { filepath: "c:/proj/src/app.ts", rel: "src/app.ts", language: "zh", os: "win32" })
    expect(m).toHaveLength(1)
  })
  it("matches a Windows absolute filepath against a relative glob via rel", () => {
    const rule = { filepath: "rules/r.md", globs: ["src/**/*.ts"], body: "x" }
    const m = matchRules([rule], {
      filepath: "C:\\proj\\src\\app.ts",
      rel: "src/app.ts",
      language: "zh",
      os: "win32",
    })
    expect(m.map((r) => r.filepath)).toContain("rules/r.md")
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

describe("loadRulesFromDirs", () => {
  const files: Record<string, string> = {
    "rules/globbed.md": `---\nglobs: ["src/**/*.ts"]\ncondition:\n  os: win32\n---\nAlways use Effect for all effects in src.`,
    "rules/unconditional.md": `No frontmatter, applies everywhere.`,
    "rules/empty-frontmatter.md": `---\nglobs: ["src/**"]\n---\n`,
    "rules/whitespace.md": `   \n\n  `,
    "rules/blocked.md": `---\nglobs: ["docs/**"]\ncondition:\n  os: darwin\n---\nDocs must stay in Chinese.`,
  }
  const listMd = async (dir: string) => Object.keys(files).filter((f) => f.startsWith(dir + "/"))
  const readFile = async (p: string) => {
    if (files[p] === undefined) throw new Error(`missing: ${p}`)
    return files[p]!
  }

  it("loads globbed and glob-less rules", async () => {
    const rules = await loadRulesFromDirs(["rules"], readFile, listMd)
    expect(rules.map((r) => r.filepath)).toEqual([
      "rules/globbed.md",
      "rules/unconditional.md",
      "rules/blocked.md",
    ])
    expect(rules[0]?.globs).toEqual(["src/**/*.ts"])
    expect(rules[0]?.condition).toEqual({ os: "win32" })
    expect(rules[1]?.globs).toBeUndefined()
  })
  it("skips empty-body frontmatter and whitespace-only files", async () => {
    const rules = await loadRulesFromDirs(["rules"], readFile, listMd)
    expect(rules.map((r) => r.filepath)).not.toContain("rules/empty-frontmatter.md")
    expect(rules.map((r) => r.filepath)).not.toContain("rules/whitespace.md")
  })
  it("skips unreadable files", async () => {
    const badRead = async () => {
      throw new Error("boom")
    }
    const rules = await loadRulesFromDirs(["rules"], badRead, listMd)
    expect(rules).toEqual([])
  })
  it("missing dirs yield no rules", async () => {
    const rules = await loadRulesFromDirs(["nope"], readFile, listMd)
    expect(rules).toEqual([])
  })
  it("end-to-end: loaded rules match an absolute read path via rel and respect os", async () => {
    const rules = await loadRulesFromDirs(["rules"], readFile, listMd)
    const nearby = matchRules(rules, {
      filepath: "c:/proj/src/app.ts",
      rel: "src/app.ts",
      language: "zh",
      os: "win32",
    })
    expect(nearby.map((r) => r.filepath)).toContain("rules/globbed.md")
    expect(nearby.map((r) => r.filepath)).not.toContain("rules/blocked.md")
  })
})