// 沉淀主流程：把模型输出解析成技能动作，再逐条经注入的技能存储落盘。
// 编排模块本身不碰文件系统、不读时钟：模型调用（reviewer）与存储（store）都由调用方注入。
// 容错原则：坏输出、单条拒绝、store 抛错、模型调用失败，都不许把异常抛给调用方。
import { Effect } from "effect"
import { buildReviewPrompt } from "./review-prompt"
import type { ApplyResult, RejectReason, SkillStore } from "./skill-store"

export interface ReviewAction {
  readonly action: "create" | "patch" | "write_file"
  readonly name: string
  readonly description?: string
  readonly body?: string
  readonly file_path?: string
  readonly content?: string
}

export interface ReviewResult {
  readonly created: readonly string[]
  readonly patched: readonly string[]
  readonly wroteFiles: readonly string[]
  readonly rejected: ReadonlyArray<{ name: string; reason: string }>
}

/** 注入：把提示词变成模型输出（LLM 调用）。 */
export type Reviewer = (input: { prompt: string }) => Effect.Effect<string>

export interface RunReviewOptions {
  readonly root: string
  readonly sessionId: string
  readonly transcript: string
  readonly loadedSkills: readonly string[]
  readonly skills: readonly string[]
  readonly reviewer: Reviewer
  /** 注入的技能存储；runReview 不自己 make，只依赖接口 */
  readonly store: SkillStore
  readonly maxActions?: number
}

const DEFAULT_MAX_ACTIONS = 5
/** store 抛异常时记在 rejected 里的兜底原因，细节留给日志。 */
const STORE_ERROR_REASON = "store-error"

function emptyResult(): ReviewResult {
  return { created: [], patched: [], wroteFiles: [], rejected: [] }
}

/** 必须是非空字符串才算给了值（技能名、支持文件路径走这道关）。 */
function asFilledString(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined
}

/** 可缺省字段：只要是字符串就收下，空串也算给了值。 */
function asOptionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined
}

/** 把单个元素收敛成合法动作；任一必需字段不合格就返回 undefined，交给调用方丢弃。 */
function normalizeAction(item: unknown): ReviewAction | undefined {
  if (typeof item !== "object" || item === null) return undefined
  const record = item as Record<string, unknown>
  const name = asFilledString(record.name)
  if (name === undefined) return undefined

  if (record.action === "create") {
    const description = asOptionalString(record.description)
    const body = asOptionalString(record.body)
    if (description === undefined || body === undefined) return undefined
    return { action: "create", name, description, body }
  }

  if (record.action === "patch") {
    return {
      action: "patch",
      name,
      description: asOptionalString(record.description),
      body: asOptionalString(record.body),
    }
  }

  if (record.action === "write_file") {
    const filePath = asFilledString(record.file_path)
    const content = asOptionalString(record.content)
    if (filePath === undefined || content === undefined) return undefined
    return { action: "write_file", name, file_path: filePath, content }
  }

  return undefined
}

/**
 * 容错解析模型输出：模型可能包 ```json 代码块、前后夹解释文字、或直接吐坏 JSON。
 * 取第一个 [ 到最后一个 ] 之间的内容再 JSON.parse；失败即空数组，永不抛错。
 */
export function parseActions(raw: string): ReviewAction[] {
  const start = raw.indexOf("[")
  const end = raw.lastIndexOf("]")
  if (start === -1 || end <= start) return []

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return []
  }
  if (!Array.isArray(parsed)) return []

  const actions: ReviewAction[] = []
  for (const item of parsed) {
    const normalized = normalizeAction(item)
    if (normalized !== undefined) actions.push(normalized)
  }
  return actions
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/** 按动作类型路由到存储的对应方法；store 自己的语义校验在这里不重复。 */
function callStore(action: ReviewAction, options: RunReviewOptions): Promise<ApplyResult> {
  if (action.action === "create") {
    return options.store.create({
      name: action.name,
      description: action.description ?? "",
      body: action.body ?? "",
      sessionId: options.sessionId,
    })
  }
  if (action.action === "patch") {
    return options.store.patch({
      name: action.name,
      description: action.description,
      body: action.body,
      sessionId: options.sessionId,
    })
  }
  return options.store.writeSupportFile({
    name: action.name,
    filePath: action.file_path ?? "",
    content: action.content ?? "",
    sessionId: options.sessionId,
  })
}

/**
 * 单条动作落盘：store 返回 ok:false 或直接抛错都收敛成 ok:false 结果值，
 * 于是这一条的失败不可能中断后面的动作。
 */
function applyAction(action: ReviewAction, options: RunReviewOptions): Effect.Effect<ApplyResult> {
  return Effect.promise(async () => {
    try {
      return await callStore(action, options)
    } catch (error) {
      return {
        ok: false,
        reason: STORE_ERROR_REASON as RejectReason,
        message: describeError(error),
      } satisfies ApplyResult
    }
  })
}

/**
 * 跑一轮技能沉淀：构造提示词 → 模型输出 → 容错解析 → 截断 → 逐条落盘。
 * root 仅用于日志诊断；整体失败（含模型调用失败）也只记警告并返回空结果。
 */
export function runReview(options: RunReviewOptions): Effect.Effect<ReviewResult> {
  const body = Effect.gen(function* () {
    const prompt = buildReviewPrompt({
      transcript: options.transcript,
      skills: options.skills,
      loadedSkills: options.loadedSkills,
    })
    const raw = yield* options.reviewer({ prompt })
    const actions = parseActions(raw).slice(0, Math.max(0, options.maxActions ?? DEFAULT_MAX_ACTIONS))

    const created: string[] = []
    const patched: string[] = []
    const wroteFiles: string[] = []
    const rejected: Array<{ name: string; reason: string }> = []

    for (const action of actions) {
      const outcome = yield* applyAction(action, options)
      if (outcome.ok) {
        if (action.action === "create") created.push(action.name)
        else if (action.action === "patch") patched.push(action.name)
        else wroteFiles.push(action.name)
        continue
      }
      rejected.push({ name: action.name, reason: outcome.reason })
      yield* Effect.logWarning("learning/review 动作被拒绝，继续处理其余动作", {
        action: action.action,
        name: action.name,
        reason: outcome.reason,
        detail: outcome.message,
      })
    }

    const result: ReviewResult = { created, patched, wroteFiles, rejected }
    yield* Effect.logInfo("learning/review 沉淀完成", {
      root: options.root,
      sessionId: options.sessionId,
      actions: actions.length,
      created: created.length,
      patched: patched.length,
      wroteFiles: wroteFiles.length,
      rejected: rejected.length,
    })
    return result
  })

  return body.pipe(
    Effect.catchCause((cause) =>
      Effect.logWarning("learning/review 沉淀流程失败，返回空结果", {
        root: options.root,
        sessionId: options.sessionId,
        cause,
      }).pipe(Effect.map(emptyResult)),
    ),
  )
}
