import { LayerNode } from "@gyccode/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { EventV2Bridge } from "@/event-v2-bridge"
import { Session } from "@/session/session"

// ─── 工具使用记录 ─────────────────────────────────────────────

export const ToolUseRecord = Schema.Struct({
  tool: Schema.String,
  sessionID: Schema.String,
  callID: Schema.optional(Schema.String),
  timestamp: Schema.Number,
  duration: Schema.optional(Schema.Number),
  success: Schema.Boolean,
  args: Schema.optional(Schema.UnknownRecord),
})
export type ToolUseRecord = Schema.Schema.Type<typeof ToolUseRecord>

// ─── 工具使用摘要 ─────────────────────────────────────────────

export const ToolUseSummary = Schema.Struct({
  sessionID: Schema.String,
  totalCalls: Schema.Number,
  byTool: Schema.Record(Schema.String, Schema.Number),
  successRate: Schema.Number,
  avgDurationMs: Schema.optional(Schema.Number),
  topTools: Schema.Array(Schema.Struct({
    tool: Schema.String,
    count: Schema.Number,
  })),
})
export type ToolUseSummary = Schema.Schema.Type<typeof ToolUseSummary>

// ─── 服务接口 ─────────────────────────────────────────────────

export interface Interface {
  readonly record: (record: ToolUseRecord) => Effect.Effect<void>
  readonly summary: (sessionID: string) => Effect.Effect<ToolUseSummary>
  readonly clear: (sessionID: string) => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/ToolUseSummary") {}

// ─── 内存存储 ─────────────────────────────────────────────────

const MAX_RECORDS_PER_SESSION = 1000

interface SessionData {
  records: ToolUseRecord[]
  byTool: Map<string, number>
  totalCalls: number
  successCount: number
  totalDuration: number
  durationCount: number
}

function newSessionData(): SessionData {
  return {
    records: [],
    byTool: new Map(),
    totalCalls: 0,
    successCount: 0,
    totalDuration: 0,
    durationCount: 0,
  }
}

const sessions = new Map<string, SessionData>()

// ─── Layer 实现 ───────────────────────────────────────────────

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service

    // 订阅工具执行事件（通过 EventV2Bridge 的事件流）
    // 注意：tool.execute.before/after 是 plugin.trigger 事件，
    // 这里通过 Session 事件流间接追踪

    const record = Effect.fn("ToolUseSummary.record")(function* (rec: ToolUseRecord) {
      let data = sessions.get(rec.sessionID)
      if (!data) {
        data = newSessionData()
        sessions.set(rec.sessionID, data)
      }
      // LRU 式淘汰：超过上限时删除最旧记录
      if (data.records.length >= MAX_RECORDS_PER_SESSION) {
        const oldest = data.records.shift()
        if (oldest) {
          const count = data.byTool.get(oldest.tool)
          if (count !== undefined && count > 1) {
            data.byTool.set(oldest.tool, count - 1)
          } else {
            data.byTool.delete(oldest.tool)
          }
          data.totalCalls--
          if (oldest.success) data.successCount--
          if (oldest.duration !== undefined) {
            data.totalDuration -= oldest.duration
            data.durationCount--
          }
        }
      }
      data.records.push(rec)
      data.totalCalls++
      if (rec.success) data.successCount++
      if (rec.duration !== undefined) {
        data.totalDuration += rec.duration
        data.durationCount++
      }
      data.byTool.set(rec.tool, (data.byTool.get(rec.tool) ?? 0) + 1)
    })

    const summary = Effect.fn("ToolUseSummary.summary")(function* (sessionID: string) {
      const data = sessions.get(sessionID) ?? newSessionData()
      const topTools = Array.from(data.byTool.entries())
        .map(([tool, count]) => ({ tool, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
      return {
        sessionID,
        totalCalls: data.totalCalls,
        byTool: Object.fromEntries(data.byTool),
        successRate: data.totalCalls > 0 ? data.successCount / data.totalCalls : 0,
        avgDurationMs: data.durationCount > 0 ? data.totalDuration / data.durationCount : undefined,
        topTools,
      }
    })

    const clear = Effect.fn("ToolUseSummary.clear")(function* (sessionID: string) {
      sessions.delete(sessionID)
    })

    return Service.of({ record, summary, clear })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [EventV2Bridge.node, Session.node],
})

export * as ToolUseSummary from "./tool-use-summary"
