import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { KeyedMutex } from "./keyed-mutex"

describe("KeyedMutex", () => {
  it("P2 回归: 同一 key 的临界区串行执行", async () => {
    const mutex = KeyedMutex.makeUnsafe<string>()
    let counter = 0
    const bump = (id: string) =>
      mutex.withLock(id)(
        Effect.gen(function* () {
          const before = counter
          yield* Effect.sleep(1)
          counter = before + 1
        }),
      )

    await Effect.runPromise(Effect.all([bump("a"), bump("a"), bump("a")], { concurrency: "unbounded" }))
    expect(counter).toBe(3)
  })

  it("不同 key 独立执行", async () => {
    const mutex = KeyedMutex.makeUnsafe<string>()
    let active = 0
    let maxActive = 0
    const work = (key: string) =>
      mutex.withLock(key)(
        Effect.gen(function* () {
          active++
          maxActive = Math.max(maxActive, active)
          yield* Effect.sleep(5)
          active--
        }),
      )

    await Effect.runPromise(Effect.all([work("a"), work("b"), work("c")], { concurrency: "unbounded" }))
    expect(maxActive).toBe(3)
  })

  it("完成后清理锁条目（users=0 时 delete）", async () => {
    const mutex = KeyedMutex.makeUnsafe<string>()
    await Effect.runPromise(mutex.withLock("x")(Effect.void))
    await Effect.runPromise(mutex.withLock("y")(Effect.void))
    expect(await Effect.runPromise(mutex.size)).toBe(0)
  })

  it("高并发下不丢更新", async () => {
    const mutex = KeyedMutex.makeUnsafe<string>()
    const store = new Map<string, number>([["counter", 0]])

    const inc = () =>
      mutex.withLock("counter")(
        Effect.gen(function* () {
          const cur = store.get("counter")!
          yield* Effect.sleep(0)
          store.set("counter", cur + 1)
        }),
      )

    const tasks = Array.from({ length: 50 }, () => inc())
    await Effect.runPromise(Effect.all(tasks, { concurrency: "unbounded" }))
    expect(store.get("counter")).toBe(50)
  })
})
