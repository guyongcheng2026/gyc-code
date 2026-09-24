// store.costStats 聚合回归（2026-09-24）：totalTokens 现含 session 表的
// tokens_cache_read/write 聚合——cost-advisor 的 cacheOpportunity 判定依赖此数据
// （修复前接口无 cache 字段，cacheRatio 无从计算只能恒 0）。
import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import { Database } from "../database/database"
import { ProjectTable } from "../project/sql"
import { ProjectV2 } from "../project"
import { SessionSchema } from "./schema"
import { AbsolutePath } from "../schema"
import { SessionTable } from "./sql"
import { SessionStore } from "./store"
import { LayerNode } from "../effect/layer-node"

const runWithStore = <A, E>(effect: Effect.Effect<A, E, SessionStore.Service | Database.Service>) => {
  const dbLayer = Database.layerFromPath(":memory:")
  // 用内存库替换 SessionStore.node 的 Database.node 依赖；同一 dbLayer 引用
  // 同时 merge 进环境供 seed 使用（layer 按引用 memo，共享同一实例）。
  // compile 后的 layer 构建含异步（sqlite 初始化）→ runPromise。
  const layer = Layer.merge(dbLayer, LayerNode.compile(SessionStore.node, [[Database.node, dbLayer]]))
  return Effect.runPromise(Effect.provide(effect, layer))
}

const projectID = ProjectV2.ID.make("prj_cost_stats")

test("costStats 聚合 tokens_cache_read/write", async () => {
  const stats = await runWithStore(
    Effect.gen(function* () {
      const { db } = yield* Database.Service
      const now = new Date().getTime()
      yield* db
        .insert(ProjectTable)
        .values({ id: projectID, worktree: AbsolutePath.make("/tmp/project"), sandboxes: [], name: "cost-stats" })
        .run()
      const row = (id: string, input: number, read: number, write: number, cost: number) => ({
        id: SessionSchema.ID.make(id),
        project_id: projectID,
        slug: id,
        directory: "/tmp/project",
        title: id,
        version: "0.0.0-test",
        cost,
        tokens_input: input,
        tokens_output: 10,
        tokens_reasoning: 5,
        tokens_cache_read: read,
        tokens_cache_write: write,
        time_created: now,
        time_updated: now,
      })
      yield* db
        .insert(SessionTable)
        .values([row("ses_cost_a", 1_000, 90_000, 9_000, 1), row("ses_cost_b", 2_000, 40_000, 0, 2)])
        .run()
      const store = yield* SessionStore.Service
      return yield* store.costStats()
    }),
  )
  expect(stats.sessionCount).toBe(2)
  expect(stats.totalTokens.input).toBe(3_000)
  expect(stats.totalTokens.cache).toEqual({ read: 130_000, write: 9_000 })
  expect(stats.totalCost).toBe(3)
})
