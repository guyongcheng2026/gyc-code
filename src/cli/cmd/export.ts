import { Session } from "@/session/session"
import { SessionV1 } from "@gyccode/core/v1/session"
import { SessionID } from "@/session/schema"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { EOL } from "os"
import { Effect } from "effect"
import { Database } from "@gyccode/core/database/database"
import * as TaskProjector from "@gyccode/core/session/task-projector"
import type { SessionSchema } from "@gyccode/core/session/schema"
import { CostLedgerTable } from "@gyccode/core/session/sql"
import { promptCacheStats } from "@gyccode/core/session/cache-rate"
import { eq } from "drizzle-orm"

function redact(kind: string, id: string, value: string) {
  return value.trim() ? `[redacted:${kind}:${id}]` : value
}

function data(kind: string, id: string, value: Record<string, unknown> | undefined) {
  if (!value) return value
  return Object.keys(value).length ? { redacted: `${kind}:${id}` } : value
}

function span(id: string, value: { value: string; start: number; end: number }) {
  return {
    ...value,
    value: redact("file-text", id, value.value),
  }
}

function diff(kind: string, diffs: { file?: string; patch?: string }[] | undefined) {
  return diffs?.map((item, i) => ({
    ...item,
    file: item.file === undefined ? undefined : redact(`${kind}-file`, String(i), item.file),
    patch: item.patch === undefined ? undefined : redact(`${kind}-patch`, String(i), item.patch),
  }))
}

function source(part: SessionV1.FilePart) {
  if (!part.source) return part.source
  if (part.source.type === "symbol") {
    return {
      ...part.source,
      path: redact("file-path", part.id, part.source.path),
      name: redact("file-symbol", part.id, part.source.name),
      text: span(part.id, part.source.text),
    }
  }
  if (part.source.type === "resource") {
    return {
      ...part.source,
      clientName: redact("file-client", part.id, part.source.clientName),
      uri: redact("file-uri", part.id, part.source.uri),
      text: span(part.id, part.source.text),
    }
  }
  return {
    ...part.source,
    path: redact("file-path", part.id, part.source.path),
    text: span(part.id, part.source.text),
  }
}

function filepart(part: SessionV1.FilePart): SessionV1.FilePart {
  return {
    ...part,
    url: redact("file-url", part.id, part.url),
    filename: part.filename === undefined ? undefined : redact("file-name", part.id, part.filename),
    source: source(part),
  }
}

function part(part: SessionV1.Part): SessionV1.Part {
  switch (part.type) {
    case "text":
      return {
        ...part,
        text: redact("text", part.id, part.text),
        metadata: data("text-metadata", part.id, part.metadata),
      }
    case "reasoning":
      return {
        ...part,
        text: redact("reasoning", part.id, part.text),
        metadata: data("reasoning-metadata", part.id, part.metadata),
      }
    case "file":
      return filepart(part)
    case "subtask":
      return {
        ...part,
        prompt: redact("subtask-prompt", part.id, part.prompt),
        description: redact("subtask-description", part.id, part.description),
        command: part.command === undefined ? undefined : redact("subtask-command", part.id, part.command),
      }
    case "tool":
      return {
        ...part,
        metadata: data("tool-metadata", part.id, part.metadata),
        state:
          part.state.status === "pending"
            ? {
                ...part.state,
                input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                raw: redact("tool-raw", part.id, part.state.raw),
              }
            : part.state.status === "running"
              ? {
                  ...part.state,
                  input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                  title: part.state.title === undefined ? undefined : redact("tool-title", part.id, part.state.title),
                  metadata: data("tool-state-metadata", part.id, part.state.metadata),
                }
              : part.state.status === "completed"
                ? {
                    ...part.state,
                    input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                    output: redact("tool-output", part.id, part.state.output),
                    title: redact("tool-title", part.id, part.state.title),
                    metadata: data("tool-state-metadata", part.id, part.state.metadata) ?? part.state.metadata,
                    attachments: part.state.attachments?.map(filepart),
                  }
                : {
                    ...part.state,
                    input: data("tool-input", part.id, part.state.input) ?? part.state.input,
                    metadata: data("tool-state-metadata", part.id, part.state.metadata),
                  },
      }
    case "patch":
      return {
        ...part,
        hash: redact("patch", part.id, part.hash),
        files: part.files.map((item: string, i: number) => redact("patch-file", `${part.id}-${i}`, item)),
      }
    case "snapshot":
      return {
        ...part,
        snapshot: redact("snapshot", part.id, part.snapshot),
      }
    case "step-start":
      return {
        ...part,
        snapshot: part.snapshot === undefined ? undefined : redact("snapshot", part.id, part.snapshot),
      }
    case "step-finish":
      return {
        ...part,
        snapshot: part.snapshot === undefined ? undefined : redact("snapshot", part.id, part.snapshot),
      }
    case "agent":
      return {
        ...part,
        source: !part.source
          ? part.source
          : {
              ...part.source,
              value: redact("agent-source", part.id, part.source.value),
            },
      }
    default:
      return part
  }
}

const partFn = part

function sanitize(data: { info: Session.Info; messages: SessionV1.WithParts[] }) {
  return {
    info: {
      ...data.info,
      title: redact("session-title", data.info.id, data.info.title),
      directory: redact("session-directory", data.info.id, data.info.directory),
      summary: !data.info.summary
        ? data.info.summary
        : {
            ...data.info.summary,
            diffs: diff("session-diff", data.info.summary.diffs),
          },
      revert: !data.info.revert
        ? data.info.revert
        : {
            ...data.info.revert,
            snapshot:
              data.info.revert.snapshot === undefined
                ? undefined
                : redact("revert-snapshot", data.info.id, data.info.revert.snapshot),
            diff:
              data.info.revert.diff === undefined
                ? undefined
                : redact("revert-diff", data.info.id, data.info.revert.diff),
          },
    },
    messages: data.messages.map((msg) => ({
      info:
        msg.info.role === "user"
          ? {
              ...msg.info,
              system: msg.info.system === undefined ? undefined : redact("system", msg.info.id, msg.info.system),
              summary: !msg.info.summary
                ? msg.info.summary
                : {
                    ...msg.info.summary,
                    title:
                      msg.info.summary.title === undefined
                        ? undefined
                        : redact("summary-title", msg.info.id, msg.info.summary.title),
                    body:
                      msg.info.summary.body === undefined
                        ? undefined
                        : redact("summary-body", msg.info.id, msg.info.summary.body),
                    diffs: diff("message-diff", msg.info.summary.diffs),
                  },
            }
          : {
              ...msg.info,
              path: {
                cwd: redact("cwd", msg.info.id, msg.info.path.cwd),
                root: redact("root", msg.info.id, msg.info.path.root),
              },
            },
      parts: msg.parts.map(partFn),
    })),
  }
}

/**
 * C-09：导出成本账。会话 JSON 里虽有消息级 cost，但要回答「一个 feature 花了
 * 多少、成了吗」需要这些聚合维度，缺一不可：
 *
 * - **task**：一个用户轮次一个 task，跨会话，附成败标记（C-01 / C-05）
 * - **ledger**：append-only 成本流水，含压缩开销单列，可自行复算（C-05 / C-08）
 * - **cacheHitRate**：与 `gyc db cache` / `gyc stats` 同一口径（C-07）
 * - **totals**：含压缩成本单列与两套口径对账（C-06 / C-08）
 */
function costLedger(sessionID: SessionID) {
  return Effect.gen(function* () {
    const { db } = yield* Database.Service
    const svc = yield* Session.Service
    const session = yield* svc.get(sessionID)
    const messages = yield* svc.messages({ sessionID })
    const tasks = yield* TaskProjector.listTasks(db, sessionID as SessionSchema.ID)

    let compactionCost = 0
    let messageCost = 0
    const perMessage = messages.map((message) => {
      const info = (message as { info?: { role?: string; cost?: number } }).info
      const cost = info?.cost ?? 0
      if (info?.role === "assistant") {
        messageCost += cost
        if ((info as { mode?: string }).mode === "compaction") compactionCost += cost
      }
      return { role: info?.role, cost, mode: (info as { mode?: string }).mode }
    })

    // C-05：导出 append-only 流水本身，这样离线复算不必依赖投影表的聚合值。
    // 压缩那笔带 event_type，可与 compactionCost 交叉验证。
    const ledger = yield* db
      .select({
        id: CostLedgerTable.id,
        eventType: CostLedgerTable.event_type,
        cost: CostLedgerTable.cost_usd,
        tokensInput: CostLedgerTable.tokens_input,
        tokensOutput: CostLedgerTable.tokens_output,
        tokensCacheRead: CostLedgerTable.tokens_cache_read,
        tokensCacheWrite: CostLedgerTable.tokens_cache_write,
        costSource: CostLedgerTable.cost_source,
        timeCreated: CostLedgerTable.time_created,
      })
      .from(CostLedgerTable)
      .where(eq(CostLedgerTable.session_id, sessionID as SessionSchema.ID))
      .all()
      .pipe(Effect.orDie)

    // C-07：与 CLI 其余入口共用同一份命中率实现，导出的数字与 `gyc db cache` 一致。
    const cache = promptCacheStats(
      messages
        .filter((m) => (m as { info?: { role?: string } }).info?.role === "assistant")
        .map((m) => {
          const info = (m as {
            info?: { tokens?: { input?: number; cache?: { read?: number; write?: number } } }
          }).info
          return {
            data: JSON.stringify({
              sessionID,
              tokens: {
                input: info?.tokens?.input ?? 0,
                cache: { read: info?.tokens?.cache?.read ?? 0, write: info?.tokens?.cache?.write ?? 0 },
              },
            }),
            time_created: (m as { info?: { time?: { created?: number } } }).info?.time?.created ?? 0,
            session_id: sessionID,
          }
        }),
    )

    return {
      generatedAt: new Date().toISOString(),
      session: {
        id: session.id,
        title: session.title,
        projectID: session.projectID,
        cost: session.cost ?? 0,
      },
      totals: {
        // 会话口径（投影侧权威值）与逐轮口径应当一致，对不上说明计价路径分叉
        fromSessions: session.cost ?? 0,
        fromMessages: messageCost,
        drift: (session.cost ?? 0) - messageCost,
        compactionCost,
        // C-05：流水合计应等于会话总额；不等说明投影漏记或重复计入
        fromLedger: ledger.reduce((sum, row) => sum + row.cost, 0),
      },
      // C-07：prefix/steady 与 `gyc db cache`、`gyc stats` 同一把尺子；
      // pairs 为样本数，0 表示样本不足，此时两个 rate 无意义。
      cacheHitRate: {
        prefix: cache.prefixBase > 0 ? cache.prefixHit / cache.prefixBase : 0,
        steady: cache.steadyBase > 0 ? cache.steadyHit / cache.steadyBase : 0,
        pairs: messages.length,
      },
      tasks: tasks.map((task) => ({
        id: task.id,
        title: task.title,
        status: task.status,
        error: task.error,
        cost: task.cost,
        tokens: {
          input: task.tokens_input,
          output: task.tokens_output,
          cacheRead: task.tokens_cache_read,
          cacheWrite: task.tokens_cache_write,
        },
        timeCreated: task.time_created,
        timeCompleted: task.time_completed,
      })),
      ledger,
      messages: perMessage,
    }
  })
}

export const ExportCommand = effectCmd({
  command: "export [sessionID]",
  describe: "以 JSON 格式导出会话数据",
  builder: (yargs) =>
    yargs
      .positional("sessionID", {
        describe: "要导出的会话 ID",
        type: "string",
      })
      .option("sanitize", {
        describe: "对敏感的对话记录和文件数据做脱敏处理",
        type: "boolean",
      })
      .option("cost", {
        describe: "导出成本账（含 task 维度、压缩成本、缓存命中率），而非会话 JSON",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.export")(function* (args) {
    return yield* run(args)
  }),
})

const run = Effect.fn("Cli.export.body")(function* (args: {
  sessionID?: string
  sanitize?: boolean
  cost?: boolean
}) {
  const svc = yield* Session.Service
  let sessionID = args.sessionID ? SessionID.make(args.sessionID) : undefined
  process.stderr.write(`正在导出会话：${sessionID ?? "latest"}\n`)

  if (!sessionID) {
    UI.empty()
    prompts.intro("导出会话", { output: process.stderr })

    const sessions = yield* svc.list()

    if (sessions.length === 0) {
      prompts.log.error("未找到会话", { output: process.stderr })
      prompts.outro("完成", { output: process.stderr })
      return
    }

    sessions.sort((a, b) => b.time.updated - a.time.updated)

    const selectedSession = yield* Effect.promise(() =>
      prompts.autocomplete({
        message: "选择要导出的会话",
        maxItems: 10,
        options: sessions.map((session) => ({
          label: session.title,
          value: session.id,
          hint: `${new Date(session.time.updated).toLocaleString()} • ${session.id.slice(-8)}`,
        })),
        output: process.stderr,
      }),
    )

    if (prompts.isCancel(selectedSession)) {
      return yield* Effect.die(new UI.CancelledError())
    }

    sessionID = selectedSession

    prompts.outro("正在导出会话...", { output: process.stderr })
  }

  // Match legacy try/catch — catches both typed failures and defects
  // (Session.Service.get throws NotFoundError as a defect, not a typed E).
  return yield* Effect.gen(function* () {
    const sessionInfo = yield* svc.get(sessionID!)
    const messages = yield* svc.messages({ sessionID: sessionInfo.id })

    // C-09：默认导出的是会话数据 —— 里面虽有消息级 cost，但没有 task 维度、
    // 没有跨会话聚合、也没有缓存命中率，想回答「一个 feature 多少钱」仍得手工拼。
    // --cost 导出的是真正的成本账。
    if (args.cost) {
      process.stdout.write(JSON.stringify(yield* costLedger(sessionInfo.id), null, 2))
      process.stdout.write(EOL)
      return
    }

    const exportData = { info: sessionInfo, messages }

    process.stdout.write(JSON.stringify(args.sanitize ? sanitize(exportData) : exportData, null, 2))
    process.stdout.write(EOL)
  }).pipe(Effect.catchCause(() => fail(`未找到会话：${sessionID!}`)))
})
