import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { BackgroundJob } from "./background-job"

// Runs a job registry inside a fresh scope, matching how `make` consumes
// `Scope.Scope` for its own forked runners.
const withJobs = <A, E>(use: (jobs: BackgroundJob.Interface) => Effect.Effect<A, E>) =>
  Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const jobs = yield* BackgroundJob.make
        return yield* use(jobs)
      }),
    ),
  )

describe("BackgroundJob registry bounds", () => {
  it("keeps every running job even after the cap is exceeded", async () => {
    await withJobs((jobs) =>
      Effect.gen(function* () {
        // A long-running job that must never be evicted.
        const running = yield* jobs.start({ id: "running-1", type: "task", run: Effect.never })

        for (let i = 0; i < BackgroundJob.MAX_FINISHED_JOBS + 10; i++) {
          const info = yield* jobs.start({
            id: `job-${i}`,
            type: "task",
            run: Effect.succeed(`out-${i}`),
          })
          const waited = yield* jobs.wait({ id: info.id })
          expect(waited.info?.status).toBe("completed")
        }

        const listed = yield* jobs.list()
        const ids = listed.map((job) => job.id)
        expect(ids).toContain("running-1")
        const runningJob = listed.find((job) => job.id === running.id)
        expect(runningJob?.status).toBe("running")
      }),
    )
  })

  it("evicts the oldest finished jobs once the cap is exceeded", async () => {
    await withJobs((jobs) =>
      Effect.gen(function* () {
        for (let i = 0; i < BackgroundJob.MAX_FINISHED_JOBS + 10; i++) {
          const info = yield* jobs.start({
            id: `job-${i}`,
            type: "task",
            run: Effect.succeed(`out-${i}`),
          })
          yield* jobs.wait({ id: info.id })
        }

        const listed = yield* jobs.list()
        // Never exceed the cap after settling.
        expect(listed.length).toBeLessThanOrEqual(BackgroundJob.MAX_FINISHED_JOBS)
        // The oldest finished jobs are gone, the newest are retained.
        const ids = listed.map((job) => job.id)
        expect(ids).not.toContain("job-0")
        expect(ids).toContain(`job-${BackgroundJob.MAX_FINISHED_JOBS + 9}`)
      }),
    )
  })
})