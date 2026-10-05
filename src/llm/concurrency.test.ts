// G-26-2：`src/llm` 内零并发上限。本测试把请求层并发闸的夹取规则、环境变量覆盖、
// 全局闸复用性与实际背压行为固化下来。
import { describe, expect, test } from "bun:test"
import { Effect, Ref } from "effect"
import {
  CONCURRENCY_ENV,
  DEFAULT_LLM_CONCURRENCY,
  MAX_LLM_CONCURRENCY,
  globalGate,
  llmConcurrencyLimit,
  requestConcurrency,
} from "./concurrency"

const withEnv = async (value: string | undefined, run: () => Promise<void> | void) => {
  const saved = process.env[CONCURRENCY_ENV]
  if (value === undefined) delete process.env[CONCURRENCY_ENV]
  else process.env[CONCURRENCY_ENV] = value
  try {
    await run()
  } finally {
    if (saved === undefined) delete process.env[CONCURRENCY_ENV]
    else process.env[CONCURRENCY_ENV] = saved
  }
}

describe("llmConcurrencyLimit：非法值夹取与上限回落", () => {
  test("未配置时回落默认值 4（与 swarm 默认一致）", () => {
    expect(llmConcurrencyLimit(undefined)).toBe(DEFAULT_LLM_CONCURRENCY)
    expect(DEFAULT_LLM_CONCURRENCY).toBe(4)
  })

  test("非数字、NaN、0、负数都回落默认值", () => {
    expect(llmConcurrencyLimit("abc")).toBe(DEFAULT_LLM_CONCURRENCY)
    expect(llmConcurrencyLimit("")).toBe(DEFAULT_LLM_CONCURRENCY)
    expect(llmConcurrencyLimit("NaN")).toBe(DEFAULT_LLM_CONCURRENCY)
    expect(llmConcurrencyLimit("0")).toBe(DEFAULT_LLM_CONCURRENCY)
    expect(llmConcurrencyLimit("-3")).toBe(DEFAULT_LLM_CONCURRENCY)
    expect(llmConcurrencyLimit("0.4")).toBe(DEFAULT_LLM_CONCURRENCY)
  })

  test("超过上限时夹到上限 16，不放行无限并发", () => {
    expect(MAX_LLM_CONCURRENCY).toBe(16)
    expect(llmConcurrencyLimit("999")).toBe(MAX_LLM_CONCURRENCY)
    expect(llmConcurrencyLimit("16")).toBe(16)
    expect(llmConcurrencyLimit("8")).toBe(8)
    expect(llmConcurrencyLimit(" 8 ")).toBe(8)
  })
})

describe("requestConcurrency：GYC_* 环境变量覆盖", () => {
  test("未设置环境变量时用默认值", async () => {
    await withEnv(undefined, () => {
      expect(requestConcurrency()).toBe(DEFAULT_LLM_CONCURRENCY)
    })
  })

  test("合法环境变量生效", async () => {
    await withEnv("7", () => {
      expect(requestConcurrency()).toBe(7)
    })
  })

  test("非法环境变量回落到默认值", async () => {
    await withEnv("not-a-number", () => {
      expect(requestConcurrency()).toBe(DEFAULT_LLM_CONCURRENCY)
    })
  })

  test("超上限环境变量夹到上限", async () => {
    await withEnv("5000", () => {
      expect(requestConcurrency()).toBe(MAX_LLM_CONCURRENCY)
    })
  })
})

describe("globalGate：按 permit 数缓存的全局信号量", () => {
  test("相同 permit 数复用同一个闸，不同 permit 数互相独立", () => {
    expect(globalGate(5)).toBe(globalGate(5))
    expect(globalGate(5)).not.toBe(globalGate(6))
  })

  test("并发执行数被压到 permit 数以内，且确实被占满", async () => {
    const gate = globalGate(3)
    const peak = await Effect.runPromise(
      Effect.gen(function* () {
        const inflight = yield* Ref.make(0)
        const maxSeen = yield* Ref.make(0)
        yield* Effect.forEach(
          Array.from({ length: 12 }, (_, i) => i),
          () =>
            gate.withPermit(
              Effect.gen(function* () {
                const now = yield* Ref.updateAndGet(inflight, (n) => n + 1)
                yield* Ref.update(maxSeen, (m) => Math.max(m, now))
                yield* Effect.sleep(5)
                yield* Ref.update(inflight, (n) => n - 1)
              }),
            ),
          { concurrency: "unbounded" },
        )
        return yield* Ref.get(maxSeen)
      }),
    )
    expect(peak).toBe(3)
  })

  test("permit 在失败路径上也会归还，不会泄漏", async () => {
    const gate = globalGate(1)
    const settled = await Effect.runPromise(
      Effect.forEach(
        Array.from({ length: 5 }, () => 0),
        () =>
          gate.withPermit(
            Effect.gen(function* () {
              yield* Effect.sleep(1)
              return yield* Effect.fail("boom" as const).pipe(Effect.catchCause(() => Effect.succeed("recovered")))
            }),
          ),
        { concurrency: "unbounded" },
      ),
    )
    expect(settled).toEqual(["recovered", "recovered", "recovered", "recovered", "recovered"])
  })
})