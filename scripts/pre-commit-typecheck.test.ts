import { describe, expect, it } from "bun:test"
import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import {
  buildIncrementalTsconfig,
  MIN_FULL_TYPECHECK_FREE_MEM_MB,
  runIncrementalTypecheck,
  shouldDowngradeTypecheck,
} from "../.githooks/pre-commit-checks.mjs"

// 提交前类型门禁的内存自适应降级。
//
// 背景：本机 3.9GB 物理内存 / 7.9GB 提交上限，全量 tsc --noEmit 会被系统
// 提交上限掐死（Windows errno=1455，node/tsgo 进程启动即失败），表现为
// 「怎么都提交不进去」而非任何类型错误。降级为「只检查暂存区文件」后，
// 类型图规模从全项目收敛到暂存文件及其依赖，内存占用回到可接受区间。

describe("类型门禁的内存降级判定", () => {
  it("可用内存低于阈值时降级", () => {
    expect(shouldDowngradeTypecheck(MIN_FULL_TYPECHECK_FREE_MEM_MB - 1)).toBe(true)
    expect(shouldDowngradeTypecheck(512)).toBe(true)
  })

  it("可用内存达到阈值时走全量", () => {
    expect(shouldDowngradeTypecheck(MIN_FULL_TYPECHECK_FREE_MEM_MB)).toBe(false)
    expect(shouldDowngradeTypecheck(MIN_FULL_TYPECHECK_FREE_MEM_MB + 1024)).toBe(false)
  })

  it("可用内存读数异常时不降级（避免把真实类型错误挡在门外）", () => {
    expect(shouldDowngradeTypecheck(Number.NaN)).toBe(false)
    expect(shouldDowngradeTypecheck(Number.POSITIVE_INFINITY)).toBe(false)
  })

  it("阈值可注入", () => {
    expect(shouldDowngradeTypecheck(1500, 1024)).toBe(false)
    expect(shouldDowngradeTypecheck(1500, 2048)).toBe(true)
  })
})

describe("增量类型门禁的临时配置", () => {
  it("只 include 暂存文件，且继承主 tsconfig", () => {
    const config = JSON.parse(
      buildIncrementalTsconfig(["src/tui/util/target-fps.ts", "src/tui/app.tsx"]),
    )
    expect(config.extends).toBe("./tsconfig.json")
    expect(config.include).toEqual(["./src/tui/util/target-fps.ts", "./src/tui/app.tsx"])
  })

  it("路径分隔符统一为正斜杠（Windows 上 tsconfig 也用正斜杠）", () => {
    const config = JSON.parse(buildIncrementalTsconfig(["src\\tui\\app.tsx"]))
    expect(config.include).toEqual(["./src/tui/app.tsx"])
  })
})

describe("增量类型门禁的执行", () => {
  it("临时配置在检查期间存在、检查后被清理", () => {
    const root = join(tmpdir(), "gyc-precommit-mem-test")
    mkdirSync(root, { recursive: true })
    const project = "tsconfig.precommit-inc.json"
    let seen: string | undefined
    let configDuringRun: string | undefined

    const result = runIncrementalTypecheck(root, ["src/tui/app.tsx"], {
      runTypecheck: (_root: string, proj: string) => {
        seen = proj
        const path = join(root, proj)
        configDuringRun = existsSync(path) ? readFileSync(path, "utf8") : undefined
        return { code: 0, out: "", err: "" }
      },
    })

    expect(result.code).toBe(0)
    expect(seen).toBe(project)
    expect(configDuringRun).toBeDefined()
    expect(JSON.parse(configDuringRun!).include).toEqual(["./src/tui/app.tsx"])
    // 检查结束后不得留下临时文件（否则会污染工作区与 git status）
    expect(existsSync(join(root, project))).toBe(false)
  })

  it("检查失败时同样清理临时配置", () => {
    const root = join(tmpdir(), "gyc-precommit-mem-test-fail")
    mkdirSync(root, { recursive: true })
    const project = "tsconfig.precommit-inc.json"
    const result = runIncrementalTypecheck(root, ["src/tui/app.tsx"], {
      runTypecheck: () => ({ code: 2, out: "boom", err: "" }),
    })
    expect(result.code).toBe(2)
    expect(existsSync(join(root, project))).toBe(false)
  })
})
