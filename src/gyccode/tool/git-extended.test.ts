import { describe, expect, it } from "bun:test"
import { Effect, Exit, Layer } from "effect"
import { GitPushTool, GhPrCreateTool, CiStatusTool, destructiveGuard, ghMissingNotice } from "./git"
import { Git } from "@/git"
import { AppProcess } from "@gyccode/core/process"
import { Truncate } from "./truncate"
import { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"
import type * as Tool from "./tool"

/**
 * W-3 / W-5（对标指标 19 文档生成 / 20 重构能力）
 *
 * 模型此前只能在 shell 里手敲 `git push` / `gh pr create`，参数拼接与错误解析全靠
 * 猜；CI 是否红更是完全看不见。这里锁定三个新工具的参数转发与安全约定。
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

const fakeProcess = (response: { code: number; out?: string; err?: string }, recorded: Recorded[] = []) =>
  ({
    run: (command: { command: string; args: readonly string[] }) => {
      recorded.push({ args: [command.command, ...command.args] })
      return Effect.succeed({
        command: command.command,
        exitCode: response.code,
        stdout: Buffer.from(response.out ?? ""),
        stderr: Buffer.from(response.err ?? ""),
        output: Buffer.from(response.out ?? ""),
      })
    },
  }) as unknown as AppProcess.Interface

const agentStub = { get: () => Effect.succeed({}), default: () => Effect.succeed({}) }
const truncateStub = { output: (text: string) => Effect.succeed({ content: text, truncated: false }) }

const stubs = Layer.mergeAll(
  Layer.succeed(Truncate.Service, truncateStub as never),
  Layer.succeed(Agent.Service, agentStub as never),
)

type AnyTool = {
  init: () => Effect.Effect<{
    execute: (p: unknown, c: Tool.Context) => Effect.Effect<{ title?: string; output: string }>
  }>
}

/** 装配工具：把工具需要的服务桩注入，初始化后返回可调用的 execute。 */
const prepare = async (make: Effect.Effect<unknown, never, unknown>) => {
  const info = (await Effect.runPromise(
    (make as Effect.Effect<AnyTool, never, never>).pipe(Effect.provide(stubs)),
  )) as AnyTool
  const def = await Effect.runPromise(info.init())
  return {
    invoke(params: unknown) {
      return Effect.runPromise(
        def
          .execute(params, {
            sessionID: SessionID.make("ses_t"),
            messageID: MessageID.make("msg_t"),
            agent: "build",
            abort: new AbortController().signal,
          } as unknown as Tool.Context)
          .pipe(Effect.exit),
      )
    },
  }
}

describe("git_push", () => {
  it("默认只推当前分支，不带任何远端参数", async () => {
    const recorded: Recorded[] = []
    const tool = await prepare(GitPushTool.pipe(Effect.provideService(Git.Service, fakeGit({}, recorded))))
    const exit = await tool.invoke({})
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(recorded[0]!.args[0]).toBe("push")
    expect(recorded[0]!.args).not.toContain("--force")
  })

  it("set_upstream 与显式 remote/branch 会被转发", async () => {
    const recorded: Recorded[] = []
    const tool = await prepare(GitPushTool.pipe(Effect.provideService(Git.Service, fakeGit({}, recorded))))
    await tool.invoke({ set_upstream: true, remote: "upstream", branch: "feature/x" })
    // branch 前有 "--"：remote/branch 是模型可控的自由文本，以 "-" 开头会被 git
    // 当成选项解析，用 -- 结束选项解析是这条防线的一半（另一半是前导 - 的拒绝）。
    expect(recorded[0]!.args).toEqual(["push", "--set-upstream", "upstream", "--", "feature/x"])
  })

  it("remote/branch 以 - 开头一律被拒绝，不会落到 git 命令行", async () => {
    for (const bad of [{ remote: "--mirror" }, { branch: "-f" }]) {
      const recorded: Recorded[] = []
      const tool = await prepare(GitPushTool.pipe(Effect.provideService(Git.Service, fakeGit({}, recorded))))
      const exit = await tool.invoke(bad)
      expect(Exit.isFailure(exit)).toBe(true)
      expect(recorded).toHaveLength(0)
    }
  })
})

describe("破坏性闸覆盖 push", () => {
  it("force push 一律被拒绝，且拒绝理由可回灌给模型", () => {
    const denied = destructiveGuard("push", "main", true)
    expect(denied).toBeString()
    expect(denied!).toContain("强制推送")
  })

  it("普通 push 不受影响", () => {
    expect(destructiveGuard("push", "main", false)).toBeNull()
    expect(destructiveGuard("push", "main", undefined)).toBeNull()
  })
})

describe("gh_pr_create", () => {
  it("参数被正确转发给 gh", async () => {
    const recorded: Recorded[] = []
    const tool = await prepare(
      GhPrCreateTool.pipe(Effect.provideService(AppProcess.Service, fakeProcess({ code: 0, out: "u" }, recorded))),
    )
    const exit = await tool.invoke({ title: "feat: x", body: "body", base: "main", draft: true })
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(recorded[0]!.args).toEqual([
      "gh",
      "pr",
      "create",
      "--title",
      "feat: x",
      "--body",
      "body",
      "--base",
      "main",
      "--draft",
    ])
  })

  it("gh 未安装时给出可行动提示，而不是含糊的失败", () => {
    const notice = ghMissingNotice("gh_pr_create")
    expect(notice).toContain("gh_not_installed")
    expect(notice).toContain("安装")
  })
})

describe("ci_status", () => {
  it("默认查最近 5 次运行并请求结构化字段", async () => {
    const recorded: Recorded[] = []
    const tool = await prepare(
      CiStatusTool.pipe(Effect.provideService(AppProcess.Service, fakeProcess({ code: 0, out: "[]" }, recorded))),
    )
    const exit = await tool.invoke({})
    expect(Exit.isSuccess(exit)).toBe(true)
    expect(recorded[0]!.args).toContain("--limit")
    expect(recorded[0]!.args).toContain("5")
    expect(recorded[0]!.args.join(" ")).toContain("conclusion")
  })

  it("limit 非法时回落到 1 而不是报错", async () => {
    const recorded: Recorded[] = []
    const tool = await prepare(
      CiStatusTool.pipe(Effect.provideService(AppProcess.Service, fakeProcess({ code: 0, out: "[]" }, recorded))),
    )
    await tool.invoke({ limit: 0 })
    expect(recorded[0]!.args).toContain("1")
  })
})