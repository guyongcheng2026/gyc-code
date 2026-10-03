import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Git } from "@/git"
import { AppProcess } from "@gyccode/core/process"
import { ChildProcess } from "effect/unstable/process"
import { existsSync } from "node:fs"
import path from "path"
import { rollback as rollbackFile } from "@/tool/file-backup"
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
  // W-3：强推会覆盖远端历史（丢的是别人已拉取的提交），一律拒绝，
  // 即使模型显式传了 force —— 这里不接受任何绕过形式。
  if (action === "push" && force === true) {
    return "git_push 失败：强制推送（force）会覆盖远端历史，可能丢失他人已拉取的提交，本工具不予执行。请改用非强制推送，或先与用户确认后由用户手动执行。"
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

// ── 提交前四检（与 .githooks/pre-commit 同一套实现）──────────────────────────

export interface PreCommitCheck {
  readonly id: string
  readonly title: string
  readonly status: "pass" | "fail" | "skipped"
  readonly output: string
}

export interface PreCommitReport {
  readonly ok: boolean
  readonly checks: ReadonlyArray<PreCommitCheck>
}

/**
 * 调用 `.githooks/pre-commit-checks.mjs`。
 *
 * 用子进程跑而不是把逻辑复制进 TS：那份脚本同时服务 git hook，复制一份必然漂移。
 * 脚本缺失（未装 hook 的检出）时按「跳过」处理，不阻断提交。
 */
export const runPreCommitChecks = (
  appProcess: AppProcess.Interface,
  cwd: string,
): Effect.Effect<PreCommitReport> =>
  Effect.gen(function* () {
    const script = path.join(cwd, ".githooks", "pre-commit-checks.mjs")
    if (!existsSync(script)) {
      return {
        ok: true,
        checks: [{ id: "checks", title: "提交前检查", status: "skipped" as const, output: "未找到 .githooks/pre-commit-checks.mjs，跳过" }],
      }
    }
    const result = yield* appProcess
      .run(ChildProcess.make(process.execPath, [script], { cwd, extendEnv: true }), { timeout: "180 seconds" })
      .pipe(
        Effect.catch(() =>
          Effect.succeed({
            command: "node",
            exitCode: 127,
            stdout: Buffer.from(""),
            stderr: Buffer.from("无法启动 node"),
          }),
        ),
      )
    if (result.exitCode === 0) {
      return { ok: true, checks: [{ id: "checks", title: "提交前检查", status: "pass" as const, output: "" }] }
    }
    return {
      ok: false,
      checks: [{ id: "checks", title: "提交前检查", status: "fail" as const, output: result.stdout.toString("utf8") }],
    }
  })

/** 检查失败时回灌给模型的文案：说清哪一项没过、怎么本地自查。 */
export const preCommitFailureNotice = (report: PreCommitReport) =>
  [
    `<tool_error kind="pre_commit_failed">`,
    `提交前检查未通过，提交已被拒绝（不会产生任何 commit）。`,
    `失败详情：`,
    ...report.checks.filter((check) => check.status === "fail").map((check) => `  - ${check.title}\n${check.output}`),
    `接下来可以：按上述失败项修复后重试；或确认无误后由用户手动提交。全量类型检查可用 tsc --noEmit -p tsconfig.json 单独跑。`,
    `</tool_error>`,
  ].join("\n")

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
  run_checks: Schema.optional(Schema.Boolean).annotate({
    description:
      "提交前先跑与 git hook 相同的四检（乱码 / 品牌 / 缺陷模式 / tsc 类型门禁）。默认关闭：全量类型检查有耗时，只在改动较多时建议开启。不通过会拒绝提交并回灌失败详情。",
  }),
})

export const GitCommitTool = Tool.define(
  "git_commit",
  Effect.gen(function* () {
    const git = yield* Git.Service
    // W-2：run_checks 复用 AppProcess 跑与 git hook 相同的检查脚本
    const appProcess = yield* AppProcess.Service
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

          // W-2：让模型自己也能触发与 git hook 相同的四检。默认关闭——全量类型检查
          // 有耗时；但一旦开启就不通过不放行，否则「跑检查」只是走过场。
          if (params.run_checks === true) {
            const report = yield* runPreCommitChecks(appProcess, cwd)
            if (!report.ok) return yield* Effect.die(new Error(preCommitFailureNotice(report)))
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

// ── git_push ─────────────────────────────────────────────────────────────────

const PushParameters = Schema.Struct({
  remote: Schema.optional(Schema.String).annotate({
    description: "远端名。默认 origin。",
  }),
  branch: Schema.optional(Schema.String).annotate({
    description: "要推送的分支。默认当前分支。",
  }),
  set_upstream: Schema.optional(Schema.Boolean).annotate({
    description: "首次推送新分支时建立跟踪关系，等价于 git push -u。",
  }),
})

export const GitPushTool = Tool.define(
  "git_push",
  Effect.gen(function* () {
    const git = yield* Git.Service
    return {
      description:
        "把本地提交推送到远端。只能做普通推送：强制推送(force)会被直接拒绝，因为会覆盖远端历史、丢失他人已拉取的提交。",
      parameters: PushParameters,
      execute: (params: Schema.Schema.Type<typeof PushParameters>, _ctx: Tool.Context) =>
        gitCommand(git, "git_push", [
          "push",
          ...(params.set_upstream ? ["--set-upstream"] : []),
          ...(params.remote ? [params.remote] : []),
          ...(params.branch ? [params.branch] : []),
        ]).pipe(
          Effect.map(({ out }) => ({
            title: "已推送",
            output: out || "推送完成。",
            metadata: { vcs: "git" as const, ...(params.branch ? { branch: params.branch } : {}) },
          })),
          Effect.orDie,
        ),
    }
  }),
)

// ── gh_*（依赖 GitHub CLI；未安装时给出可行动提示而非 defect）──────────────

/**
 * 跑一条 `gh` 子命令。Git.Service 只会执行字面量 `git`，而 gh 是独立可执行文件，
 * 故这里走通用的 AppProcess.Service。
 *
 * 「命令不存在」是预期内的情况（用户可能没装 gh），必须翻译成提示而不是 defect：
 * 让模型能告诉用户「装 gh」并改走其它路径。
 */
export const runGh = (
  process: AppProcess.Interface,
  cwd: string,
  args: string[],
): Effect.Effect<
  { readonly code: number; readonly out: string; readonly err: string; readonly missing: boolean },
  never
> =>
  process
    .run(ChildProcess.make("gh", args, { cwd, extendEnv: true }), { timeout: "30 seconds" })
    .pipe(
      Effect.map((result) => ({
        code: result.exitCode,
        out: result.stdout.toString("utf8").trim(),
        err: result.stderr.toString("utf8").trim(),
        // 没有输出且非零退出，基本可判定为「可执行文件不存在」
        missing: result.exitCode !== 0 && !result.stdout.length && !result.stderr.length,
      })),
      Effect.catch(() => Effect.succeed({ code: 127, out: "", err: "未找到 gh 可执行文件", missing: true })),
    )

/** gh 不可用时的统一文案，避免每个工具各写一份。 */
export const ghMissingNotice = (tool: string) =>
  [
    `<tool_error kind="gh_not_installed" tool="${tool}">`,
    `未检测到 GitHub CLI（gh），无法执行该操作。`,
    `接下来可以：请用户安装 gh 后重试，或改用其它方式（如用 git 命令行 + 浏览器手动创建）。`,
    `</tool_error>`,
  ].join("\n")

const PrParameters = Schema.Struct({
  title: Schema.String.annotate({ description: "PR 标题（必填）。" }),
  body: Schema.optional(Schema.String).annotate({ description: "PR 正文（Markdown）。" }),
  base: Schema.optional(Schema.String).annotate({ description: "目标分支。默认由 gh 推断。" }),
  head: Schema.optional(Schema.String).annotate({ description: "来源分支。" }),
  draft: Schema.optional(Schema.Boolean).annotate({ description: "以草稿形式创建。" }),
})

export const GhPrCreateTool = Tool.define(
  "gh_pr_create",
  Effect.gen(function* () {
    const process = yield* AppProcess.Service
    return {
      description: "用 GitHub CLI 为当前分支创建 Pull Request。需要 gh 已安装并已登录（gh auth login）。",
      parameters: PrParameters,
      execute: (params: Schema.Schema.Type<typeof PrParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const result = yield* runGh(process, ctx.project.worktree, [
            "pr",
            "create",
            "--title",
            params.title,
            ...(params.body ? ["--body", params.body] : []),
            ...(params.base ? ["--base", params.base] : []),
            ...(params.head ? ["--head", params.head] : []),
            ...(params.draft ? ["--draft"] : []),
          ])
          if (result.missing) return yield* Effect.die(new Error(ghMissingNotice("gh_pr_create")))
          if (result.code !== 0) return yield* failWith("gh_pr_create", result.code, result.out, result.err)
          return {
            title: "已创建 Pull Request",
            output: result.out || "PR 已创建。",
            metadata: { vcs: "git" as const },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

const CiStatusParameters = Schema.Struct({
  limit: Schema.optional(Schema.Number).annotate({ description: "查看最近多少次运行。默认 5。" }),
})

export const CiStatusTool = Tool.define(
  "ci_status",
  Effect.gen(function* () {
    const process = yield* AppProcess.Service
    return {
      description:
        "查看当前仓库最近若干次 GitHub Actions 运行结论与失败用例。需要 gh 已安装并已登录。用于「CI 红 → 定位 → 修」闭环。",
      parameters: CiStatusParameters,
      execute: (params: Schema.Schema.Type<typeof CiStatusParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ctx = yield* InstanceState.context
          const result = yield* runGh(process, ctx.project.worktree, [
            "run",
            "list",
            "--limit",
            String(Math.max(1, Math.trunc(params.limit ?? 5))),
            "--json",
            "conclusion,status,name,displayTitle,url",
          ])
          if (result.missing) return yield* Effect.die(new Error(ghMissingNotice("ci_status")))
          if (result.code !== 0) return yield* failWith("ci_status", result.code, result.out, result.err)
          return {
            title: "CI 运行状态",
            output: result.out || "(最近没有 CI 运行记录)",
            metadata: { vcs: "git" as const },
          }
        }).pipe(Effect.orDie),
    }
  }),
)

// ── file_rollback ────────────────────────────────────────────────────────────

const FileRollbackParameters = Schema.Struct({
  path: Schema.String.annotate({ description: "要回滚的文件路径（相对工作区或绝对路径）。" }),
})

export const FileRollbackTool = Tool.define(
  "file_rollback",
  Effect.gen(function* () {
    return {
      description:
        "把某个文件回滚到最近一次写前备份。写工具会在改动前自动存备份，用它可以单文件撤销误改。",
      parameters: FileRollbackParameters,
      execute: (params: Schema.Schema.Type<typeof FileRollbackParameters>, _ctx: Tool.Context) =>
        Effect.gen(function* () {
          const ok = yield* rollbackFile(params.path)
          if (!ok) {
            return yield* Effect.die(
              new Error(`file_rollback 失败：${params.path} 没有可用备份，或回滚过程出错。文件未被修改。`),
            )
          }
          return {
            title: "已回滚文件",
            output: `${params.path} 已回滚到最近一次写前备份。`,
            metadata: { vcs: "git" as const },
          }
        }).pipe(Effect.orDie),
    }
  }),
)