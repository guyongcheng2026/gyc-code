import { describe, expect, it } from "bun:test"
import { homedir } from "os"
import path from "path"
import {
  archiveRoot,
  blobsDir,
  gycSkillsHome,
  isValidSkillName,
  isValidSupportPath,
  learningStatePath,
  ledgerPath,
  skillDir,
  skillFile,
  skillsRoot,
  SUPPORT_DIRS,
  usagePath,
} from "./paths"

const ROOT = path.join("C:", "gyc-test-root")

describe("learning/paths 路径解析", () => {
  it("gycSkillsHome 显式传入 root 时原样返回（单测隔离）", () => {
    expect(gycSkillsHome(ROOT)).toBe(ROOT)
  })

  it("gycSkillsHome 不采纳 HERMES_HOME，避免把自建技能写进 Hermes 技能库", () => {
    const savedHermes = process.env.HERMES_HOME
    const savedSkills = process.env.GYCCODE_SKILLS_HOME
    const savedMemory = process.env.GYCCODE_MEMORY_HOME
    try {
      process.env.HERMES_HOME = path.join("C:", "hermes-home-must-be-ignored")
      delete process.env.GYCCODE_SKILLS_HOME
      delete process.env.GYCCODE_MEMORY_HOME

      // 指向 Hermes home 时不得照单全收
      expect(gycSkillsHome()).not.toContain("hermes-home-must-be-ignored")
      expect(gycSkillsHome()).toBe(path.join(homedir(), ".gyc"))

      // 显式覆盖优先
      process.env.GYCCODE_SKILLS_HOME = path.join("C:", "explicit-skills-home")
      expect(gycSkillsHome()).toBe(path.join("C:", "explicit-skills-home"))
    } finally {
      if (savedHermes === undefined) delete process.env.HERMES_HOME
      else process.env.HERMES_HOME = savedHermes
      if (savedSkills === undefined) delete process.env.GYCCODE_SKILLS_HOME
      else process.env.GYCCODE_SKILLS_HOME = savedSkills
      if (savedMemory === undefined) delete process.env.GYCCODE_MEMORY_HOME
      else process.env.GYCCODE_MEMORY_HOME = savedMemory
    }
  })

  it("空串 root 视为未传入", () => {
    const expected =
      process.env.GYCCODE_SKILLS_HOME || process.env.GYCCODE_MEMORY_HOME || path.join(homedir(), ".gyc")
    expect(gycSkillsHome("")).toBe(expected)
  })

  it("全部路径挂在 $GYC_HOME 之下的约定位置", () => {
    expect(skillsRoot(ROOT)).toBe(path.join(ROOT, "skills"))
    expect(archiveRoot(ROOT)).toBe(path.join(ROOT, "skills_archived"))
    expect(usagePath(ROOT)).toBe(path.join(ROOT, "skills", ".usage.json"))
    expect(ledgerPath(ROOT)).toBe(path.join(ROOT, "skills", ".ledger.jsonl"))
    expect(blobsDir(ROOT)).toBe(path.join(ROOT, "skills", ".blobs"))
    expect(learningStatePath(ROOT)).toBe(path.join(ROOT, "skills", ".learning-state.json"))
    expect(skillDir(ROOT, "pdf-export")).toBe(path.join(ROOT, "skills", "pdf-export"))
    expect(skillFile(ROOT, "pdf-export")).toBe(
      path.join(ROOT, "skills", "pdf-export", "SKILL.md"),
    )
  })

  it("SUPPORT_DIRS 只含三类目录", () => {
    expect([...SUPPORT_DIRS]).toEqual(["references", "templates", "scripts"])
  })
})

describe("isValidSkillName", () => {
  it("放行 kebab-case 能力名", () => {
    for (const name of ["pdf-export", "cache", "code-review-v2", "http2-debug-info"]) {
      expect(isValidSkillName(name)).toBe(true)
    }
  })

  it("拒绝非 kebab-case 与各种逃逸写法", () => {
    for (const name of [
      "",
      "Upper-Case",
      "-leading",
      "trailing-",
      "a/b",
      "../escape",
      "..",
      "has space",
      "under_score",
      "two--dash",
      "技能名",
    ]) {
      expect(isValidSkillName(name)).toBe(false)
    }
  })

  it("拒绝一次性动作前缀", () => {
    for (const name of [
      "fix-login",
      "debug-null",
      "audit-deps",
      "patch-memory",
      "hotfix-crash",
      "pr-123",
      "issue-42",
    ]) {
      expect(isValidSkillName(name)).toBe(false)
    }
  })

  it("拒绝含日期与时效性分段的临时命名", () => {
    for (const name of [
      "refactor-2026-09-12",
      "today-cleanup",
      "do-it-now",
      "temp-scratch",
      "tmp-notes",
      "check-now",
    ]) {
      expect(isValidSkillName(name)).toBe(false)
    }
  })

  it("不做子串误杀：templates / known-how 仍合法", () => {
    expect(isValidSkillName("skill-templates")).toBe(true)
    expect(isValidSkillName("known-how")).toBe(true)
  })

  it("非字符串一律拒绝", () => {
    expect(isValidSkillName(undefined)).toBe(false)
    expect(isValidSkillName(null)).toBe(false)
    expect(isValidSkillName(42)).toBe(false)
  })
})

describe("isValidSupportPath", () => {
  it("只放行 references/ templates/ scripts/ 之下的相对路径", () => {
    for (const p of [
      "references/api.md",
      "templates/report.md",
      "scripts/run.py",
      "references/nested/deep/note.txt",
    ]) {
      expect(isValidSupportPath(p)).toBe(true)
    }
  })

  it("拒绝其余顶级目录与裸目录名", () => {
    for (const p of ["assets/logo.png", "SKILL.md", "notes.md", "references", "reference/a.md"]) {
      expect(isValidSupportPath(p)).toBe(false)
    }
  })

  it("拒绝逃逸、绝对路径、反斜杠", () => {
    for (const p of [
      "references/../secret.md",
      "../references/a.md",
      "/etc/passwd",
      "C:\\Windows\\x.md",
      "references\\win.md",
      "C:/Windows/x.md",
      "~/references/a.md",
      "references/",
      "",
    ]) {
      expect(isValidSupportPath(p)).toBe(false)
    }
  })

  it("非字符串一律拒绝", () => {
    expect(isValidSupportPath(undefined)).toBe(false)
    expect(isValidSupportPath(1)).toBe(false)
  })
})
