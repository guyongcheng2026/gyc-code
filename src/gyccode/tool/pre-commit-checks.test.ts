import { describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

// W-2（对标指标 18 · 代码审查）：四检此前只存在于 .githooks/pre-commit 这段
// shell 里，模型提交时完全看不见——tsc 不过它也不知道。这里锁定抽取出来的检查模块。
// .mjs 没有类型声明，用动态 import + 本地接口约束，避免给 tsconfig 加 allowJs。
const mod =
  // @ts-expect-error .githooks 是纯 JS 目录，没有 .d.ts；类型由下面这行 as unknown as 约束
  (await import("../../../.githooks/pre-commit-checks.mjs")) as unknown as {
  runChecks: (options: { staged?: string[]; skipTypecheck?: boolean; root?: string; cwd?: string }) => {
    ok: boolean
    checks: { id: string; status: string; title: string; output: string }[]
  }
  formatReport: (report: unknown) => string
  formatFailures: (report: unknown) => { id: string; title: string; output: string }[]
  MOJIBAKE_EXTS: string[]
  SUBPROCESS_TIMEOUT_MS: number
  runTypecheck: (root: string, project?: string) => { code: number; out: string; err: string }
}
const { runChecks, formatReport, formatFailures, MOJIBAKE_EXTS, SUBPROCESS_TIMEOUT_MS } = mod

/** 走公开的 runTypecheck 路径，验证超时收口对调用方是可读的失败而非挂起。 */
function runNodeScriptSafe(command: string, _args: string[]) {
  return mod.runTypecheck(command, "tsconfig.json")
}

describe("提交前四检 · 结构化结果", () => {
  it("四项检查都在结果里出现（含工作区垃圾检查），没有占位实现", () => {
    const report = runChecks({ staged: ["README.md"], skipTypecheck: true, root: process.cwd() })
    const ids = report.checks.map((c) => c.id)
    for (const id of ["mojibake", "brandGuard", "bugPatterns", "typecheck"]) {
      expect(ids).toContain(id)
    }
    // 工作区垃圾检查是铁律 7，抽取时不能丢
    expect(ids).toContain("workspaceJunk")
  })

  it("暂存区没有 TS 改动时，类型门禁标记为 skipped 而不是 pass", () => {
    const report = runChecks({ staged: ["README.md"], skipTypecheck: false, root: process.cwd() })
    const typecheck = report.checks.find((c) => c.id === "typecheck")
    expect(typecheck?.status).toBe("skipped")
  })

  it("formatFailures 只列失败项，供 git_commit 回灌", () => {
    const failures = formatFailures({
      checks: [
        { id: "a", status: "pass", title: "A", output: "" },
        { id: "b", status: "fail", title: "B", output: "boom" },
      ],
    })
    expect(failures).toHaveLength(1)
    expect(failures[0]!.id).toBe("b")
  })

  it("formatReport 会标出 PASS/FAIL/SKIP", () => {
    const text = formatReport({
      checks: [
        { id: "a", status: "pass", title: "A", output: "" },
        { id: "b", status: "fail", title: "B", output: "boom" },
      ],
    })
    expect(text).toContain("[PASS] A")
    expect(text).toContain("[FAIL] B")
  })

  it("mojibake 检查覆盖 ts/tsx/md 等文本后缀", () => {
    for (const ext of [".ts", ".tsx", ".md"]) expect(MOJIBAKE_EXTS).toContain(ext)
  })
})

describe("提交前四检 · 超时不会卡死会话", () => {
  it("超时常量是有限值（不是 0 / Infinity 这种等于没设的写法）", () => {
    expect(SUBPROCESS_TIMEOUT_MS).toBeGreaterThan(0)
    expect(Number.isFinite(SUBPROCESS_TIMEOUT_MS)).toBe(true)
    expect(SUBPROCESS_TIMEOUT_MS).toBeLessThanOrEqual(300_000)
  })

  it("命令不存在时返回可读的 127 诊断，不抛异常", () => {
    const r = runNodeScriptSafe("this-binary-does-not-exist-42", [])
    expect(r.code).toBe(127)
    expect(r.err.length).toBeGreaterThan(0)
  }, 60_000)
})

describe("提交前四检 · 类型门禁真的会拦", () => {
  it("src 下的 TS 改动且类型有错时，typecheck 必须 fail", () => {
    const root = mkdtempSync(path.join(tmpdir(), "precommit-"))
    mkdirSync(path.join(root, "src"), { recursive: true })
    mkdirSync(path.join(root, "node_modules", "typescript", "bin"), { recursive: true })
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
    )
    // 故意写错类型
    writeFileSync(path.join(root, "src", "bad.ts"), "export const x: number = 'not a number'\n")

    const report = runChecks({ staged: ["src/bad.ts"], skipTypecheck: false, root })
    const typecheck = report.checks.find((c) => c.id === "typecheck")
    expect(typecheck?.status).toBe("fail")
    expect(report.ok).toBe(false)
  }, 120_000)

  it("类型正确时 typecheck pass", () => {
    const root = mkdtempSync(path.join(tmpdir(), "precommit-ok-"))
    mkdirSync(path.join(root, "src"), { recursive: true })
    writeFileSync(
      path.join(root, "tsconfig.json"),
      JSON.stringify({ compilerOptions: { strict: true, noEmit: true }, include: ["src"] }),
    )
    writeFileSync(path.join(root, "src", "good.ts"), "export const x: number = 1\n")

    const report = runChecks({ staged: ["src/good.ts"], skipTypecheck: false, root })
    const typecheck = report.checks.find((c) => c.id === "typecheck")
    expect(typecheck?.status).toBe("pass")
  }, 120_000)
})