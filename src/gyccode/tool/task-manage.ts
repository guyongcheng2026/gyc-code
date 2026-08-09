import * as Tool from "./tool"
import { Effect, Schema } from "effect"
import { BackgroundJob } from "@/background/job"

/**
 * Task management tools (task_list / task_get / task_stop), aligned with
 * Claude Code's TaskListTool / TaskGetTool / TaskStopTool. They surface the
 * background job registry so the model can enumerate, inspect, and stop tasks
 * instead of guessing about their state.
 */

export interface TaskManageService {
  readonly list: () => Effect.Effect<BackgroundJob.Info[]>
  readonly get: (id: string) => Effect.Effect<BackgroundJob.Info | undefined>
  readonly cancel: (id: string) => Effect.Effect<BackgroundJob.Info | undefined>
}

/** The real service backed by the shared background job registry. */
export const liveService = (bg: BackgroundJob.Interface): TaskManageService => ({
  list: () => bg.list(),
  get: (id) => bg.get(id),
  cancel: (id) => bg.cancel(id),
})

const NoParams = Schema.Struct({})
type NoParamsType = Schema.Schema.Type<typeof NoParams>

const TaskIDParams = Schema.Struct({
  task_id: Schema.String.annotate({ description: "The ID of the task to inspect or stop" }),
})
type TaskID = Schema.Schema.Type<typeof TaskIDParams>

type Metadata = Record<string, unknown>

function formatInfo(job: BackgroundJob.Info): string {
  const status = job.status
  const title = job.title ? ` "${job.title}"` : ""
  const error = job.error ? `\n  error: ${job.error}` : ""
  return `<task id="${job.id}" state="${status}"${title}>${error}</task>`
}

const mkList = (service: TaskManageService): Tool.DefWithoutID<typeof NoParams, Metadata> => ({
  description:
    "List all running and recent background tasks (subagents, shell jobs) with their IDs and states. Use this to see what is currently executing before deciding to wait, stop, or start new work.",
  parameters: NoParams,
  execute: (_params: NoParamsType) =>
    Effect.gen(function* () {
      const jobs = yield* service.list()
      if (jobs.length === 0)
        return { title: "No tasks", output: "No tasks are currently running or recent.", metadata: {} }
      const output = jobs
        .map((job) => `- id=${job.id} state=${job.status}${job.title ? ` title="${job.title}"` : ""}`)
        .join("\n")
      return { title: `${jobs.length} tasks`, output, metadata: { tasks: jobs.map((j) => j.id) } }
    }),
})

const mkGet = (service: TaskManageService): Tool.DefWithoutID<typeof TaskIDParams, Metadata> => ({
  description:
    "Get the details and current state of a specific background task by its ID. Returns the task's status, title, and error if any.",
  parameters: TaskIDParams,
  execute: (params: TaskID) =>
    Effect.gen(function* () {
      const job = yield* service.get(params.task_id)
      if (!job) return { title: "Task not found", output: `Task not found: ${params.task_id}`, metadata: {} }
      return { title: job.id, output: formatInfo(job), metadata: { id: job.id, status: job.status } }
    }),
})

const mkStop = (service: TaskManageService): Tool.DefWithoutID<typeof TaskIDParams, Metadata> => ({
  description:
    "Stop (cancel) a running background task by its ID. The task is cancelled and its state becomes 'cancelled'. Use this when a background task is no longer needed or is stuck.",
  parameters: TaskIDParams,
  execute: (params: TaskID) =>
    Effect.gen(function* () {
      const job = yield* service.cancel(params.task_id)
      if (!job) return { title: "Task not found", output: `Task not found: ${params.task_id}`, metadata: {} }
      return {
        title: job.id,
        output: `Task cancelled: ${formatInfo(job)}`,
        metadata: { id: job.id, status: job.status },
      }
    }),
})

/** Tool.Info instances (id + lazy init) for the registry. */
export const list = (service: TaskManageService): Tool.Info<typeof NoParams, Metadata> => ({
  id: "task_list",
  init: () => Effect.succeed(mkList(service)),
})

export const get = (service: TaskManageService): Tool.Info<typeof TaskIDParams, Metadata> => ({
  id: "task_get",
  init: () => Effect.succeed(mkGet(service)),
})

export const stop = (service: TaskManageService): Tool.Info<typeof TaskIDParams, Metadata> => ({
  id: "task_stop",
  init: () => Effect.succeed(mkStop(service)),
})

export * as TaskManage from "./task-manage"
