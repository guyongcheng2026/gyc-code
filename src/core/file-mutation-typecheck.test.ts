import { describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { AUTOCHECK_MAX_LATENCY_MS, typecheckDiagnostics, typecheckNotice } from "./file-mutation"

/** 仓库内自带的 tsc 入口，测试里用它避免依赖 npx 联网下载 */
const TSC_BIN = join(import.meta.dir, "..", "..", "node_modules", "typescript", "bin", "tsc")

const roots: string[] = []

/** 造一个最小可运行的 TS 工程：package.json 带 typecheck 脚本 + tsconfig.json */
function makeProject(files: Record<string, string>) {
  const root = mkdtempSync(join(tmpdir(), "gyccode-typecheck-"))
  roots.push(root)
  writeFileSync(
    join(root, "package.json"),
    JSON.stringify(
      {
        name: "typecheck-fixture",
        private: true,
        scripts: { typecheck: `bun "${TSC_BIN}" --noEmit -p tsconfig.json` },
      },
      null,
      2,
    ),
  )
  writeFileSync(
    join(root, "tsconfig.json"),
    JSON.stringify(
      { compilerOptions: { strict: true, noEmit: true, skipLibCheck: true }, include: ["*.ts"] },
      null,
      2,
    ),
  )
  for (const [name, content] of Object.entries(files)) writeFileSync(join(root, name), content)
  return root
}

process.on("exit", () => {
  for (const root of roots) rmSync(root, { recursive: true, force: true })
})

describe("file-mutation 写后自动类型检查", () => {
  test("解析含类型错误目录的错误行与错误码", async () => {
    const root = makeProject({ "bad.ts": 'export const a: number = "hello"\n' })
    const report = await typecheckDiagnostics(root)

    expect(report.status).toBe("checked")
    expect(report.diagnostics.length).toBeGreaterThan(0)
    const first = report.diagnostics[0]!
    expect(first.file.replace(/\\/g, "/")).toEndWith("bad.ts")
    expect(first.line).toBe(1)
    expect(first.code).toBe("TS2322")
    expect(first.message).toContain("string")
  })

  test("类型正确的目录返回空诊断", async () => {
    const root = makeProject({ "good.ts": "export const a: number = 1\n" })
    const report = await typecheckDiagnostics(root)

    expect(report.status).toBe("checked")
    expect(report.diagnostics).toEqual([])
  })

  test("命令不存在时返回结构化已跳过而不是抛异常", async () => {
    const report = await typecheckDiagnostics(tmpdir(), {
      command: ["gyccode-no-such-command-zzz"],
      maxLatencyMs: 5_000,
    })

    expect(report.status).toBe("skipped")
    expect(report.diagnostics).toEqual([])
    expect(report.reason ?? "").toContain("已跳过")
  })

  test("超时被中止并返回结构化已跳过而不是挂死", async () => {
    const report = await typecheckDiagnostics(tmpdir(), {
      command: ["bun", "-e", "setTimeout(() => {}, 10_000)"],
      maxLatencyMs: 200,
    })

    expect(report.status).toBe("skipped")
    expect(report.reason ?? "").toContain("超时")
  })

  test("显式关闭开关时直接返回已跳过", async () => {
    const report = await typecheckDiagnostics(tmpdir(), { enabled: false })

    expect(report.status).toBe("skipped")
    expect(report.reason ?? "").toContain("关闭")
  })

  test("错误报告文案包含计数、位置与必须修复提示", async () => {
    const root = makeProject({ "bad.ts": 'export const a: number = "hello"\n' })
    const notice = typecheckNotice(await typecheckDiagnostics(root))

    expect(notice).toContain("<tool_error")
    expect(notice).toContain("类型检查发现 1 个错误")
    expect(notice).toContain("bad.ts:1")
    expect(notice).toContain("TS2322")
    expect(notice).toContain("必须修复后再交付")
  })

  test("通过时文案回灌一行类型检查通过", () => {
    const notice = typecheckNotice({ status: "checked", command: "tsc --noEmit", diagnostics: [] })

    expect(notice).toContain("类型检查通过")
  })

  test("超时预算常量默认为 20000 毫秒", () => {
    expect(AUTOCHECK_MAX_LATENCY_MS).toBe(20_000)
  })

  // 如实说明：下面这条是「文本断言」，只验证 edit.ts 源码里存在接线调用，
  // 不执行 edit 工具、也不真正跑一次端到端的写后检查。
  test("接线断言：edit.ts 已引用写后类型检查（文本断言，非运行时）", async () => {
    const source = await Bun.file(join(import.meta.dir, "..", "gyccode", "tool", "edit.ts")).text()

    expect(source).toContain("file-mutation")
    expect(source).toContain("typecheckDiagnostics")
    expect(source).toContain("typecheckNotice")
  })
})