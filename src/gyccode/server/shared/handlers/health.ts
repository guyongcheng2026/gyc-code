import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { Database } from "@gyccode/core/database/database"
import { EventSequenceTable } from "@gyccode/core/event/sql"
import { Api } from "../api"

// P1-3：健康检查必须真实探活。此前只 Effect.succeed({ healthy: true })，
// 对外永远返回绿灯，作为探针是误导性的。
// 探针走同步 SQLite 查询（与同层 fence.ts 同一 db 形状），不 fork、不等网络，
// 因此端点自身不会成为新的挂起源；失败一律降级为 503，不抛未声明异常。
export const HealthHandler = HttpApiBuilder.group(Api, "server.health", (handlers) =>
  Effect.gen(function* () {
    const { db } = yield* Database.Service

    return handlers.handle("health.get", () =>
      Effect.sync(() => {
        db.select().from(EventSequenceTable).limit(1).all()
      }).pipe(
        // catchCause 同时覆盖 typed failure 与 defect（同步查询抛错是 defect）
        Effect.catchCause(() => Effect.fail(new HttpApiError.ServiceUnavailable({}))),
        Effect.map(() => ({ healthy: true as const })),
      ),
    )
  }),
)
