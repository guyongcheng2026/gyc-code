import { LayerNode } from "@gyccode/core/effect/layer-node"
import { httpClient } from "@gyccode/core/effect/app-node-platform"
import { Clock, Duration, Effect, Layer, Option, Ref, Schema, Context } from "effect"
import { serviceUse } from "@gyccode/core/effect/service-use"
import { HttpClient, HttpClientRequest, HttpClientResponse } from "effect/unstable/http"
import { logWarn } from "@gyccode/core/observability/log-error"

import { withTransientReadRetry } from "@/util/effect-http-client"
import { Account } from "@/account/account"

/**
 * 积分/用量服务（客户端侧只读消费者）
 *
 * 参照 Claude Code：客户端不扣费、不判断"还能不能跑"，只查询余额并异步上报用量。
 * 服务端不可达时一律静默降级（错误通道为 never），不阻断 LLM 主流程。
 */

/** 服务端 /api/usage 返回结构（字段与服务端 camelCase 对齐） */
export class UsageInfo extends Schema.Class<UsageInfo>("UsageInfo")({
  balance: Schema.Number,
  plan: Schema.String,
  planName: Schema.String,
  monthlyQuota: Schema.Number,
  monthlyUsed: Schema.Number,
  resetAt: Schema.Number,
  utilization: Schema.Number,
}) {}

/** 单步用量上报载荷（与服务端 /api/usage/report 对齐） */
export type UsageReport = {
  readonly sessionID: string
  readonly stepID: string
  readonly modelID: string
  readonly tokensInput: number
  readonly tokensOutput: number
  readonly tokensCacheRead: number
  readonly tokensCacheWrite: number
  readonly costUSD: number
}

class UsageReportRequest extends Schema.Class<UsageReportRequest>("UsageReportRequest")({
  session_id: Schema.String,
  step_id: Schema.String,
  model_id: Schema.String,
  tokens_input: Schema.Number,
  tokens_output: Schema.Number,
  tokens_cache_read: Schema.Number,
  tokens_cache_write: Schema.Number,
  cost_usd: Schema.Number,
}) {}

class UsageReportResult extends Schema.Class<UsageReportResult>("UsageReportResult")({
  balance: Schema.Number,
  monthlyUsed: Schema.Number,
  charged: Schema.Number,
  duplicate: Schema.optional(Schema.Boolean),
}) {}

export interface Interface {
  /** 查询余额/套餐/本月用量；未登录或服务端不可达时返回 none */
  readonly query: () => Effect.Effect<Option.Option<UsageInfo>>
  /** 异步上报单步用量；失败只记告警，不影响调用方 */
  readonly report: (input: UsageReport) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/Usage") {}

export const use = serviceUse(Service)

const CACHE_TTL_MS = Duration.toMillis(Duration.minutes(5))
const REQUEST_TIMEOUT = Duration.seconds(5)

const layer: Layer.Layer<Service, never, Account.Service | HttpClient.HttpClient> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const account = yield* Account.Service
    const http = yield* HttpClient.HttpClient
    const httpRead = withTransientReadRetry(http)

    // 显式缓存而非 Effect Cache：失败不写缓存，避免一次网络抖动让界面"离线"5 分钟
    const cache = yield* Ref.make(Option.none<{ readonly at: number; readonly info: UsageInfo }>())

    const resolveAccess = Effect.fnUntraced(function* () {
      const active = yield* account.active().pipe(Effect.orElseSucceed(() => Option.none()))
      if (Option.isNone(active)) return Option.none()
      const token = yield* account.token(active.value.id).pipe(Effect.orElseSucceed(() => Option.none()))
      if (Option.isNone(token)) return Option.none()
      return Option.some({ url: active.value.url, token: token.value })
    })

    const fetchUsage = Effect.fnUntraced(function* (url: string, token: string) {
      const response = yield* httpRead
        .execute(
          HttpClientRequest.get(`${url}/api/usage`).pipe(
            HttpClientRequest.acceptJson,
            HttpClientRequest.bearerToken(token),
          ),
        )
        .pipe(
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.orElseSucceed(() => undefined),
        )
      if (!response || response.status !== 200) return Option.none<UsageInfo>()

      const parsed = yield* HttpClientResponse.schemaBodyJson(UsageInfo)(response).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      return parsed ? Option.some(parsed) : Option.none<UsageInfo>()
    })

    const query = Effect.fn("Usage.query")(function* () {
      const now = yield* Clock.currentTimeMillis
      const cached = yield* Ref.get(cache)
      if (Option.isSome(cached) && now - cached.value.at < CACHE_TTL_MS) {
        return Option.some(cached.value.info)
      }

      const access = yield* resolveAccess()
      if (Option.isNone(access)) return Option.none<UsageInfo>()

      const info = yield* fetchUsage(access.value.url, access.value.token)
      if (Option.isSome(info)) {
        yield* Ref.set(cache, Option.some({ at: now, info: info.value }))
      } else {
        logWarn("usage.query", "查询积分余额失败，已降级为离线显示")
      }
      return info
    })

    const report = Effect.fn("Usage.report")(function* (input: UsageReport) {
      const access = yield* resolveAccess()
      if (Option.isNone(access)) return

      const response = yield* HttpClientRequest.post(`${access.value.url}/api/usage/report`)
        .pipe(
          HttpClientRequest.acceptJson,
          HttpClientRequest.bearerToken(access.value.token),
          HttpClientRequest.schemaBodyJson(UsageReportRequest)(
            new UsageReportRequest({
              session_id: input.sessionID,
              step_id: input.stepID,
              model_id: input.modelID,
              tokens_input: input.tokensInput,
              tokens_output: input.tokensOutput,
              tokens_cache_read: input.tokensCacheRead,
              tokens_cache_write: input.tokensCacheWrite,
              cost_usd: input.costUSD,
            }),
          ),
        )
        .pipe(
          Effect.flatMap((req) => httpRead.execute(req)),
          Effect.timeout(REQUEST_TIMEOUT),
          Effect.orElseSucceed(() => undefined),
        )
      if (!response || response.status !== 200) {
        logWarn("usage.report", "上报用量失败，已忽略", { "session.id": input.sessionID })
        return
      }

      const parsed = yield* HttpClientResponse.schemaBodyJson(UsageReportResult)(response).pipe(
        Effect.orElseSucceed(() => undefined),
      )
      if (!parsed) return

      // 上报成功后把最新余额写回缓存，避免下次查询拿到过期值
      const previous = yield* Ref.get(cache)
      if (Option.isNone(previous)) return
      yield* Ref.set(
        cache,
        Option.some({
          at: previous.value.at,
          info: new UsageInfo({
            ...previous.value.info,
            balance: parsed.balance,
            monthlyUsed: parsed.monthlyUsed,
          }),
        }),
      )
    })

    return Service.of({ query, report })
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [Account.node, httpClient] })

export * as Usage from "./usage"
