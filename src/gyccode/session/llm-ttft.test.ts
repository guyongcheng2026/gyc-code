import { expect, test } from "bun:test"
import { Effect, Ref, Stream } from "effect"
import { LLM_TTFT_SLOW_MS, withFirstTokenLatency } from "./llm-timeout"

/**
 * 收集流的值。与 `withFirstEventTimeout` 一致：重放首个拉取段时该段被当作
 * 单个块元素拼接，故收集结果是嵌套一层数组。这里摊平，使断言聚焦于
 * TTFT 打点本身，而非流的块嵌套形状（该形状是既有实现的行为，本轮不改）。
 */
const collect = <A, E>(s: Stream.Stream<A, E, never>) =>
  Effect.runPromise(
    Stream.runCollect(s) as unknown as Effect.Effect<unknown[], never, never>,
  ).then((c) => (c as unknown[]).flat())

test("LLM_TTFT_SLOW_MS 是合理的正阈值", () => {
  expect(LLM_TTFT_SLOW_MS).toBeGreaterThan(0)
  expect(Number.isFinite(LLM_TTFT_SLOW_MS)).toBe(true)
})

test("首 token 慢于阈值时触发 onSlow 并带上实测毫秒数", async () => {
  const seen: number[] = []
  // startedAt 往前推 5s，模拟首 token 耗时 5000ms
  const result = await collect(
    withFirstTokenLatency(Stream.make("a", "b"), {
      startedAt: Date.now() - 5_000,
      thresholdMs: 1_000,
      onSlow: (ttftMs) => Effect.sync(() => void seen.push(ttftMs)),
    }),
  )
  expect(result).toEqual(["a", "b"])
  expect(seen).toHaveLength(1)
  expect(seen[0]).toBeGreaterThanOrEqual(5_000)
})

test("首 token 快于阈值时不触发 onSlow", async () => {
  const seen: number[] = []
  const result = await collect(
    withFirstTokenLatency(Stream.make("a", "b"), {
      startedAt: Date.now(),
      thresholdMs: 60_000,
      onSlow: (ttftMs) => Effect.sync(() => void seen.push(ttftMs)),
    }),
  )
  expect(result).toEqual(["a", "b"])
  expect(seen).toHaveLength(0)
})

test("默认阈值下未传 thresholdMs 也可工作（走默认 slow 判定）", async () => {
  const seen: number[] = []
  const result = await collect(
    withFirstTokenLatency(Stream.make("x"), {
      // 默认阈值 3000ms；给一个早已开始的时间，必然超过
      startedAt: Date.now() - 60_000,
      onSlow: (ttftMs) => Effect.sync(() => void seen.push(ttftMs)),
    }),
  )
  expect(result).toEqual(["x"])
  expect(seen).toHaveLength(1)
})

test("onSlow 缺省时不报错，流仍正常透传（默认走 logInfo）", async () => {
  const result = await collect(
    withFirstTokenLatency(Stream.make("a", "b", "c"), {
      startedAt: Date.now(),
      thresholdMs: 60_000,
    }),
  )
  expect(result).toEqual(["a", "b", "c"])
})

test("透传完整：首块不丢、不重复、顺序正确", async () => {
  const source = Stream.fromArray([1, 2, 3, 4, 5])
  const seen: number[] = []
  const result = await collect(
    withFirstTokenLatency(source, {
      startedAt: Date.now(),
      thresholdMs: 60_000,
      onSlow: (ttftMs) => Effect.sync(() => void seen.push(ttftMs)),
    }),
  )
  expect(result).toEqual([1, 2, 3, 4, 5])
})

test("首块只测量一次：多事件流不会重复打点", async () => {
  const seen: number[] = []
  await collect(
    withFirstTokenLatency(Stream.make("a", "b", "c", "d"), {
      startedAt: Date.now() - 10_000,
      thresholdMs: 1_000,
      onSlow: (ttftMs) => Effect.sync(() => void seen.push(ttftMs)),
    }),
  )
  expect(seen).toHaveLength(1)
})

test("空流不会触发 onSlow 也不会抛错", async () => {
  const seen: number[] = []
  const result = await collect(
    withFirstTokenLatency(Stream.empty, {
      startedAt: Date.now() - 10_000,
      thresholdMs: 1_000,
      onSlow: (ttftMs) => Effect.sync(() => void seen.push(ttftMs)),
    }),
  )
  expect(result).toEqual([])
  expect(seen).toHaveLength(0)
})