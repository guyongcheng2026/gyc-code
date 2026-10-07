import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, HttpApiError, OpenApi } from "effect/unstable/httpapi"

export const HealthGroup = HttpApiGroup.make("server.health").add(
  HttpApiEndpoint.get("health.get", "/api/health", {
    success: Schema.Struct({ healthy: Schema.Literal(true) }),
    // P1-3：探活失败走 503 而不是把 success schema 放宽成 boolean ——
    // 这样 200 恒等于「真的健康」，且不必改产物 types.gen.ts（禁手改）。
    error: HttpApiError.ServiceUnavailable,
  }).annotateMerge(
    OpenApi.annotations({
      identifier: "v2.health.get",
      summary: "Check server health",
      description: "Check whether the API server is ready to accept requests.",
    }),
  ),
)
