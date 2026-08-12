import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { makeKeyedLock } from "./keyed-lock"

type Row = { title: string; metadata: string | undefined }

// Simulates Session.patch's read-modify-write: read current state, then
// publish a full-snapshot write (later writers overwrite earlier ones).
// The async point between read and write mirrors the real window where a
// concurrent patch reads the same stale snapshot.
const applyPatch = (lock: ReturnType<typeof makeKeyedLock>, store: Map<string, Row>, key: string, patch: Partial<Row>) =>
  lock.withLock(
    key,
    Effect.gen(function* () {
      const current = store.get(key)!
      yield* Effect.sleep(1) // async window: a concurrent patch can read stale state here
      store.set(key, { ...current, ...patch })
    }),
  )

describe("makeKeyedLock", () => {
  it("does not lose concurrent updates to distinct fields of the same key", async () => {
    const store = new Map<string, Row>([["s1", { title: "old", metadata: undefined }]])
    const lock = makeKeyedLock()

    await Effect.runPromise(
      Effect.all(
        [
          applyPatch(lock, store, "s1", { title: "new-title" }),
          applyPatch(lock, store, "s1", { metadata: "m1" }),
        ],
        { concurrency: "unbounded" },
      ),
    )

    // Without serialization the second read-modify-write starts from the stale
    // snapshot and clobbers the first field update.
    expect(store.get("s1")).toEqual({ title: "new-title", metadata: "m1" })
  })

  it("runs critical sections for the same key sequentially", async () => {
    const store = new Map<string, Row>([["s1", { title: "old", metadata: undefined }]])
    const lock = makeKeyedLock()

    let counter = 0
    const bump = (times: number) =>
      lock.withLock(
        "s1",
        Effect.gen(function* () {
          yield* Effect.sleep(1)
          for (let i = 0; i < times; i++) counter++
        }),
      )

    await Effect.runPromise(Effect.all([bump(10), bump(10), bump(10)], { concurrency: "unbounded" }))

    expect(counter).toBe(30)
  })

  it("allows different keys to run concurrently", async () => {
    const lock = makeKeyedLock()
    let active = 0
    let maxActive = 0
    const apply = (key: string) =>
      lock.withLock(
        key,
        Effect.gen(function* () {
          active++
          maxActive = Math.max(maxActive, active)
          yield* Effect.sleep(10)
          active--
        }),
      )

    await Effect.runPromise(Effect.all([apply("a"), apply("b")], { concurrency: "unbounded" }))

    expect(maxActive).toBe(2)
  })
})