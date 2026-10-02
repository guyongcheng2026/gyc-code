import { describe, expect, it } from "bun:test"
import { Cause, Effect, Exit, Fiber, Layer } from "effect"
import { Service, layer } from "./index"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionID } from "@/session/schema"
import { PermissionV1 } from "@gyccode/core/v1/permission"
import type { PermissionMode } from "./modes"

/**
 * R-1（对标指标 22 · 权限与沙箱边界 · P0）
 *
 * PermissionService 此前连 mode 概念都没有，ask() 只看静态 ruleset。这里锁定
 * 接线后的裁决链路：
 *   plan              → 拒绝写/执行类权限（DeniedError，不挂起、不询问）
 *   bypassPermissions → 直通（不产生待处理请求）
 *   default           → 维持既有语义：ruleset 说 deny 就 deny，其余仍挂起询问
 *   acceptEdits       → edit/write 自动放行，bash 仍询问
 *
 * 另锁定一条保守约束：bypassPermissions 放行**不覆盖**用户显式写下的 deny 规则。
 */

// Permission 的 layer 唯一依赖是 EventV2Bridge；这里给一个只关心 publish 的桩。
const eventsStub = { publish: () => Effect.void, listen: () => Effect.void } as never

const stubLayer = Layer.succeed(EventV2Bridge.Service, eventsStub)
const testLayer = layer.pipe(Layer.provide(stubLayer))

function askInput(overrides: Partial<PermissionV1.AskInput> = {}): PermissionV1.AskInput {
  return {
    sessionID: SessionID.make("ses_mode"),
    permission: "edit",
    patterns: ["src/**"],
    metadata: {},
    always: ["src/**"],
    ruleset: [],
    ...overrides,
  }
}

/** 在装配好的 Permission 上跑一段程序。 */
const withService = <A, E>(program: Effect.Effect<A, E, Service>): Promise<A> =>
  // forkScoped 需要 Scope：ask() 挂起 Deferred 时会一直占用，故整段包在 scoped 里。
  // 注意 scoped 必须包住 Effect 本身，而不是包 runPromise 返回的 Promise。
  Effect.runPromise(Effect.scoped(program.pipe(Effect.provide(testLayer)) as Effect.Effect<A, E, never>))

/**
 * 跑一次 ask 并返回 Exit；对「会挂起等待人类」的分支用 fork + 轮询 pending
 * 判定，而不是靠超时——超时会把「询问了」和「卡死了」混为一谈。
 */
async function askAndSettle(input: PermissionV1.AskInput, mode?: PermissionMode) {
  return (await withService(
    Effect.gen(function* () {
      const service = yield* Service
      if (mode) yield* service.setMode(mode)
      const fiber = yield* Effect.forkScoped(service.ask(input))
      yield* Effect.sleep("10 millis")
      const pending = yield* service.list()
      // 仍挂起说明在等人工批准，此时 await fiber 会永久阻塞（测试直接挂到超时）。
      // 「是否挂起」本身就是判定依据，所以挂起分支不 await；未挂起才取 Exit。
      if (pending.length > 0) return { pending, exit: undefined }
      return { pending, exit: yield* Fiber.await(fiber) }
    }) as Effect.Effect<{ pending: ReadonlyArray<PermissionV1.Request>; exit: Exit.Exit<void, unknown> | undefined }, unknown, Service>,
  ))
}

describe("Permission 模式状态（R-1）", () => {
  it("默认模式为 default（未设置时不得默认绕过）", async () => {
    const mode = await withService(
      Effect.gen(function* () {
        const service = yield* Service
        return yield* service.mode()
    }),
    )
    expect(mode).toBe("default")
  })

  it("setMode / mode 成对生效", async () => {
    const result = await withService(
      Effect.gen(function* () {
        const service = yield* Service
        const before = yield* service.mode()
        yield* service.setMode("bypassPermissions")
        const during = yield* service.mode()
        yield* service.setMode("plan")
        const after = yield* service.mode()
        return { before, during, after }
    }),
    )
    expect(result).toEqual({ before: "default", during: "bypassPermissions", after: "plan" })
  })
})

describe("Permission.ask 裁决链路（R-1）", () => {
  it("plan 模式拒绝写操作：直接 DeniedError，不挂起、不询问", async () => {
    const { pending, exit } = await askAndSettle(askInput({ permission: "edit" }), "plan")
    expect(pending).toHaveLength(0)
    expect(exit).toBeDefined()
    expect(Exit.isFailure(exit!)).toBe(true)
    const error = Exit.isFailure(exit!) ? Cause.squash(exit!.cause) : undefined
    expect(error).toBeInstanceOf(PermissionV1.DeniedError)
    // 拒绝原因必须能回灌给模型，否则模型只会看到「用户拒绝了」而不知道为什么
    expect(String((error as PermissionV1.DeniedError).message)).toContain("plan")
  })

  it("plan 模式拒绝执行类权限（bash）", async () => {
    const { exit } = await askAndSettle(
      askInput({ permission: "bash", patterns: ["git *"], always: ["git *"] }),
      "plan",
    )
    expect(exit).toBeDefined()
    expect(Exit.isFailure(exit!)).toBe(true)
    expect(Exit.isFailure(exit!) ? Cause.squash(exit!.cause) : undefined).toBeInstanceOf(PermissionV1.DeniedError)
  })

  it("plan 模式不影响读权限：仍走既有询问链路", async () => {
    const { pending, exit } = await askAndSettle(askInput({ permission: "read" }), "plan")
    expect(pending).toHaveLength(1)
    // 挂起分支不取 Exit（await 会永久阻塞），exit 为 undefined 即「仍在等批准」
    expect(exit).toBeUndefined()
  })

  it("bypassPermissions 放行写操作：不产生待处理请求，直接成功", async () => {
    const { pending, exit } = await askAndSettle(askInput({ permission: "edit" }), "bypassPermissions")
    expect(pending).toHaveLength(0)
    expect(exit).toBeDefined()
    expect(Exit.isSuccess(exit!)).toBe(true)
  })

  it("bypassPermissions 放行执行类权限", async () => {
    const { pending, exit } = await askAndSettle(
      askInput({ permission: "bash", patterns: ["ls"], always: ["ls"] }),
      "bypassPermissions",
    )
    expect(pending).toHaveLength(0)
    expect(exit).toBeDefined()
    expect(Exit.isSuccess(exit!)).toBe(true)
  })

  it("bypassPermissions 不覆盖用户显式写下的 deny 规则（保守：宁可多问一次）", async () => {
    const { exit } = await askAndSettle(
      askInput({
        permission: "edit",
        ruleset: [{ permission: "edit", pattern: "src/**", action: "deny" }],
    }),
      "bypassPermissions",
    )
    expect(exit).toBeDefined()
    expect(Exit.isFailure(exit!)).toBe(true)
    expect(Exit.isFailure(exit!) ? Cause.squash(exit!.cause) : undefined).toBeInstanceOf(PermissionV1.DeniedError)
  })

  it("default 模式维持既有语义：ruleset 说 deny 就 deny", async () => {
    const { pending, exit } = await askAndSettle(
      askInput({
        permission: "edit",
        ruleset: [{ permission: "edit", pattern: "src/**", action: "deny" }],
    }),
      "default",
    )
    expect(pending).toHaveLength(0)
    expect(exit).toBeDefined()
    expect(Exit.isFailure(exit!)).toBe(true)
    expect(Exit.isFailure(exit!) ? Cause.squash(exit!.cause) : undefined).toBeInstanceOf(PermissionV1.DeniedError)
  })

  it("default 模式维持既有语义：无规则时仍挂起等待人类批准", async () => {
    const { pending, exit } = await askAndSettle(askInput(), "default")
    expect(pending).toHaveLength(1)
    expect(pending[0]?.permission).toBe("edit")
    expect(exit).toBeUndefined()
  })

  it("acceptEdits 自动放行 edit，但 bash 仍需询问", async () => {
    const edit = await askAndSettle(askInput({ permission: "edit" }), "acceptEdits")
    expect(edit.pending).toHaveLength(0)
    expect(Exit.isSuccess(edit.exit!)).toBe(true)

    const bash = await askAndSettle(
      askInput({ permission: "bash", patterns: ["ls"], always: ["ls"] }),
      "acceptEdits",
    )
    expect(bash.pending).toHaveLength(1)
    expect(bash.exit).toBeUndefined()
  })
})
