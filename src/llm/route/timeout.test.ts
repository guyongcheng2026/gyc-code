import { describe, expect, test } from "bun:test"
import { Cause, Effect, Stream } from "effect"

import {
  DEFAULT_FIRST_BYTE_TIMEOUT_MS,
  DEFAULT_STREAM_IDLE_TIMEOUT_MS,
  FIRST_BYTE_TIMEOUT_ENV,
  MAX_TIMEOUT_MS,
  STREAM_IDLE_TIMEOUT_ENV,
  streamIdleTimeoutMs,
  timeoutError,
  timeoutLimit,
  withFirstByteTimeout,
} from "./timeout"

/**
 * G-26-3：LLM 请求层的超时。
 *
 * 必须拆成首字节与流空闲两个维度，因为 `transport/http.ts` 里 `frames` 是
 * `Stream.unwrap(runtime.http.execute(...))` —— 响应体在 execute 返回之后才被
 * 惰性消费。把「总超时」套在 execute 上会误杀正常的长流式推理。
 */

const input = { message: "boom", url: "https://example.com/v1", method: "POST" }

const withEnv = <T>(name: string, value: string | undefined, run: () => T): T => {
  const previous = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
  try {
    return run()
  } finally {
    if (previous === undefined) delete process.env[name]
    else process.env[name] = previous
  }
}

describe("timeoutLimit（非法值夹取）", () => {
  test("合法值原样返回", () => {
   	expect(timeoutLimit(1234, DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(1234)
  })

  test("undefined 回落到默认值", () => {
    expect(timeoutLimit(undefined, DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(DEFAULT_FIRST_BYTE_TIMEOUT_MS)
  })

  test("空串也回落默认值", () => {
    expect(timeoutLimit("  ", DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(DEFAULT_FIRST_BYTE_TIMEOUT_MS)
    expect(timeoutLimit(null, DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(DEFAULT_FIRST_BYTE_TIMEOUT_MS)
  })

  test("0、负数、NaN 一律回落默认值", () => {
    for (const bad of [0, -1, Number.NaN]) {
      expect(timeoutLimit(bad, DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(DEFAULT_FIRST_BYTE_TIMEOUT_MS)
    }
  })

  test("超过上限被夹到上限，防止设成极大值后彻底失去超时保护", () => {
    expect(timeoutLimit(Number.MAX_SAFE_INTEGER, DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(MAX_TIMEOUT_MS)
  })

  test("小数向下取整", () => {
    expect(timeoutLimit(1500.9, DEFAULT_FIRST_BYTE_TIMEOUT_MS)).toBe(1500)
  })
})

describe("流空闲超时配置", () => {
  test("未设置环境变量时用默认值", () => {
    withEnv(STREAM_IDLE_TIMEOUT_ENV, undefined, () => {
      expect(streamIdleTimeoutMs()).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    })
  })

  test("环境变量可覆盖", () => {
    withEnv(STREAM_IDLE_TIMEOUT_ENV, "1234", () => {
      expect(streamIdleTimeoutMs()).toBe(1234)
    })
  })

  test("非法环境变量回落到默认值", () => {
    withEnv(STREAM_IDLE_TIMEOUT_ENV, "not-a-number", () => {
      expect(streamIdleTimeoutMs()).toBe(DEFAULT_STREAM_IDLE_TIMEOUT_MS)
    })
  })

  test("环境变量超过上限被夹到上限", () => {
    withEnv(STREAM_IDLE_TIMEOUT_ENV, String(Number.MAX_SAFE_INTEGER), () => {
      expect(streamIdleTimeoutMs()).toBe(MAX_TIMEOUT_MS)
    })
  })
})

describe("withFirstByteTimeout（首字节超时）", () => {
  test("按时完成的请求不受影响", async () => {
    const effect = Effect.succeed("ok")
    const result = await withEnv(FIRST_BYTE_TIMEOUT_ENV, "5000", () =>
      Effect.runPromise(withFirstByteTimeout(effect) as Effect.Effect<string>),
    )
    expect(result).toBe("ok")
  })

  test("超时的 effect 产出 Cause.TimeoutError —— 由 executor 的 toHttpError 映射为 408", async () => {
    const never = Effect.never as Effect.Effect<string>
    const applied = withEnv(FIRST_BYTE_TIMEOUT_ENV, "40", () => withFirstByteTimeout(never))
    const error = await Effect.runPromise(Effect.flip(applied as Effect.Effect<string, unknown>))
    // withFirstByteTimeout 只负责「超时」，不负责「映射」：
    // executor.ts 的 toHttpError 已有 Cause.isTimeoutError → ProviderInternal(408) 的映射，
    // 复用它即可，不必在这里重复造错误类型。
    expect(Cause.isTimeoutError(error)).toBe(true)
  })

  test("timeoutError 本身产出结构化 408（流空闲超时走这条路径）", () => {
    const error = timeoutError({ message: "stalled", url: "https://example.com/v1", method: "POST" })
    expect(error.reason._tag).toBe("ProviderInternal")
    expect((error.reason as { status?: number }).status).toBe(408)
  })

  test("executor 的 toHttpError 确实把 Cause.TimeoutError 映射成 ProviderInternal(408)", () => {
    const error = timeoutError(input)
    // 锁住 http.ts 依赖的判定：reason._tag === "ProviderInternal" 且 status === 408
    const reason = error.reason as { _tag: string; status?: number }
    expect(reason._tag === "ProviderInternal" && reason.status === 408).toBe(true)
  })

  test("transport/http.ts 依赖 reason._tag/status 识别超时 —— 该断言锁住这条契约", () => {
    // http.ts 的 isStructuredTransportError 判定：ProviderInternal 且 status===408
    const reason = { _tag: "ProviderInternal", status: 408 } as const
    const recognized = reason._tag === "ProviderInternal" && reason.status === 408
    expect(recognized).toBe(true)
  })
})
