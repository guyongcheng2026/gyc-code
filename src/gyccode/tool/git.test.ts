import { describe, expect, it } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { GitStatusTool, GitDiffTool, GitLogTool, GitCommitTool, GitBranchTool, GitStashTool } from "./git"
import { Git } from "@/git"
import { AppProcess } from "@gyccode/core/process"
import { Truncate } from "./truncate"
import { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"
import type * as Tool from "./tool"

/**
 * P0-3（对标指标 8 · Git 集成）：模型此前没有 git 工具，只能靠 shell 敲命令。
 *
 * 用一个记录调用的假 Git.Service 验证「工具真的把参数转发对了」——
 * 参数拼错等于工具白做，而这类错误只有真跑一遍 git 才暴露得出来。
 * 不测真实仓库：那是 Git.Service 的职责。
 *
 * InstanceState.context 在 InstanceRef 缺失时会回退到 process.cwd()，
 * 因此这里只需提供 Git.Service，cwd 用哪个都不影响被断言的参数。
 */

type Recorded = { args: string[] }

const fakeGit = (
  responses: Record<string, { code: number; out?: string; err?: string }> = {},
  recorded: Recorded[] = [],
): Git.Interface =>
  ({
    run: (args: string[], opts: { cwd: string }) => {
      recorded.push({ args: Array.isArray(args) ? args : [String(args)] })
      const hit = responses[args[0] ?? ""] ?? { code: 0, out: "" }
      return Effect.succeed({
        exitCode: hit.code,
        text: () => hit.out ?? "",
        stdout: Buffer.from(hit.out ?? ""),
        stderr: Buffer.from(hit.err ?? ""),
        truncated: false,
        cwd: opts.cwd,
      })
    },
  }) as unknown as Git.Interface

/**
 * Tool.define 返回的是 Info（其 init() 才产出带 execute 的 Def）。
 * 依赖链上还有 Truncate / Agent：wrap 会调 truncate.output 截断、
 * agents.get 取 agent 配置，故必须给「能用」的桩，不能只给 undefined。
 * InstanceState.context 在 InstanceRef 缺失时回退到 process.cwd()，
 * 无需装配实例上下文，cwd 用哪个都不影响被断言的参数。
 */
const agentStub = { get: () => Effect.succeed({}), default: () => Effect.succeed({}) }
// wrap 会 `yield* truncate.output(...)` 并读取 truncated.content / .truncated，
// 所以桩必须返回 Effect 且形状对得上，返回裸字符串会在 yield 处炸掉。
const truncateStub = {
  output: (text: string) => Effect.succeed({ content: text, truncated: false }),
}

const stubs = Layer.mergeAll(
  Layer.succeed(Truncate.Service, truncateStub as never),
  Layer.succeed(Agent.Service, agentStub as never),
  // W-2：git_commit 的 run_checks 需要跑 .githooks/pre-commit-checks.mjs 子进程。
  // 既有 git_commit 用例不开 run_checks，这里给一个「全部通过」的桩即可。
  Layer.succeed(
    AppProcess.Service,
    {
      run: () =>
        Effect.succeed({
          command: "node",
          exitCode: 0,
          stdout: Buffer.from("[PASS] 提交前检查"),
          stderr: Buffer.from(""),
          output: Buffer.from(""),
        }),
    } as never,
  ),
)

type AnyTool = {
  init: () => Effect.Effect<{
    execute: (p: unknown, c: Tool.Context) => Effect.Effect<{
      title?: string
      output: string
      metadata: Record<string, unknown>
    }>
  }>
}

/** 装配工具并返回可调用对象；返回 Exit 以便同时断言成功与拒绝。 */
const prepare = async <R>(make: Effect.Effect<unknown, never, R>, git: Git.Interface) => {
  // 各工具的 Service 依赖不同；用泛型 R 承接后统一由下面的 stub 层满足，
  // 避免在测试里复述依赖链（那是 registry node 的职责）。
  const info = (await Effect.runPromise(
    (make as Effect.Effect<AnyTool, never, never>).pipe(
      Effect.provideService(Git.Service, git),
      Effect.provide(stubs),
    ),
  )) as AnyTool
  const def = await Effect.runPromise(info.init())
  const invoke = (params: unknown) =>
    Effect.runPromise(
      def
        .execute(params, {
          sessionID: SessionID.make("ses_t"),
          messageID: MessageID.make("msg_t"),
          agent: "build",
          abort: new AbortController().signal,
        } as unknown as Tool.Context)
        .pipe(Effect.exit),
    )
  return {
    /** 执行并要求成功（成功时返回结果，失败直接抛出让测试红） */
    async ok(params: unknown) {
      const exit = await invoke(params)
      if (Exit.isFailure(exit)) throw new Error(`期望成功但失败: ${String(exit.cause)}`)
      return exit.value as { title?: string; output: string; metadata: Record<string, unknown> }
    },
    /** 执行并返回 Exit（用于断言「被拒绝」） */
    exit: invoke,
  }
}

describe("git 工具参数转发", () => {
  it("git_status 用 porcelain + branch；带 path 时用 -- 分隔", async () => {
    const rec: Recorded[] = []
    const call = await prepare(GitStatusTool, fakeGit({ status: { code: 0, out: "## main" } }, rec))
    const first = await call.ok({})
    expect(rec[0]!.args).toEqual(["status", "--porcelain=v1", "--branch"])
    expect(first.output).toContain("main")

    await call.ok({ path: "src/a.ts" })
    // -- 分隔很关键：否则路径可能被 git 当成修订范围
    expect(rec[1]!.args).toContain("--")
    expect(rec[1]!.args).toContain("src/a.ts")
  })

  it("git_diff 强制 --no-color，默认不加 --cached，staged=true 才加", async () => {
    const rec: Recorded[] = []
    const call = await prepare(GitDiffTool, fakeGit({ diff: { code: 0, out: "" } }, rec))
    await call.ok({})
    expect(rec[0]!.args).toContain("--no-color")
    expect(rec[0]!.args).not.toContain("--cached")
    await call.ok({ staged: true })
    expect(rec[1]!.args).toContain("--cached")
  })

  it("git_log 条数被夹在 1..200 —— 模型要 10 万条会撑爆上下文", async () => {
    const rec: Recorded[] = []
    const call = await prepare(GitLogTool, fakeGit({ log: { code: 0, out: "" } }, rec))
    await call.ok({ count: 999999 })
    expect(rec[0]!.args).toContain("-200")
    const rec2: Recorded[] = []
    const call2 = await prepare(GitLogTool, fakeGit({ log: { code: 0, out: "" } }, rec2))
    await call2.ok({ count: 0 })
    expect(rec2[0]!.args).toContain("-1")
  })
})

describe("git_commit 安全约定", () => {
  it("暂存区为空时拒绝，且绝不执行 commit", async () => {
    const rec: Recorded[] = []
    const call = await prepare(
      GitCommitTool,
      fakeGit({ "rev-parse": { code: 0, out: "/tmp/p" }, diff: { code: 0, out: "" } }, rec),
    )
    const exit = await call.exit({ message: "x" })
    expect(Exit.isFailure(exit)).toBe(true)
    expect(rec.some((r) => r.args[0] === "commit")).toBe(false)
  })

  it("未传 addAll 时绝不执行 git add -A（避免顺手全提交）", async () => {
    const rec: Recorded[] = []
    const call = await prepare(
      GitCommitTool,
      fakeGit(
        { "rev-parse": { code: 0, out: "/tmp/p" }, diff: { code: 0, out: "a.ts" }, commit: { code: 0 }, log: { code: 0, out: "abc fix" } },
        rec,
      ),
    )
    await call.ok({ message: "fix" })
    expect(rec.some((r) => r.args[0] === "add")).toBe(false)
  })

  it("显式 addAll=true 才执行 git add -A，并回报提交结果", async () => {
    const rec: Recorded[] = []
    const call = await prepare(
      GitCommitTool,
      fakeGit(
        { "rev-parse": { code: 0, out: "/tmp/p" }, add: { code: 0 }, diff: { code: 0, out: "a.ts" }, commit: { code: 0 }, log: { code: 0, out: "abc fix" } },
        rec,
      ),
    )
    const result = await call.ok({ message: "fix", addAll: true })
    expect(rec.find((r) => r.args[0] === "add")?.args).toEqual(["add", "-A"])
    expect(result.output).toContain("abc fix")
    expect(result.output).toContain("a.ts")
  })

  it("空 message 直接拒绝，不去打扰 git", async () => {
    const rec: Recorded[] = []
    const call = await prepare(GitCommitTool, fakeGit({}, rec))
    const exit = await call.exit({ message: "   " })
    expect(Exit.isFailure(exit)).toBe(true)
    expect(rec).toHaveLength(0)
  })
})

describe("git 失败时把 stderr 带回去——模型要靠它自我修正", () => {
  it("非零退出即失败，且诊断信息里保留 git 原文", async () => {
    const call = await prepare(
      GitStatusTool,
      fakeGit({ status: { code: 128, err: "fatal: not a git repository" } }),
    )
    const exit = await call.exit({})
    expect(Exit.isFailure(exit)).toBe(true)
    if (Exit.isFailure(exit)) expect(String(exit.cause)).toContain("not a git repository")
  })
})

describe("git_branch / git_stash 转发", () => {
  it("delete 需 force=true；未传时拒绝且不执行 -D", async () => {
    const rec: Recorded[] = []
    const call = await prepare(
      GitBranchTool,
      fakeGit({ branch: { code: 0, out: "  main" }, "rev-parse": { code: 0, out: "main" } }, rec),
    )
    const exit = await call.exit({ action: "delete", name: "old" })
    expect(Exit.isFailure(exit)).toBe(true)
    expect(rec.some((r) => r.args.includes("-D"))).toBe(false)
  })

  it("delete 传 force=true 才执行 -D", async () => {
    const rec: Recorded[] = []
    const call = await prepare(
      GitBranchTool,
      fakeGit({ branch: { code: 0, out: "  main" }, "rev-parse": { code: 0, out: "main" } }, rec),
    )
    await call.ok({ action: "delete", name: "old", force: true })
    expect(rec.some((r) => r.args[0] === "branch" && r.args.includes("-D"))).toBe(true)
  })

  it("list 回报当前分支（模型最需要知道自己在哪条分支上）", async () => {
    const rec: Recorded[] = []
    const call = await prepare(
      GitBranchTool,
      fakeGit({ branch: { code: 0, out: "  main\n  feature" }, "rev-parse": { code: 0, out: "main" } }, rec),
    )
    const result = await call.ok({ action: "list" })
    expect(result.metadata.branch).toBe("main")
    expect(result.output).toContain("当前分支：main")
  })

  it("stash pop 需 force=true；push 带 message 时透传 -m", async () => {
    const rec: Recorded[] = []
    const call = await prepare(GitStashTool, fakeGit({ stash: { code: 0, out: "" } }, rec))
    const denied = await call.exit({ action: "pop" })
    expect(Exit.isFailure(denied)).toBe(true)
    expect(rec.some((r) => r.args[1] === "pop")).toBe(false)

    await call.ok({ action: "push", message: "临时" })
    const push = rec.find((r) => r.args[1] === "push")
    expect(push?.args).toContain("-m")
    expect(push?.args).toContain("临时")

    await call.ok({ action: "pop", force: true })
    expect(rec.some((r) => r.args[0] === "stash" && r.args[1] === "pop")).toBe(true)
  })
})
