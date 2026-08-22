import { LayerNode } from "@gyccode/core/effect/layer-node"
import { Effect, Layer, Context, Schema } from "effect"
import { LSP } from "@/lsp/lsp"

// ─── 诊断记录 ─────────────────────────────────────────────────

export const DiagnosticRecord = Schema.Struct({
  file: Schema.String,
  timestamp: Schema.Number,
  severity: Schema.Literals(["error", "warning", "info", "hint"]),
  count: Schema.Number,
  source: Schema.optional(Schema.String),
})
export type DiagnosticRecord = Schema.Schema.Type<typeof DiagnosticRecord>

// ─── 诊断摘要 ─────────────────────────────────────────────────

export const DiagnosticSummary = Schema.Struct({
  totalFiles: Schema.Number,
  totalIssues: Schema.Number,
  bySeverity: Schema.Record(Schema.String, Schema.Number),
  topFiles: Schema.Array(Schema.Struct({
    file: Schema.String,
    count: Schema.Number,
  })),
  recentRecords: Schema.Array(DiagnosticRecord),
})
export type DiagnosticSummary = Schema.Schema.Type<typeof DiagnosticSummary>

// ─── 服务接口 ─────────────────────────────────────────────────

export interface Interface {
  readonly track: (file: string, diagnostics: Record<string, unknown[]>) => Effect.Effect<void>
  readonly summary: () => Effect.Effect<DiagnosticSummary>
  readonly clear: () => Effect.Effect<void>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/DiagnosticTracking") {}

// ─── 内存存储 ─────────────────────────────────────────────────

const MAX_RECORDS = 500

interface TrackingState {
  records: DiagnosticRecord[]
  byFile: Map<string, number>
  bySeverity: Map<string, number>
  totalIssues: number
}

const state: TrackingState = {
  records: [],
  byFile: new Map(),
  bySeverity: new Map(),
  totalIssues: 0,
}

function classifySeverity(issues: unknown[]): "error" | "warning" | "info" | "hint" {
  let hasError = false
  let hasWarning = false
  let hasInfo = false
  for (const issue of issues) {
    const sev = (issue as { severity?: number }).severity
    if (sev === 1 || sev === 8) hasError = true
    else if (sev === 2) hasWarning = true
    else if (sev === 3 || sev === 4) hasInfo = true
  }
  if (hasError) return "error"
  if (hasWarning) return "warning"
  if (hasInfo) return "info"
  return "hint"
}

// ─── Layer 实现 ───────────────────────────────────────────────

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const _lsp = yield* LSP.Service

    const track = Effect.fn("DiagnosticTracking.track")(function* (
      file: string,
      diagnostics: Record<string, unknown[]>,
    ) {
      const issues = diagnostics[file] ?? []
      if (issues.length === 0) return

      const severity = classifySeverity(issues)
      const record: DiagnosticRecord = {
        file,
        timestamp: Date.now(),
        severity,
        count: issues.length,
      }

      // LRU 式淘汰
      if (state.records.length >= MAX_RECORDS) {
        const oldest = state.records.shift()
        if (oldest) {
          const count = state.byFile.get(oldest.file)
          if (count !== undefined && count > oldest.count) {
            state.byFile.set(oldest.file, count - oldest.count)
          } else {
            state.byFile.delete(oldest.file)
          }
          const sevCount = state.bySeverity.get(oldest.severity)
          if (sevCount !== undefined && sevCount > 1) {
            state.bySeverity.set(oldest.severity, sevCount - 1)
          }
          state.totalIssues -= oldest.count
        }
      }

      state.records.push(record)
      state.byFile.set(file, (state.byFile.get(file) ?? 0) + issues.length)
      state.bySeverity.set(severity, (state.bySeverity.get(severity) ?? 0) + 1)
      state.totalIssues += issues.length
    })

    const summary = Effect.fn("DiagnosticTracking.summary")(function* () {
      const topFiles = Array.from(state.byFile.entries())
        .map(([file, count]) => ({ file, count }))
        .sort((a, b) => b.count - a.count)
        .slice(0, 10)
      return {
        totalFiles: state.byFile.size,
        totalIssues: state.totalIssues,
        bySeverity: Object.fromEntries(state.bySeverity),
        topFiles,
        recentRecords: state.records.slice(-20),
      }
    })

    const clear = Effect.fn("DiagnosticTracking.clear")(function* () {
      state.records = []
      state.byFile.clear()
      state.bySeverity.clear()
      state.totalIssues = 0
    })

    return Service.of({ track, summary, clear })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [LSP.node],
})

export * as DiagnosticTracking from "./diagnostic-tracking"
