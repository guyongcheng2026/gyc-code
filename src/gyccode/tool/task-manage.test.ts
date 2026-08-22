import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import * as Tool from "./tool"
import { TaskManage, type TaskManageService } from "./task-manage"
import { BackgroundJob } from "@/background/job"

const fakeJobs = (infos: BackgroundJob.Info[]): TaskManageService => {
  const jobs = new Map(infos.map((j) => [j.id, j]))
  return {
    list: () => Effect.succeed([...jobs.values()]),
    get: (id) => Effect.succeed(jobs.get(id)),
    cancel: (id) => {
      const job = jobs.get(id)
      if (job) jobs.set(id, { ...job, status: "cancelled" })
      return Effect.succeed(job ? { ...job, status: "cancelled" as const } : undefined)
    },
  }
}

const bg = (id: string, status: BackgroundJob.Status = "running"): BackgroundJob.Info => ({
  id,
  type: "subagent",
  title: "analyze",
  status,
  started_at: Date.now(),
})

const exec = async (info: Tool.Info<any, any>, args: any) => {
  const def = await Effect.runPromise(Tool.init(info))
  return Effect.runPromise(def.execute(args, { sessionID: "s1", messageID: "m1", agent: "build" } as any))
}

describe("task_list", () => {
  it("renders a table of tasks with status", async () => {
    const out = await exec(TaskManage.list(fakeJobs([bg("t1", "running"), bg("t2", "completed")])), {})
    expect(out.output).toContain("t1")
    expect(out.output).toContain("t2")
    expect(out.output).toContain("running")
    expect(out.output).toContain("completed")
  })

  it("returns a friendly message when there are no tasks", async () => {
    const out = await exec(TaskManage.list(fakeJobs([])), {})
    expect(out.output).toMatch(/no tasks/i)
  })
})

describe("task_get", () => {
  it("returns task details for a known id", async () => {
    const out = await exec(TaskManage.get(fakeJobs([bg("t1")])), { task_id: "t1" })
    expect(out.output).toContain("t1")
    expect(out.output).toContain("running")
  })

  it("reports when the task is not found", async () => {
    const out = await exec(TaskManage.get(fakeJobs([])), { task_id: "nope" })
    expect(out.output).toMatch(/not found/i)
  })
})

describe("task_stop", () => {
  it("cancels a running task", async () => {
    const out = await exec(TaskManage.stop(fakeJobs([bg("t1")])), { task_id: "t1" })
    expect(out.output).toContain("t1")
    expect(out.output).toContain("cancelled")
  })

  it("reports when the task to stop is not found", async () => {
    const out = await exec(TaskManage.stop(fakeJobs([])), { task_id: "nope" })
    expect(out.output).toMatch(/not found/i)
  })
})
