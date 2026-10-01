import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Git } from "@/git"
import { InstanceState } from "@/effect/instance-state"

/**
 * P0-3（对标指标 8 · Git 集成）：此前模型没有 git 工具，只能靠 shell 敲命令——
 * 得自己拼参数、处理引号转义、解析输出，而底层的 Git.Service 其实已经完备，
 * 只是没暴露给模型。这里在其上建工具，复用而不重写 git 逻辑。
 *
 * 安全约定：branch delete 与 stash pop 会丢弃工作区内容，一律要求显式 force
 * 参数；不提供「全量提交」的隐式路径（git_commit 只提交已 staged 的）。
 */

/**
 * Git.Service 在**定义期**解析（与 worktree.ts 同一模式）：Tool.define 要求整个
 * 定义是 `Effect<..., never, never>`，若把 Service 需求留到 execute 里，
 * 类型会把它泄进工具的 R 通道，注册表就装配不上。
 * InstanceState.context 相反——它按调用变化，只能在 execute 内取。
 */
/**
 * 破坏性操作的放行判定。抽成纯函数是为了能脱离 Effect 直接测——
 * 「删分支要 force、pop 暂存要 force」这种安全约定一旦被绕过，
 * 丢的是未合并的提交，不能只靠集成测试兜底。
 *
 * 返回 null 表示可以执行；否则返回拒绝理由（直接回灌给模型）。
 */
export const destructiveGuard = (
  action: string,
  name: string | undefined,
  force: boolean | undefined,
): string | null => {
  if (action === "delete") {
    if (!name) return "git_branch delete 失败：缺少 name 参数"
    if (force !== true) {
      return `git_branch delete 失败：删除分支 ${name} 会丢失其未合并的提交。确认无误后请显式传 force=true。`
    }
    return null
  }
  if (action === "pop") {
    if (force !== true) {
      return "git_stash pop 失败：恢复暂存内容可能与当前工作区冲突。确认无误后请显式传 force=true。"
    }
    return null
  }
  if ((action === "create" || action === "switch") && !name) {
    return `git_branch ${action} 失败：缺少 name 参数`
  }
  return null
}

const runGit = (
  git: Git.Interface,
  cwd: string,
  args: string[],
): Effect.Effect<{ readonly code: number; readonly out: string; readonly err: string }> =>
  git.run(args, { cwd }).pipe(
    Effect.map((result) => ({
      code: result.exitCode,
      out: result.text(),
      err: result.stderr.toString("utf8").trim(),
    })),
  )

/** git 失败时把 stderr 原样带回——模型需要看到 git 自己的诊断才能自我修正。 */
const failWith = (tool: string, code: number, out: string, err: string) =>
  Effect.die(
    new Error(
      [`${tool} 失败（退出码 ${code}）`, err || out || "git 未输出诊断信息"].filter(Boolean).join("\n"),
    ),
  )

/** 执行一条 git 命令；非零退出即失败。返回已解析好的结果与仓库根目录。 */
const gitCommand = (
  git: Git.Interface,
  tool: string,
  args: string[],
): Effect.Effect<{ readonly out: string; readonly cwd: string }> =>
  Effect.gen(function* () {
    const ctx = yield* InstanceState.context
    const cwd = ctx.project.worktree
    const result = yield* runGit(git, cwd, args)
    if (result.code !== 0) return yield* failWith(tool, result.code, result.out, result.err)
    return { out: result.out, cwd }
  })

// ── git_status ───────────────────────────────────────────────────────────────

const StatusParameters = Schema.Struct({
  path: Schema.optional(Schema.String).annotate({
    description: "只显示该路径下的变更。默认显示整个仓库。",
  }),
})

export const GitStatusTool = Tool.define(
  "git_status",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description:
        "查看 Git 工作区状态：哪些文件已暂存(staged)、哪些已修改但未暂存、哪些未跟踪(??)。提交前先调用它确认将要提交的内容。",
      parameters: StatusParameters,
      execute: (params: Schema.Schema.Type<typeof StatusParameters>, _ctx: Tool.Context) =>
        gitCommand(git, "git_status", [
          "status",
          "--porcelain=v1",
          "--branch",
          ...(params.path ? ["--", params.path] : []),
        ]).pipe(
          Effect.map(({ out }) => ({
            title: "Git 工作区状态",
            output: out || "(工作区干净)",
            metadata: { vcs: "git" as const },
          })),
          Effect.orDie,
        ),
    }
  }),
)

// ── git_diff ─────────────────────────────────────────────────────────────────

const DiffParameters = Schema.Struct({
  staged: Schema.optional(Schema.Boolean).annotate({
    description: "只看已暂存的变更。默认对比工作区与 HEAD。",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "只显示该文件的差异。",
  }),
})

export const GitDiffTool = Tool.define(
  "git_diff",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description:
        "查看未提交的代码差异(unified diff)。修改代码后、提交前调用它自查改了什么。不带参数看工作区相对 HEAD 的全部改动。",
      parameters: DiffParameters,
      execute: (params: Schema.Schema.Type<typeof DiffParameters>, _ctx: Tool.Context) =>
        gitCommand(git, "git_diff", [
          "diff",
          "--no-color",
          ...(params.staged ? ["--cached"] : []),
          ...(params.path ? ["--", params.path] : []),
        ]).pipe(
          Effect.map(({ out }) => ({
            title: "Git 差异",
            output: out || "(无差异)",
            metadata: { vcs: "git" as const },
          })),
          Effect.orDie,
        ),
    }
  }),
)

// ── git_log ──────────────────────────────────────────────────────────────────

const LogParameters = Schema.Struct({
  count: Schema.optional(Schema.Number).annotate({
    description: "返回最近多少条提交，默认 20，上限 200。",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "只看影响该文件的提交。",
  }),
})

export const GitLogTool = Tool.define(
  "git_log",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description: "查看提交历史(commit log)，含哈希、作者、时间与提交说明。用于了解这个仓库最近改了什么。",
      parameters: LogParameters,
      execute: (params: Schema.Schema.Type<typeof LogParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const n = Math.min(Math.max(1, Math.floor(params.count ?? 20)), 200)
          const { out } = yield* gitCommand(git, "git_log", [
            "log",
            `-${n}`,
            "--date=short",
            "--pretty=format:%h  %ad  %an  %s",
            ...(params.path ? ["--", params.path] : []),
          ])
          return {
            title: `最近 ${n} 条提交`,
            output: out || "(没有提交记录)",
            metadata: { vcs: "git" as const },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ── git_commit ───────────────────────────────────────────────────────────────

const CommitParameters = Schema.Struct({
  message: Schema.String.annotate({
    description: "提交说明。应说明「为什么改」，而不只是「改了什么」。",
  }),
  addAll: Schema.optional(Schema.Boolean).annotate({
    description:
      "提交前先执行 git add -A，把所有改动（含未跟踪文件）一并暂存。默认关闭——默认只提交已暂存的内容，避免误提交。",
  }),
})

export const GitCommitTool = Tool.define(
  "git_commit",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description:
        "创建一次 Git 提交。默认只提交**已暂存**的内容；如需一并提交工作区改动，显式传 addAll=true。",
      parameters: CommitParameters,
      execute: (params: Schema.Schema.Type<typeof CommitParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const message = params.message.trim()
          if (!message) return yield* Effect.die(new Error("git_commit 失败：提交说明不能为空"))
          const { cwd } = yield* gitCommand(git, "git_commit", ["rev-parse", "--show-toplevel"])

          if (params.addAll === true) {
            const added = yield* runGit(git, cwd, ["add", "-A"])
            if (added.code !== 0) return yield* failWith("git_commit（git add）", added.code, added.out, added.err)
          }

          // 空提交是常见失误：没有 staged 内容时 git 会报错，但错误晦涩，
          // 这里提前拦下并说清楚该怎么做。
          const staged = yield* runGit(git, cwd, ["diff", "--cached", "--name-only"])
          if (staged.code !== 0) return yield* failWith("git_commit（检查暂存区）", staged.code, staged.out, staged.err)
          if (staged.out.trim() === "") {
            return yield* Effect.die(
              new Error("git_commit 失败：暂存区为空，没有可提交的内容。若确实要提交工作区全部改动，请传 addAll=true。"),
            )
          }

          const committed = yield* runGit(git, cwd, ["commit", "-m", message])
          if (committed.code !== 0) return yield* failWith("git_commit", committed.code, committed.out, committed.err)

          const head = yield* runGit(git, cwd, ["log", "-1", "--pretty=format:%h %s"])
          return {
            title: "已提交",
            output: `提交成功\n${head.out}\n\n已提交文件：\n${staged.out}`,
            metadata: { vcs: "git" as const },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ── git_branch ───────────────────────────────────────────────────────────────

const BranchParameters = Schema.Struct({
  action: Schema.Literals(["list", "create", "switch", "delete"]).annotate({
    description: "要执行的操作。",
  }),
  name: Schema.optional(Schema.String).annotate({
    description: "分支名。create / switch / delete 时必填。",
  }),
  force: Schema.optional(Schema.Boolean).annotate({
    description: "delete 时必填。删除分支会丢失其未合并的提交，危险操作需显式确认。",
  }),
})

export const GitBranchTool = Tool.define(
  "git_branch",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description:
        "分支操作：列出分支 / 创建 / 切换 / 删除。删除分支会丢失未合并的提交，必须显式传 force=true。",
      parameters: BranchParameters,
      execute: (params: Schema.Schema.Type<typeof BranchParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const denied = destructiveGuard(params.action, params.name, params.force)
          if (denied) return yield* Effect.die(new Error(denied))
          const { out, cwd } = yield* gitCommand(git, "git_branch", ["branch", "--list"])
          switch (params.action) {
            case "list": {
              // 一并回报当前分支：模型在 list 时最需要知道「我现在在哪条分支上」，
              // 同时让各分支返回的 metadata 形状一致（否则 TS 会从首个分支推断出
              // branch?: undefined，后续带 branch 的分支就冲突了）。
              const current = yield* gitCommand(git, "git_branch（当前分支）", [
                "rev-parse",
                "--abbrev-ref",
                "HEAD",
              ])
              return {
                title: "分支列表",
                output: out ? `${out}\n\n当前分支：${current.out}` : "(无分支)",
                metadata: { vcs: "git" as const, branch: current.out },
              }
            }
            case "create": {
              // name 的存在性已由 destructiveGuard 统一校验
              const r = yield* runGit(git, cwd, ["branch", params.name as string])
              if (r.code !== 0) return yield* failWith("git_branch create", r.code, r.out, r.err)
              return {
                title: `已创建分支 ${params.name}`,
                output: `分支 ${params.name} 已创建（尚未切换过去）。`,
                metadata: { vcs: "git" as const, branch: params.name },
              }
            }
            case "switch": {
              if (!params.name) return yield* Effect.die(new Error("git_branch switch 失败：缺少 name 参数"))
              const r = yield* runGit(git, cwd, ["checkout", params.name])
              if (r.code !== 0) return yield* failWith("git_branch switch", r.code, r.out, r.err)
              return {
                title: `已切换到 ${params.name}`,
                output: `已切换到分支 ${params.name}。`,
                metadata: { vcs: "git" as const, branch: params.name },
              }
            }
            case "delete": {
              const r = yield* runGit(git, cwd, ["branch", "-D", params.name as string])
              if (r.code !== 0) return yield* failWith("git_branch delete", r.code, r.out, r.err)
              return {
                title: `已删除分支 ${params.name}`,
                output: `分支 ${params.name} 已删除。`,
                metadata: { vcs: "git" as const, branch: params.name },
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ── git_stash ────────────────────────────────────────────────────────────────

const StashParameters = Schema.Struct({
  action: Schema.Literals(["list", "push", "pop"]).annotate({
    description: "要执行的操作。",
  }),
  message: Schema.optional(Schema.String).annotate({
    description: "push 时为这次暂存加个说明，便于之后辨认。",
  }),
  force: Schema.optional(Schema.Boolean).annotate({
    description: "pop 时必填。恢复暂存会与当前工作区内容冲突，危险操作需显式确认。",
  }),
})

export const GitStashTool = Tool.define(
  "git_stash",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description:
        "Git 暂存栈操作：列出 / 压入 / 弹出。pop 会把暂存内容恢复到工作区，可能与当前改动冲突，必须显式传 force=true。",
      parameters: StashParameters,
      execute: (params: Schema.Schema.Type<typeof StashParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          // stash 没有分支名概念，守卫只用 action 与 force
          const denied = destructiveGuard(params.action, undefined, params.force)
          if (denied) return yield* Effect.die(new Error(denied))
          const { out, cwd } = yield* gitCommand(git, "git_stash", ["stash", "list"])
          switch (params.action) {
            case "list":
              return { title: "暂存列表", output: out || "(暂存栈为空)", metadata: { vcs: "git" as const } }
            case "push": {
              const args = ["stash", "push"]
              if (params.message) args.push("-m", params.message)
              const r = yield* runGit(git, cwd, args)
              if (r.code !== 0) return yield* failWith("git_stash push", r.code, r.out, r.err)
              return { title: "已暂存工作区", output: "工作区改动已压入暂存栈。", metadata: { vcs: "git" as const } }
            }
            case "pop": {
              const r = yield* runGit(git, cwd, ["stash", "pop"])
              if (r.code !== 0) return yield* failWith("git_stash pop", r.code, r.out, r.err)
              return {
                title: "已恢复暂存",
                output: r.out || r.err || "暂存内容已恢复到工作区。",
                metadata: { vcs: "git" as const },
              }
            }
          }
        }).pipe(Effect.orDie),
    }
  }),
)
