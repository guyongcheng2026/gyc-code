export * as WorkflowV2 from "./index"

import { Context, Duration, Effect, Fiber, Layer, Schema, Stream } from "effect"
import { eq } from "drizzle-orm"
import {
  WorkflowRun as WorkflowRunSchema,
  WorkflowRunStep as WorkflowRunStepSchema,
  type WorkflowDef,
  type WorkflowRun,
  type WorkflowRunStep,
  type WorkflowStepDef,
} from "@gyccode/schema/workflow"
import { DefinitionError, parseDefinition, transitionAfterStep } from "./state"
import { Database } from "../database/database"
import { SessionV2 } from "../session"
import { EventV2 } from "../event"
import { FSUtil } from "../fs-util"
import { Global } from "../global"
import { makeGlobalNode } from "../effect/app-node"
import { Identifier } from "../util/identifier"
import { Glob } from "../util/glob"
import { WorkflowRunTable } from "./sql"

/**
 * 工作流编排引擎（Workflow V2）
 *
 * 定位：Compose / Spec / Solo 融合编排的核心状态机。
 * - 定义来源：项目 `.gyccode/workflows/*.json|jsonc` 与全局配置目录 `workflows/`
 * - 执行模型：每个步骤向关联会话发送一次 prompt，轮询会话空闲后依据
 *   `session.next.step.failed` 事件判定成败；支持 retry 与 onFailure 跳转
 * - 持久化：`workflow_run` 表（步骤状态机 JSON），进程内 fiber 驱动
 */

/** 步骤级超时（默认 30 分钟） */
const STEP_TIMEOUT = Duration.minutes(30)
/** 空闲轮询间隔 */
const POLL_INTERVAL = Duration.millis(800)
/** 摘要截断长度 */
const SUMMARY_MAX = 2000

export class NotFoundError extends Schema.TaggedErrorClass<NotFoundError>()("Workflow.NotFoundError", {
  id: Schema.String,
}) {}

import type { EffectDrizzleQueryError } from "drizzle-orm/effect-core/errors"

export type Error = NotFoundError | DefinitionError | FSUtil.Error | EffectDrizzleQueryError

export interface Interface {
  /** 列出指定目录可用的工作流定义 */
  readonly defs: (directory: string) => Effect.Effect<WorkflowDef[], Error>
  /** 读取单个工作流定义 */
  readonly def: (name: string, directory: string) => Effect.Effect<WorkflowDef | undefined, Error>
  /** 启动一次工作流运行（立即开始执行首个步骤） */
  readonly start: (input: { workflow: string; sessionID: string; directory: string }) => Effect.Effect<WorkflowRun, Error>
  /** 查询一次运行 */
  readonly get: (runID: string) => Effect.Effect<WorkflowRun | undefined, Error>
  /** 列出运行（可按目录过滤） */
  readonly list: (directory?: string) => Effect.Effect<WorkflowRun[], Error>
  /** 终止运行 */
  readonly abort: (runID: string) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/v2/Workflow") {}

/** 进程内活跃驱动集合（runID），用于避免重复拉起与进程退出清理 */
const activeDrivers = new Set<string>()

const loadFromDir = (dir: string, fs: FSUtil.Interface) =>
  Effect.gen(function* () {
    const exists = yield* fs.existsSafe(dir)
    if (!exists) return [] as WorkflowDef[]
    const files = yield* Effect.promise(() => Glob.scan(join2(dir, "*.json"))).pipe(Effect.orElseSucceed(() => [] as string[]))
    const jsonc = yield* Effect.promise(() => Glob.scan(join2(dir, "*.jsonc"))).pipe(Effect.orElseSucceed(() => [] as string[]))
    const result: WorkflowDef[] = []
    for (const file of [...files, ...jsonc]) {
      const name = file.split(/[\\/]/).pop()!.replace(/\.(jsonc?|yaml|yml)$/i, "")
      const text = yield* fs.readFileStringSafe(file)
      if (text === undefined) continue
      const def = yield* parseDefinition(name, text).pipe(Effect.orElseSucceed(() => undefined))
      if (def) result.push(def)
    }
    return result
  })

function join2(dir: string, pattern: string) {
  return dir.endsWith("/") ? dir + pattern : dir + "/" + pattern
}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const database = yield* Database.Service
    const db = database.db
    const sessions = yield* SessionV2.Service
    const events = yield* EventV2.Service
    const fs = yield* FSUtil.Service
    const configDir = Global.Path.config

    const loadDefs = (directory: string) =>
      Effect.gen(function* () {
        const defs: WorkflowDef[] = []
        for (const dir of [join2(directory.replaceAll("\\", "/"), ".gyccode/workflows"), join2(configDir.replaceAll("\\", "/"), "workflows")]) {
          defs.push(...(yield* loadFromDir(dir, fs)))
        }
        const seen = new Set<string>()
        return defs.filter((d) => (seen.has(d.name) ? false : (seen.add(d.name), true)))
      })

    const loadDef = (name: string, directory: string) =>
      loadDefs(directory).pipe(Effect.map((defs) => defs.find((d) => d.name === name)))

    const updateRun = (
      runID: string,
      patch: Partial<Pick<WorkflowRun, "status" | "currentStepIndex" | "steps" | "error" | "timeUpdated">>,
    ) => db.update(WorkflowRunTable).set({ ...patch, time_updated: Date.now(), steps: patch.steps as any }).where(eq(WorkflowRunTable.id, runID))

    const readRun = (runID: string) =>
      db.select().from(WorkflowRunTable).where(eq(WorkflowRunTable.id, runID)).limit(1).pipe(
        Effect.map((rows) => (rows.length > 0 ? decodeRun(rows[0]!) : undefined)),
        Effect.orDie,
      )

    const stepFailedSince = (sessionID: string, after: number): Effect.Effect<boolean> =>
      events
        .durable({ aggregateID: sessionID, after })
        .pipe(Stream.runCollect, Effect.map((items) => items.some((item) => item.type === "session.next.step.failed")))

    const lastAssistantSummary = (sessionID: string) =>
      sessions.context(sessionID as any).pipe(
        Effect.map((messages) => {
          for (let i = messages.length - 1; i >= 0; i--) {
            const message = messages[i]!
            if (message.type !== "assistant") continue
            const parts = message.content as ReadonlyArray<{ type: string; text?: unknown }>
            let text = ""
            for (const part of parts) {
              if (part.type === "text" && typeof part.text === "string") {
                text += part.text
              }
            }
            if (text.length > SUMMARY_MAX) text = text.slice(0, SUMMARY_MAX)
            if (text.length > 0) return text.slice(0, SUMMARY_MAX)
          }
          return ""
        }),
        Effect.orElseSucceed(() => ""),
      )

    const executeStep = (run: WorkflowRun, step: WorkflowStepDef) =>
      Effect.gen(function* () {
        const cursor = yield* EventV2.latestSequence(db, run.sessionID)
        const stepIndex = run.currentStepIndex
        const nextSteps = run.steps.map((s, i) =>
          i === stepIndex ? new WorkflowRunStepSchema({ ...s, status: "running", timeStarted: Date.now() }) : s,
        )
        yield* updateRun(run.id, { steps: nextSteps })

        const promptText = [step.prompt, step.verify ? `\n\n验证要求：${step.verify}\n完成后请说明验证结论与结果摘要。` : ""].join("")
        yield* sessions.prompt({ sessionID: run.sessionID as any, prompt: { text: promptText } })

        const deadline = Date.now() + Duration.toMillis(STEP_TIMEOUT)
        for (;;) {
          const active = yield* (sessions.active as Effect.Effect<ReadonlySet<string>>) as Effect.Effect<Set<string>>
          if (!active.has(run.sessionID)) {
            const failed = yield* stepFailedSince(run.sessionID, cursor)
            if (failed) {
              return { ok: false as const, error: `步骤 ${step.name} 执行失败（检测到步骤失败事件）`, summary: "" }
            }
            const summary = yield* lastAssistantSummary(run.sessionID)
            return { ok: true as const, summary }
          }
          if (Date.now() > deadline) {
            return {
              ok: false as const,
              error: `步骤 ${step.name} 执行超时（${Duration.toMillis(STEP_TIMEOUT) / 60000} 分钟）`,
              summary: "",
            }
          }
          yield* Effect.sleep(POLL_INTERVAL)
        }
      })

    const patchSteps = (runID: string, run: WorkflowRun, steps: WorkflowRunStep[]) => updateRun(runID, { steps: steps as any })

    /** 驱动一次运行直至结束（进程内 fiber） */
    const drive = (runID: string) =>
      Effect.gen(function* () {
        try {
          for (;;) {
            const run = yield* readRun(runID)
            if (!run || run.status !== "running") return
            const def = yield* loadDef(run.workflow, run.directory)
            if (!def) {
              yield* updateRun(runID, { status: "failed", error: `工作流定义不存在: ${run.workflow}` })
              return
            }
            const index = run.currentStepIndex
            if (index >= def.steps.length) {
              yield* updateRun(runID, { status: "done", currentStepIndex: index })
              return
            }
            const stepDef = def.steps[index]!
            const outcome = yield* executeStep(run, stepDef)
            const transition = transitionAfterStep({ steps: run.steps, index, stepDef, def, outcome })
            const transitionSteps: WorkflowRunStep[] = []
            for (const step of transition.steps) {
              transitionSteps.push(step)
            }
            if (transition.kind === "next") {
              yield* patchSteps(runID, run, transitionSteps)
              yield* updateRun(runID, { currentStepIndex: transition.currentStepIndex })
              continue
            }
            if (transition.kind === "retry") {
              yield* patchSteps(runID, run, transitionSteps)
              continue
            }
            if (transition.kind === "jump") {
              yield* patchSteps(runID, run, transitionSteps)
              yield* updateRun(runID, { currentStepIndex: transition.currentStepIndex })
              continue
            }
            yield* patchSteps(runID, run, transitionSteps)
            yield* updateRun(runID, { status: "failed", error: transition.error })
            return
          }
        } finally {
          activeDrivers.delete(runID)
        }
      })

    return Service.of({
      defs: (directory: string): Effect.Effect<WorkflowDef[], Error> => loadDefs(directory),
      def: (name: string, directory: string): Effect.Effect<WorkflowDef | undefined, Error> => loadDef(name, directory),
      start: ({ workflow, sessionID, directory }: { workflow: string; sessionID: string; directory: string }): Effect.Effect<WorkflowRun, Error> =>
        Effect.gen(function* () {
          const def = yield* loadDef(workflow, directory)
          if (!def) return yield* Effect.fail(new DefinitionError({ message: `工作流定义不存在: ${workflow}` }))
          const runID = `${workflow}-${Identifier.ascending()}`
          const run = new WorkflowRunSchema({
            id: runID,
            workflow,
            sessionID,
            directory,
            status: "running",
            currentStepIndex: 0,
            steps: def.steps.map((s) => new WorkflowRunStepSchema({ stepId: s.id, status: "pending", retries: 0 })),
            timeCreated: Date.now(),
            timeUpdated: Date.now(),
          })
          yield* db.insert(WorkflowRunTable).values([{
            id: run.id,
            workflow: run.workflow,
            session_id: run.sessionID,
            directory: run.directory,
            status: run.status,
            current_step_index: run.currentStepIndex,
            steps: run.steps as any,
          }])
          if (!activeDrivers.has(runID)) {
            activeDrivers.add(runID)
            yield* Effect.forkChild(drive(runID))
          }
          return run
        }),
      get: (runID: string): Effect.Effect<WorkflowRun | undefined, Error> => readRun(runID),
      list: (directory?: string): Effect.Effect<WorkflowRun[], Error> =>
        db.select().from(WorkflowRunTable).pipe(
          Effect.map((rows) => rows.map((row) => decodeRun(row))),
          Effect.map((runs) => (directory ? runs.filter((r) => r.directory === directory) : runs)),
        ),
      abort: (runID: string): Effect.Effect<void, Error> =>
        Effect.gen(function* () {
          const run = yield* readRun(runID)
          if (!run) return yield* Effect.fail(new NotFoundError({ id: runID }))
          yield* updateRun(runID, { status: "aborted" })
        }),
    })
  }),
)

const decodeRun = (row: typeof WorkflowRunTable.$inferSelect): WorkflowRun =>
  new WorkflowRunSchema({
    id: row.id,
    workflow: row.workflow,
    sessionID: row.session_id,
    directory: row.directory,
    status: row.status,
    currentStepIndex: row.current_step_index,
    steps: row.steps,
    ...(row.error === null ? {} : { error: row.error }),
    timeCreated: row.time_created,
    timeUpdated: row.time_updated,
  })

export const node = makeGlobalNode({
  service: Service,
  layer: layer.pipe(Layer.orDie),
  deps: [Database.node, SessionV2.node, EventV2.node, FSUtil.node],
})