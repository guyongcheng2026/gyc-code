import { describe, expect, it } from "bun:test"
import { Effect, Layer } from "effect"
import { DEFAULT_ASK_TIMEOUT_MS, Service, layer, resolveAskTimeoutMs } from "./index"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema"
import { PermissionV1 } from "@gyccode/core/v1/permission"

/**
 * D1 回归：审批等待原先是裸 `Deferred.await`，没有任何超时。
 * 只要 reply 没送达（CLI 未订阅 / 非交互进程没有 UI / 客户端中途断开），
 * ask 就会永久挂起，整轮对话卡死，工具 part 也永远停在 `running`。
 * 这里锁定两件事：超时时长可配置，且超时后不再挂起。
 */

const eventsStub = { publish: () => Effect.void, listen: () => Effect.void } as never
const stubLayer = Layer.succeed(EventV2Bridge.Service, eventsStub)
const testLayer = layer.pipe(Layer.provide(stubLayer))

function askInput(): PermissionV1.AskInput {
  return {
    sessionID: SessionID.make("ses_ask_timeout"),
    permission: "edit",
    patterns: ["src/**"],
    metadata: {},
    always: ["src/**"],
    ruleset: [],
  }
}

const withService = <A, E>(program: Effect.Effect<A, E, Service>): Promise<A> =>
  Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>))

describe("审批等待超时上限", () => {
  it("未设置环境变量时用 30 分钟默认值", () => {
    const raw = process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
    delete process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
    try {
      expect(resolveAskTimeoutMs()).toBe(DEFAULT_ASK_TIMEOUT_MS)
    } finally {
      if (raw !== undefined) process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS = raw
    }
  })

  it("环境变量可覆盖；非法值回落到默认值", () => {
    const raw = process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
    try {
      process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS = "1500"
      expect(resolveAskTimeoutMs()).toBe(1500)
      for (const bad of ["", "abc", "-1", "0"]) {
        process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS = bad
        expect(resolveAskTimeoutMs()).toBe(DEFAULT_ASK_TIMEOUT_MS)
      }
    } finally {
      if (raw === undefined) delete process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
      else process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS = raw
    }
  })

  it("无人应答时先挂起、超时后自动清空，不再永久等待", async () => {
    const raw = process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
    process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS = "50"
    try {
      const observed = await withService(
        Effect.gen(function* () {
          const service = yield* Service
          yield* service.setMode("default")
          yield* Effect.forkScoped(service.ask(askInput()))
          yield* Effect.sleep("10 millis")
          const during = (yield* service.list()).length
          yield* Effect.sleep("300 millis")
          const after = (yield* service.list()).length
          return { during, after }
        }) as Effect.Effect<{ during: number; after: number }, unknown, Service>,
      )
      // 确实发起过一次询问
      expect(observed.during).toBe(1)
      // 超时后请求已被清理，ask 不再挂起——修复前这里会永久挂住
      expect(observed.after).toBe(0)
    } finally {
      if (raw === undefined) delete process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS
      else process.env.GYCCODE_PERMISSION_ASK_TIMEOUT_MS = raw
    }
  })
})