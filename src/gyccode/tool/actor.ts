import * as Tool from "./tool"
import DESCRIPTION from "./actor.txt"
import { BackgroundJob } from "@/background/job"
import { TaskTool, type TaskPromptOps } from "./task"
import { Effect, Schema } from "effect"
import { SessionID } from "@/session/schema"

const id = "actor"

// actor 是 MiMo Code actor 工具的 gyc-code 适配层：对外保持 compose 技能包
// （subagent/review/parallel 等）引用的 `operation` 调用契约，对内委托给已
// 验证的 TaskTool 执行（子会话创建、深度防护、权限派生、前台/后台路径全部
// 复用）。status/wait/cancel 基于 BackgroundJob 注册表实现。
// 与 MiMo 原版的差异：send（actor 间消息）不支持；context 继承仅 none；
// model 覆盖被忽略（使用 agent 配置模型）。

const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000

// ---------- 操作 Schema（与 compose 技能包的调用契约对齐） ----------

const RunOperation = Schema.Struct({
  action: Schema.Literals(["run"]).annotate({
    description: "Spawn a subagent and block until it completes; the result is returned inline as the tool response.",
  }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task." }),
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task." }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform." }),
  model: Schema.optional(Schema.String).annotate({
    description: "(optional, ignored) Kept for call compatibility; the subagent runs on its agent-configured model.",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description:
      "(optional) If this subagent is doing work for a specific tracked task (T1, T2, ...), pass that ID here — only an ID obtained this session. Recorded as a metadata binding; malformed IDs are dropped.",
  }),
  actor_id: Schema.optional(Schema.String).annotate({
    description: "(optional) If set, resume the specified prior actor session instead of creating a new one.",
  }),
  timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "(optional) Milliseconds to wait before failing. Default 600000 (10 min).",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "(optional) The command that triggered this task." }),
  context: Schema.optional(Schema.Literals(["none", "state", "full"])).annotate({
    description: "(optional) Context inheritance. Only 'none' (the default) is supported in gyc-code.",
  }),
})

const SpawnOperation = Schema.Struct({
  action: Schema.Literals(["spawn"]).annotate({
    description:
      "Spawn a subagent and return its actor_id immediately; the result is delivered as a notification or via a separate `wait` call. Requires GYCCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true.",
  }),
  subagent_type: Schema.String.annotate({ description: "The type of specialized agent to use for this task." }),
  description: Schema.String.annotate({ description: "A short (3-5 words) description of the task." }),
  prompt: Schema.String.annotate({ description: "The task for the agent to perform." }),
  model: Schema.optional(Schema.String).annotate({
    description: "(optional, ignored) Kept for call compatibility; the subagent runs on its agent-configured model.",
  }),
  task_id: Schema.optional(Schema.String).annotate({
    description: "(optional) Tracked task ID binding; recorded as metadata only.",
  }),
  actor_id: Schema.optional(Schema.String).annotate({
    description: "(optional) If set, resume the specified prior actor session instead of creating a new one.",
  }),
  command: Schema.optional(Schema.String).annotate({ description: "(optional) The command that triggered this task." }),
  context: Schema.optional(Schema.Literals(["none", "state", "full"])).annotate({
    description: "(optional) Context inheritance. Only 'none' (the default) is supported in gyc-code.",
  }),
})

const StatusOperation = Schema.Struct({
  action: Schema.Literals(["status"]).annotate({ description: "Poll actor state without blocking." }),
  actor_id: Schema.String.annotate({ description: "Actor session id to inspect." }),
})

const WaitOperation = Schema.Struct({
  action: Schema.Literals(["wait"]).annotate({
    description: "Block until actor completes (success/failure/cancelled) or timeout (default 10 min).",
  }),
  actor_id: Schema.String.annotate({ description: "Actor session id to wait on." }),
  timeout_ms: Schema.optional(Schema.Number).annotate({
    description: "(optional) Milliseconds to wait before returning { status: 'timeout' }. Default 600000 (10 min).",
  }),
})

const CancelOperation = Schema.Struct({
  action: Schema.Literals(["cancel"]).annotate({ description: "Stop a running actor (graceful). Idempotent." }),
  actor_id: Schema.String.annotate({ description: "Actor session id to cancel." }),
})

const SendOperation = Schema.Struct({
  action: Schema.Literals(["send"]).annotate({ description: "NOT supported in gyc-code; use run/spawn instead." }),
  to_actor_id: Schema.String.annotate({ description: "(unsupported) Intended receiver actor id." }),
  content: Schema.String.annotate({ description: "(unsupported) Intended message content." }),
})

const Operation = Schema.Union([RunOperation, SpawnOperation, StatusOperation, WaitOperation, CancelOperation, SendOperation])

type OperationType = Schema.Schema.Type<typeof Operation>
type RunLike = Schema.Schema.Type<typeof RunOperation> | Schema.Schema.Type<typeof SpawnOperation>

// 支持两种入参：标准 JSON operation 对象，或 compose 技能文档示例中的
// shell 风格脚本字符串（"actor run general \"...\" \"...\" --task T3"）。
export const Parameters = Schema.Union([
  Schema.Struct({ operation: Operation }),
  Schema.Struct({ operation: Schema.String.annotate({ description: "Shell-style actor script, e.g. actor run general \"<desc>\" \"<prompt>\" --task T1" }) }),
])

type Metadata = {
  actorId?: string
  actorAction: string
  subagentType?: string
  taskBinding?: string
  resumed?: boolean
}

// ---------- shell 脚本解析（简化 tokenizer：空白分隔 + 引号分组） ----------

interface ParseOk {
  ok: true
  op: OperationType
}
interface ParseFail {
  ok: false
  error: string
}
type ParseResult = ParseOk | ParseFail

function tokenizeScript(script: string): string[][] {
  const lines: string[][] = []
  let tokens: string[] = []
  let token = ""
  let has = false
  let quote: '"' | "'" | null = null

  const flushToken = () => {
    if (has) {
      tokens.push(token)
      token = ""
      has = false
    }
  }
  const flushLine = () => {
    flushToken()
    if (tokens.length > 0) lines.push(tokens)
    tokens = []
  }

  for (let i = 0; i < script.length; i++) {
    const ch = script[i]
    if (quote) {
      // bash 双引号语义：反斜杠仅在转义引号或反斜杠本身时生效，其余保留字面。
      if (ch === "\\" && i + 1 < script.length && (script[i + 1] === quote || script[i + 1] === "\\")) {
        token += script[i + 1]
        i++
        continue
      }
      if (ch === quote) {
        quote = null
        continue
      }
      token += ch
      continue
    }
    if (ch === '"' || ch === "'") {
      quote = ch
      has = true
      continue
    }
    if (ch === "\\" && i + 1 < script.length) {
      token += script[i + 1]
      has = true
      i++
      continue
    }
    if (/\s/.test(ch)) {
      flushToken()
      continue
    }
    token += ch
    has = true
  }
  flushLine()
  return lines
}

// `--name value` / `--name=value` 提取；位置参数落到 rest。
function extractFlags(args: string[], names: string[]): { ok: true; flags: Record<string, string>; rest: string[] } | ParseFail {
  const flags: Record<string, string> = {}
  const rest: string[] = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const bare = names.find((n) => arg === `--${n}`)
    if (bare) {
      const next = args[i + 1]
      if (next === undefined) return { ok: false, error: `actor: --${bare} requires a value` }
      flags[bare] = next
      i++
      continue
    }
    const eq = names.find((n) => arg.startsWith(`--${n}=`))
    if (eq) {
      const value = arg.slice(`--${eq}=`.length)
      if (value === "") return { ok: false, error: `actor: --${eq}= requires a value` }
      flags[eq] = value
      continue
    }
    rest.push(arg)
  }
  return { ok: true, flags, rest }
}

const KNOWN_VERBS = ["run", "spawn", "status", "wait", "cancel", "send"]

function suggestVerb(input: string): string | undefined {
  const distance = (a: string, b: string): number => {
    const m = a.length
    const n = b.length
    if (m === 0) return n
    if (n === 0) return m
    const dp = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0))
    for (let i = 0; i <= m; i++) dp[i][0] = i
    for (let j = 0; j <= n; j++) dp[0][j] = j
    for (let i = 1; i <= m; i++) {
      for (let j = 1; j <= n; j++) {
        dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
      }
    }
    return dp[m][n]
  }
  const candidates = KNOWN_VERBS.map((v) => ({ v, d: distance(input, v) })).filter((c) => c.d <= 2)
  if (candidates.length !== 1) return undefined
  return candidates[0].v
}

function parseVerbLine(tokens: string[]): ParseResult {
  const [head, verb, ...args] = tokens
  if (head !== "actor") return { ok: false, error: `actor: every command must start with 'actor' (got '${head ?? ""}')` }

  if (verb === "run" || verb === "spawn") {
    const extracted = extractFlags(args, ["model", "task", "actor", "timeout", "command", "context", "output-schema"])
    if (!extracted.ok) return extracted
    const { flags, rest } = extracted
    if (rest.length !== 3) {
      return {
        ok: false,
        error: `actor: ${verb}: arity mismatch\n  got:      actor ${verb} ${rest.join(" ")}\n  expected: actor ${verb} <subagent_type> "<description>" "<prompt>" [--task <TID>] [--actor <id>]`,
      }
    }
    if (flags["output-schema"] !== undefined) {
      return { ok: false, error: "actor: --output-schema is not supported in gyc-code" }
    }
    return {
      ok: true,
      op: {
        action: verb,
        subagent_type: rest[0],
        description: rest[1],
        prompt: rest[2],
        ...(flags.model !== undefined ? { model: flags.model } : {}),
        ...(flags.task !== undefined ? { task_id: flags.task } : {}),
        ...(flags.actor !== undefined ? { actor_id: flags.actor } : {}),
        ...(verb === "run" && flags.timeout !== undefined ? { timeout_ms: Number(flags.timeout) } : {}),
        ...(flags.command !== undefined ? { command: flags.command } : {}),
        ...(flags.context !== undefined ? { context: flags.context as "none" | "state" | "full" } : {}),
      } as OperationType,
    }
  }

  if (verb === "status") {
    if (args.length !== 1) return { ok: false, error: `actor: status: expected actor status <actor_id>` }
    return { ok: true, op: { action: "status", actor_id: args[0] } }
  }

  if (verb === "wait") {
    const extracted = extractFlags(args, ["timeout"])
    if (!extracted.ok) return extracted
    const { flags, rest } = extracted
    if (rest.length !== 1) return { ok: false, error: `actor: wait: expected actor wait <actor_id> [--timeout <ms>]` }
    return {
      ok: true,
      op: {
        action: "wait",
        actor_id: rest[0],
        ...(flags.timeout !== undefined ? { timeout_ms: Number(flags.timeout) } : {}),
      },
    }
  }

  if (verb === "cancel") {
    if (args.length !== 1) return { ok: false, error: `actor: cancel: expected actor cancel <actor_id>` }
    return { ok: true, op: { action: "cancel", actor_id: args[0] } }
  }

  if (verb === "send") {
    return { ok: false, error: "actor: send is not supported in gyc-code; use run/spawn instead" }
  }

  const suggestion = suggestVerb(verb ?? "")
  return {
    ok: false,
    error:
      `actor: unknown verb "${verb ?? ""}"\n  available verbs: ${KNOWN_VERBS.join(", ")}` +
      (suggestion ? `\n  did you mean: ${suggestion}?` : ""),
  }
}

function parseActorScript(script: string): ParseResult {
  const lines = tokenizeScript(script)
  if (lines.length === 0) return { ok: false, error: "actor: empty script" }
  if (lines.length > 1) return { ok: false, error: "actor: one operation per call; multiple lines are not supported" }
  return parseVerbLine(lines[0])
}

// 供测试直接验证 shell 脚本解析（无需完整工具环境）。
export { parseActorScript }

// ---------- 执行 ----------

function jobStatusToActorStatus(status: BackgroundJob.Status | undefined): string {
  if (status === "running") return "running"
  if (status === "completed") return "idle"
  if (status === "error" || status === "cancelled") return status
  return "unknown"
}

export const ActorTool = Tool.define(
  id,
  Effect.gen(function* () {
    const background = yield* BackgroundJob.Service
    const taskInfo = yield* TaskTool
    const taskDef = yield* Tool.init(taskInfo)

    return Effect.fn("ActorTool.init")(function* () {
      return {
        description: DESCRIPTION,
        parameters: Parameters,
        execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context) =>
          Effect.gen(function* () {
            const parsed: ParseResult =
              typeof params.operation === "string" ? parseActorScript(params.operation) : { ok: true, op: params.operation }
            if (!parsed.ok) return yield* Effect.fail(new Error(parsed.error))
            const op = parsed.op

            if (op.action === "send") {
              return yield* Effect.fail(new Error("actor: send is not supported in gyc-code; use run/spawn instead"))
            }

            if (op.action === "run" || op.action === "spawn") {
              if (op.context !== undefined && op.context !== "none") {
                return yield* Effect.fail(
                  new Error(`actor: context='${op.context}' is not supported in gyc-code; only 'none' (the default) is available`),
                )
              }
              const runLike = op as RunLike

              // 权限闸门在 actor 层统一收取；委托 TaskTool 时通过
              // bypassAgentCheck 跳过其内部的 task 权限询问（避免双重弹窗）。
              // 子代理深度防护、agent 类型校验仍由 TaskTool 内部兜底。
              yield* ctx.ask({
                permission: id,
                patterns: [runLike.subagent_type],
                always: ["*"],
                metadata: {
                  description: runLike.description,
                  subagent_type: runLike.subagent_type,
                },
              })

              const delegated: Tool.Context = { ...ctx, extra: { ...ctx.extra, bypassAgentCheck: true } }
              const taskParams = {
                subagent_type: runLike.subagent_type,
                description: runLike.description,
                prompt: runLike.prompt,
                background: op.action === "spawn",
                ...(runLike.actor_id !== undefined ? { task_id: runLike.actor_id } : {}),
                ...(runLike.command !== undefined ? { command: runLike.command } : {}),
              }

              const result =
                op.action === "spawn"
                  ? yield* taskDef.execute(taskParams, delegated)
                  : yield* taskDef.execute(taskParams, delegated).pipe(
                      Effect.timeout(op.timeout_ms ?? DEFAULT_TIMEOUT_MS),
                      Effect.catch(() =>
                        Effect.fail(
                          new Error(
                            `actor: run timed out after ${op.timeout_ms ?? DEFAULT_TIMEOUT_MS}ms (subagent session preserved; cancel or re-dispatch as needed)`,
                          ),
                        ),
                      ),
                    )

              const meta = result.metadata as { jobId?: string; sessionId?: string }
              const actorId = typeof meta.jobId === "string" ? meta.jobId : undefined
              const resolvedActorId = actorId ?? meta.sessionId
              const metadata: Metadata = {
                actorId: resolvedActorId,
                actorAction: op.action,
                subagentType: runLike.subagent_type,
                ...(runLike.task_id !== undefined ? { taskBinding: runLike.task_id } : {}),
                ...(runLike.actor_id !== undefined ? { resumed: true } : {}),
                ...(runLike.model !== undefined ? { modelIgnored: true } : {}),
              }

              if (op.action === "spawn") {
                const output = [
                  `<actor_spawned id="${resolvedActorId ?? ""}" state="running">`,
                  result.output,
                  "</actor_spawned>",
                ].join("\n")
                return { title: result.title, metadata, output }
              }

              const modelNote = runLike.model !== undefined ? "\n(note: per-call model override is ignored; the agent-configured model was used)" : ""
              return { title: result.title, metadata, output: result.output + modelNote }
            }

            if (op.action === "status") {
              const info = yield* background.get(op.actor_id)
              if (!info) {
                const metadata: Metadata = { actorAction: "status" }
                return {
                  title: `actor status ${op.actor_id}`,
                  metadata,
                  output: JSON.stringify({ status: "unknown", actor_id: op.actor_id }),
                }
              }
              const metadata: Metadata = { actorId: op.actor_id, actorAction: "status" }
              return {
                title: info.title ?? `actor status ${op.actor_id}`,
                metadata,
                output: JSON.stringify({
                  status: jobStatusToActorStatus(info.status),
                  actor_id: op.actor_id,
                  state: info.status,
                  title: info.title,
                  started_at: info.started_at,
                  completed_at: info.completed_at,
                }),
              }
            }

            if (op.action === "wait") {
              const waited = yield* background.wait({ id: op.actor_id, timeout: op.timeout_ms ?? DEFAULT_TIMEOUT_MS })
              const metadata: Metadata = { actorId: op.actor_id, actorAction: "wait" }
              if (waited.timedOut || !waited.info) {
                return {
                  title: `actor wait ${op.actor_id}`,
                  metadata,
                  output: JSON.stringify({ status: waited.timedOut ? "timeout" : "unknown", actor_id: op.actor_id }),
                }
              }
              const info = waited.info
              const status =
                info.status === "completed"
                  ? "success"
                  : info.status === "error"
                    ? "failure"
                    : info.status === "cancelled"
                      ? "cancelled"
                      : "running"
              return {
                title: info.title ?? `actor wait ${op.actor_id}`,
                metadata,
                output: JSON.stringify({
                  status,
                  actor_id: op.actor_id,
                  ...(info.output !== undefined ? { result: info.output } : {}),
                  ...(info.error !== undefined ? { error: info.error } : {}),
                }),
              }
            }

            // op.action === "cancel"
            const ops = ctx.extra?.promptOps as TaskPromptOps | undefined
            if (ops) yield* ops.cancel(op.actor_id as SessionID).pipe(Effect.catch(() => Effect.void))
            yield* background.cancel(op.actor_id as SessionID)
            const metadata: Metadata = { actorId: op.actor_id, actorAction: "cancel" }
            return {
              title: `actor cancel ${op.actor_id}`,
              metadata,
              output: JSON.stringify({ status: "cancelled", actor_id: op.actor_id }),
            }
          }).pipe(Effect.orDie),
      }
    })
  }),
)
