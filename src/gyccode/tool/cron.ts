import { Effect, Schema, Layer, Context } from "effect"
import * as path from "path"
import * as Tool from "./tool"
import DESCRIPTION from "./cron.txt"
import { Global } from "@gyccode/core/global"
import { FSUtil } from "@gyccode/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { LayerNode } from "@gyccode/core/effect/layer-node"

// ─── Cron 表达式解析 ──────────────────────────────────────────

const MONTH_NAMES = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"]
const DAY_NAMES = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"]

interface CronField {
  values: number[] // 该字段允许的所有值
}

/** 解析单个 cron 字段（支持 *, 数字, 逗号, 范围, 步进） */
function parseField(expr: string, min: number, max: number, names?: string[]): CronField {
  if (!expr) throw new Error(`Empty cron field`)

  const result = new Set<number>()

  for (const part of expr.split(",")) {
    if (part === "*") {
      for (let i = min; i <= max; i++) result.add(i)
      continue
    }

    // 步进：*/N 或 A-B/N 或 A/N
    const stepMatch = part.match(/^(.+?)\/(\d+)$/)
    const step = stepMatch ? parseInt(stepMatch[2], 10) : 1
    const rangePart = stepMatch ? stepMatch[1] : part

    if (rangePart === "*") {
      for (let i = min; i <= max; i += step) result.add(i)
      continue
    }

    // 范围：A-B
    const rangeMatch = rangePart.match(/^(\w+)-(\w+)$/)
    if (rangeMatch) {
      const start = parseValue(rangeMatch[1], min, max, names)
      const end = parseValue(rangeMatch[2], min, max, names)
      for (let i = start; i <= end; i += step) result.add(i)
      continue
    }

    // 单值
    const val = parseValue(rangePart, min, max, names)
    if (step > 1) {
      for (let i = val; i <= max; i += step) result.add(i)
    } else {
      result.add(val)
    }
  }

  return { values: Array.from(result).sort((a, b) => a - b) }
}

function parseValue(s: string, min: number, max: number, names?: string[]): number {
  const lower = s.toLowerCase()
  if (names) {
    const idx = names.indexOf(lower)
    if (idx !== -1) return idx + (min === 0 ? 0 : 1)
  }
  const n = parseInt(s, 10)
  if (isNaN(n) || n < min || n > max) {
    throw new Error(`Invalid cron value "${s}" (range ${min}-${max})`)
  }
  return n
}

export interface CronExpression {
  minute: CronField
  hour: CronField
  dayOfMonth: CronField
  month: CronField
  dayOfWeek: CronField
}

/** 解析 5 字段 cron 表达式 */
export function parseCronExpression(expr: string): CronExpression {
  const parts = expr.trim().split(/\s+/)
  if (parts.length !== 5) {
    throw new Error(`Invalid cron expression "${expr}". Expected 5 fields: M H DoM Mon DoW.`)
  }
  return {
    minute: parseField(parts[0], 0, 59),
    hour: parseField(parts[1], 0, 23),
    dayOfMonth: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12, MONTH_NAMES),
    dayOfWeek: parseField(parts[4], 0, 7, DAY_NAMES), // 0 和 7 都是周日
  }
}

/** 计算 cron 表达式的下一次触发时间（毫秒时间戳），找不到则返回 null */
export function nextCronRunMs(expr: CronExpression, fromMs: number): number | null {
  const from = new Date(fromMs)
  // 从下一分钟开始检查
  const start = new Date(from.getFullYear(), from.getMonth(), from.getDate(), from.getHours(), from.getMinutes() + 1, 0, 0)

  // 最多检查一年（365 天）
  const maxIter = 365 * 24 * 60 // 365 天的分钟数
  for (let i = 0; i < maxIter; i++) {
    const candidate = new Date(start.getTime() + i * 60_000)
    if (matchesCron(expr, candidate)) {
      return candidate.getTime()
    }
  }
  return null
}

function matchesCron(expr: CronExpression, date: Date): boolean {
  const min = date.getMinutes()
  const hour = date.getHours()
  const dom = date.getDate()
  const month = date.getMonth() + 1 // JS 月份 0-11
  let dow = date.getDay() // JS 周日=0
  // cron 中 7 也表示周日
  if (dow === 0) dow = 7 // 统一为 1-7（周一=1...周日=7）

  const matchMin = expr.minute.values.includes(min)
  const matchHour = expr.hour.values.includes(hour)
  const matchMonth = expr.month.values.includes(month)
  const domRestricted = expr.dayOfMonth.values.length !== 31
  const dowRestricted = expr.dayOfWeek.values.length !== 8
  const matchDom = expr.dayOfMonth.values.includes(dom)
  // cron 中 7 也表示周日
  const matchDow = expr.dayOfWeek.values.includes(dow) || expr.dayOfWeek.values.includes(0)
  // 标准 cron 语义：dayOfMonth 与 dayOfWeek 都被限定时取 OR（任一满足），
  // 只有一个被限定时取该字段，都为 * 时恒真
  const dayMatch =
    domRestricted && dowRestricted
      ? matchDom || matchDow
      : domRestricted
        ? matchDom
        : dowRestricted
          ? matchDow
          : true

  return matchMin && matchHour && matchMonth && dayMatch
}

/** 将 cron 表达式转为人类可读描述 */
export function cronToHuman(expr: CronExpression): string {
  const fmtField = (f: CronField, min: number, max: number): string => {
    if (f.values.length === 0) return ""
    // 只有显式覆盖整个合法区间（min..max）才显示 "*"，
    // 单值（如 minute=30）不能因 all=len 误判为满区间
    const isFull = f.values.length === max - min + 1 && f.values[0] === min && f.values[f.values.length - 1] === max
    if (isFull) return "*"
    return f.values.join(",")
  }
  return `${fmtField(expr.minute, 0, 59)} ${fmtField(expr.hour, 0, 23)} ${fmtField(expr.dayOfMonth, 1, 31)} ${fmtField(expr.month, 1, 12)} ${fmtField(expr.dayOfWeek, 0, 7)}`
}

// ─── Cron 任务存储 ────────────────────────────────────────────

export interface CronTask {
  id: string
  cron: string
  prompt: string
  recurring: boolean
  durable: boolean
  nextRun: number // 下次触发的时间戳（ms）
  createdAt: number
  /** 触发时把 prompt 投递到哪个会话 */
  sessionID: string
}

const CRON_FILE = path.join(Global.Path.data, "scheduled_tasks.json")
const MAX_JOBS = 50
const DEFAULT_MAX_AGE_DAYS = 30

// 会话内任务存储（非持久化）
const sessionTasks = new Map<string, CronTask>()

// ─── Cron 调度服务 ────────────────────────────────────────────

export interface CronSchedulerInterface {
  readonly add: (input: {
    cron: string
    prompt: string
    recurring: boolean
    durable: boolean
    sessionID: string
  }) => Effect.Effect<CronTask>
  readonly list: () => Effect.Effect<CronTask[]>
  readonly remove: (id: string) => Effect.Effect<void>
  /**
   * 任务触发后调用：one-shot 删除；recurring 把 nextRun 推进到下一次匹配。
   * 由调度方（session prompt 层的触发循环）在成功投递 prompt 后调用。
   */
  readonly markFired: (id: string) => Effect.Effect<void>
}

export class CronSchedulerService extends Context.Service<CronSchedulerService>()("@gyccode/CronScheduler") {}

const layer = Layer.effect(
  CronSchedulerService,
  Effect.gen(function* () {
    const fs = yield* FSUtil.Service

    const readDurable = Effect.fn("CronScheduler.readDurable")(function* () {
      return yield* fs.readJson(CRON_FILE).pipe(
        Effect.map((data) =>
          Array.isArray(data)
            ? (data as CronTask[]).filter((t) => typeof t.sessionID === "string" && t.sessionID !== "")
            : [],
        ),
        Effect.catch(() => Effect.succeed([] as CronTask[])),
      )
    })

    const writeDurable = Effect.fn("CronScheduler.writeDurable")(function* (tasks: CronTask[]) {
      yield* fs.writeJson(CRON_FILE, tasks).pipe(Effect.orDie)
    })

    const add = Effect.fn("CronScheduler.add")(function* (input: {
      cron: string
      prompt: string
      recurring: boolean
      durable: boolean
      sessionID: string
    }): Effect.Effect<CronTask> {
      const expr = parseCronExpression(input.cron)
      const nextRun = nextCronRunMs(expr, Date.now())
      if (nextRun === null) {
        throw new Error(`Cron expression "${input.cron}" does not match any calendar date in the next year.`)
      }

      // 检查任务数量限制
      const sessionList = Array.from(sessionTasks.values())
      const durableList = input.durable ? yield* readDurable() : []
      if (sessionList.length + durableList.length >= MAX_JOBS) {
        throw new Error(`Too many scheduled jobs (max ${MAX_JOBS}). Cancel one first.`)
      }

      const id = `cron-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      const task: CronTask = {
        id,
        cron: input.cron,
        prompt: input.prompt,
        recurring: input.recurring,
        durable: input.durable,
        nextRun,
        createdAt: Date.now(),
        sessionID: input.sessionID,
      }

      if (input.durable) {
        yield* writeDurable([...durableList, task])
      } else {
        sessionTasks.set(id, task)
      }

      return task
    })

    const list = Effect.fn("CronScheduler.list")(function* (): Effect.Effect<CronTask[]> {
      const durable = yield* readDurable()
      // 过滤过期任务（超过 DEFAULT_MAX_AGE_DAYS 天）
      const maxAge = DEFAULT_MAX_AGE_DAYS * 24 * 60 * 60 * 1000
      const now = Date.now()
      const valid = durable.filter((t) => now - t.createdAt < maxAge)
      if (valid.length !== durable.length) {
        yield* writeDurable(valid)
      }
      return [...valid, ...Array.from(sessionTasks.values())]
    })

    const remove = Effect.fn("CronScheduler.remove")(function* (id: string): Effect.Effect<void> {
      if (sessionTasks.delete(id)) return
      const durable = yield* readDurable()
      const filtered = durable.filter((t) => t.id !== id)
      if (filtered.length !== durable.length) {
        yield* writeDurable(filtered)
      }
    })

    const markFired = Effect.fn("CronScheduler.markFired")(function* (id: string): Effect.Effect<void> {
      const session = sessionTasks.get(id)
      if (session) {
        const next = session.recurring ? nextCronRunMs(parseCronExpression(session.cron), Date.now()) : null
        if (next === null) {
          sessionTasks.delete(id)
          return
        }
        sessionTasks.set(id, { ...session, nextRun: next })
        return
      }
      const durable = yield* readDurable()
      const task = durable.find((t) => t.id === id)
      if (!task) return
      const next = task.recurring ? nextCronRunMs(parseCronExpression(task.cron), Date.now()) : null
      if (next === null) {
        yield* writeDurable(durable.filter((t) => t.id !== id))
        return
      }
      yield* writeDurable(durable.map((t) => (t.id === id ? { ...t, nextRun: next } : t)))
    })

    return CronSchedulerService.of({ add, list, remove, markFired })
  }),
)

export const CronScheduler = {
  Service: CronSchedulerService,
  node: LayerNode.make({ service: CronSchedulerService, layer, deps: [FSUtil.node] }),
}

// ─── ScheduleCronTool 工具定义 ───────────────────────────────

// 注意：effect v4 中 Schema.Union 的可变参数形式 Schema.Union(A, B) 有运行时 bug
// （members.map is not a function），必须使用数组形式（与 config/keybind.ts 惯例一致）。
// 宽松的 boolean/string 解析由 execute 中的 parseBoolean 兜底。
const SemanticBoolean = Schema.Union([Schema.Boolean, Schema.String])

export const Parameters = Schema.Struct({
  cron: Schema.String.annotate({
    description:
      'Standard 5-field cron expression in local time: "M H DoM Mon DoW" (e.g. "*/5 * * * *" = every 5 minutes, "30 14 28 2 *" = Feb 28 at 2:30pm local once).',
  }),
  prompt: Schema.String.annotate({ description: "The prompt to enqueue at each fire time." }),
  recurring: Schema.optional(SemanticBoolean).annotate({
    description: `true (default) = fire on every cron match until deleted or auto-expired after ${DEFAULT_MAX_AGE_DAYS} days. false = fire once at the next match, then auto-delete.`,
  }),
  durable: Schema.optional(SemanticBoolean).annotate({
    description:
      "true = persist to scheduled_tasks.json and survive restarts. false (default) = in-memory only, dies when this session ends. Use true only when the user asks the task to survive across sessions.",
  }),
})

function parseBoolean(v: unknown): boolean {
  if (typeof v === "boolean") return v
  if (typeof v === "string") return v === "true" || v === "1" || v === "yes"
  return false
}

export const ScheduleCronTool = Tool.define(
  "schedule_cron",
  Effect.gen(function* () {
    const scheduler = yield* CronSchedulerService

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const recurring = parseBoolean(params.recurring ?? true)
          const durable = parseBoolean(params.durable ?? false)

          // 验证 cron 表达式
          parseCronExpression(params.cron)

          const task = yield* scheduler.add({
            cron: params.cron,
            prompt: params.prompt,
            recurring,
            durable,
            sessionID: ctx.sessionID,
          })

          const where = durable
            ? "Persisted to scheduled_tasks.json"
            : "Session-only (not written to disk, dies when session ends)"

          const output = recurring
            ? `Scheduled recurring job ${task.id} (${cronToHuman(parseCronExpression(params.cron))}). ${where}. Auto-expires after ${DEFAULT_MAX_AGE_DAYS} days. Use cron_delete to cancel sooner.`
            : `Scheduled one-shot task ${task.id} (${cronToHuman(parseCronExpression(params.cron))}). ${where}. It will fire once then auto-delete.`

          return {
            title: `Scheduled ${recurring ? "recurring" : "one-shot"} task`,
            metadata: {
              id: task.id,
              cron: task.cron,
              recurring: task.recurring,
              durable: task.durable,
              nextRun: task.nextRun,
            },
            output,
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)

// ─── CronDeleteTool ───────────────────────────────────────────

const DeleteParameters = Schema.Struct({
  id: Schema.String.annotate({ description: "The ID of the cron task to delete" }),
})

export const CronDeleteTool = Tool.define(
  "cron_delete",
  Effect.gen(function* () {
    const scheduler = yield* CronSchedulerService

    return {
      description: "Delete a scheduled cron task by its ID.",
      parameters: DeleteParameters,
      execute: (
        params: Schema.Schema.Type<typeof DeleteParameters>,
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          yield* scheduler.remove(params.id)
          return {
            title: "Deleted cron task",
            metadata: { id: params.id },
            output: `Deleted scheduled task ${params.id}.`,
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof DeleteParameters>
  }),
)

// ─── CronListTool ─────────────────────────────────────────────

const ListParameters = Schema.Struct({})

export const CronListTool = Tool.define(
  "cron_list",
  Effect.gen(function* () {
    const scheduler = yield* CronSchedulerService

    return {
      description: "List all scheduled cron tasks.",
      parameters: ListParameters,
      execute: (
        _params: Schema.Schema.Type<typeof ListParameters>,
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const tasks = yield* scheduler.list()
          if (tasks.length === 0) {
            return {
              title: "No scheduled tasks",
              metadata: { count: 0 },
              output: "No scheduled cron tasks found.",
            }
          }
          const lines = tasks.map((t) => {
            const next = new Date(t.nextRun).toLocaleString()
            const type = t.recurring ? "recurring" : "one-shot"
            const persist = t.durable ? "durable" : "session"
            return `- ${t.id} [${type}, ${persist}] cron="${t.cron}" next=${next}\n  prompt: ${t.prompt.slice(0, 80)}${t.prompt.length > 80 ? "..." : ""}`
          })
          return {
            title: `${tasks.length} scheduled task(s)`,
            metadata: { count: tasks.length, tasks },
            output: lines.join("\n"),
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof ListParameters>
  }),
)
