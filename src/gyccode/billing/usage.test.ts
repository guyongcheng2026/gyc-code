import { describe, expect, test } from "bun:test"
import { Effect, Layer, Option } from "effect"
import { HttpClient, HttpClientResponse } from "effect/unstable/http"
import { LayerNode } from "@gyccode/core/effect/layer-node"
import { httpClient } from "@gyccode/core/effect/app-node-platform"

import { Account } from "@/account/account"
import { AccountID, AccessToken, Info, OrgID } from "@/account/schema"
import { Usage } from "./usage"

const accountInfo = new Info({
  id: AccountID.make("u_test"),
  email: "t@example.com",
  url: "http://account.test",
  active_org_id: OrgID.make("org_test"),
})

const accessToken = AccessToken.make("tok_test")

function accountLayer(active: Option.Option<Info>) {
  const impl: Account.Interface = {
    active: () => Effect.succeed(active),
    activeOrg: () => Effect.succeed(Option.none()),
    list: () => Effect.succeed([]),
    orgsByAccount: () => Effect.succeed([]),
    remove: () => Effect.void,
    use: () => Effect.void,
    orgs: () => Effect.succeed([]),
    config: () => Effect.succeed(Option.none()),
    token: () => Effect.succeed(Option.some(accessToken)),
    login: () => Effect.die("unused"),
    poll: () => Effect.die("unused"),
  }
  return Layer.succeed(Account.Service, impl)
}

type Handler = (url: string) => Response

function httpLayer(handler: Handler, counter?: { calls: number }) {
  return Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request) => {
      if (counter) counter.calls += 1
      return Effect.succeed(HttpClientResponse.fromWeb(request, handler(request.url)))
    }),
  )
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } })

const usagePayload = {
  balance: 12.5,
  plan: "pro",
  planName: "专业版",
  monthlyQuota: 500,
  monthlyUsed: 100,
  resetAt: 1_800_000_000_000,
  utilization: 0.2,
}

function build(active: Option.Option<Info>, handler: Handler, counter?: { calls: number }) {
  return LayerNode.compile(Usage.node, [
    [Account.node, accountLayer(active)],
    [httpClient, httpLayer(handler, counter)],
  ])
}

describe("积分用量服务", () => {
  test("查询成功返回余额并缓存（5 分钟内不再请求）", async () => {
    const counter = { calls: 0 }
    const layer = build(Option.some(accountInfo), () => json(usagePayload), counter)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        const first = yield* usage.query()
        const second = yield* usage.query()
        return { first, second }
      }).pipe(Effect.provide(layer)),
    )

    expect(Option.isSome(result.first)).toBe(true)
    const first = Option.getOrThrowWith(result.first, () => new Error("expected Some"))
    expect(first.balance).toBe(12.5)
    expect(first.planName).toBe("专业版")
    expect(Option.isSome(result.second)).toBe(true)
    // 两次查询只应发一次 HTTP（第二次命中缓存）
    expect(counter.calls).toBe(1)
  })

  test("服务端返回 500 时降级为 none，不抛错", async () => {
    const layer = build(Option.some(accountInfo), () => new Response("boom", { status: 500 }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        return yield* usage.query()
      }).pipe(Effect.provide(layer)),
    )

    expect(Option.isNone(result)).toBe(true)
  })

  test("响应体结构不合法时降级为 none", async () => {
    const layer = build(Option.some(accountInfo), () => json({ unexpected: true }))

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        return yield* usage.query()
      }).pipe(Effect.provide(layer)),
    )

    expect(Option.isNone(result)).toBe(true)
  })

  test("未登录（无活跃账户）时返回 none 且不发请求", async () => {
    const counter = { calls: 0 }
    const layer = build(Option.none(), () => json(usagePayload), counter)

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        return yield* usage.query()
      }).pipe(Effect.provide(layer)),
    )

    expect(Option.isNone(result)).toBe(true)
    expect(counter.calls).toBe(0)
  })

  test("上报成功后缓存余额同步更新", async () => {
    const layer = build(Option.some(accountInfo), (url) => {
      if (url.endsWith("/api/usage/report")) return json({ balance: 12.43, monthlyUsed: 100, charged: 0.07 })
      return json(usagePayload)
    })

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        yield* usage.query()
        yield* usage.report({
          sessionID: "ses_test",
          stepID: "step_test",
          modelID: "provider/model",
          tokensInput: 100,
          tokensOutput: 50,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUSD: 0.01,
        })
        return yield* usage.query()
      }).pipe(Effect.provide(layer)),
    )

    expect(Option.isSome(result)).toBe(true)
    expect(Option.getOrThrowWith(result, () => new Error("expected Some")).balance).toBe(12.43)
  })

  test("上报失败不影响调用方（不抛错）", async () => {
    const layer = build(Option.some(accountInfo), () => new Response("boom", { status: 500 }))

    await Effect.runPromise(
      Effect.gen(function* () {
        const usage = yield* Usage.Service
        yield* usage.report({
          sessionID: "ses_test",
          stepID: "step_test",
          modelID: "provider/model",
          tokensInput: 1,
          tokensOutput: 1,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          costUSD: 0.01,
        })
      }).pipe(Effect.provide(layer)),
    )
  })
})
