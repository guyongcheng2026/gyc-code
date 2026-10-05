import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import {
  TERMINAL_REASONS,
  TerminalReason,
  buildExecutionReport,
  classifyTerminalReason,
  describeTerminalReason,
  formatExecutionReport,
  type TerminalState,
} from "./execution-report"

/**
 * R-5：会话执行报告。会话跑完后必须能回答「这次为什么停、跑了多少步、耗了多少」。
 *
 * 零表改动方案：终止原因复用 assistant 消息已持久化的 `finish` / `error.name`
 * （schema/v1/session.ts:494 与 :470，整条消息以 JSON 存在 message.data，
 * 见 core/database/schema.gen.ts:135-142），成本与 token 复用 session 表累计列
 * （core/session/sql.ts:42-47），步数复用每步发布一次的 SessionEvent.Step.Ended
 * （core/session/runner/llm.ts:350-361）。因此本模块不得出现任何建表语句。
 *
 * 这里锁住两件事：终止原因判定（可单测纯函数）与接线（主循环控制流未被改动）。
 */

const usage = {
  cost: 0.0123,
  tokens: { input: 1200, output: 340, reasoning: 56, cache: { read: 800, write: 64 } },
}

const state = (over: Partial<TerminalState> = {}): TerminalState => ({
  steps: 3,
  needsContinuation: false,
  pendingInput: false,
  ...over,
})

describe("终止原因判定", () => {
  test("正常完成：无工具调用且无待处理输入", () => {
    expect(classifyTerminalReason(state())).toBe("completed")
    // llm.ts:512 以 needsContinuation=false 且 provider 无错表示本轮自然收敛
    expect(classifyTerminalReason(state({ steps: 1 }))).toBe("completed")
  })

  test("达到最大步数：步数抵达 agent 上限", () => {
    // llm.ts:226 isLastStep → llm.ts:237 toolChoice="none" → llm.ts:270 工具被停用
    const reached = state({ steps: 8, maxSteps: 8 })
    expect(classifyTerminalReason(reached)).toBe("max_steps")
    expect(describeTerminalReason(reached)).toContain("最大步数")
  })

  test("未达上限不算 max_steps", () => {
    expect(classifyTerminalReason(state({ steps: 7, maxSteps: 8 }))).toBe("completed")
    // agent.info.steps 缺省时无上限可言
    expect(classifyTerminalReason(state({ steps: 99 }))).toBe("completed")
  })

  test("权限拒绝中止", () => {
    // llm.ts:322-326 isUserDeclined(settled.cause) → Effect.interrupt
    // 判据见 llm.ts:163-168（PermissionV2.DeclinedError / QuestionV2.RejectedError）
    expect(classifyTerminalReason(state({ permissionDenied: true }))).toBe("permission_denied")
    expect(describeTerminalReason(state({ permissionDenied: true }))).toContain("权限")
  })

  test("provider 错误", () => {
    // llm.ts:316-319 与 llm.ts:505-512，hasProviderError 由 provider-error 事件置位
    const failed = state({ providerError: true, errorName: "APIError" })
    expect(classifyTerminalReason(failed)).toBe("provider_error")
    expect(describeTerminalReason(failed)).toContain("提供方")
  })

  test("用户中断", () => {
    // llm.ts:320 / llm.ts:328-335 的 Cause.hasInterrupts 与 Effect.interrupt
    const interrupted = state({ interrupted: true })
    expect(classifyTerminalReason(interrupted)).toBe("user_interrupted")
    expect(describeTerminalReason(interrupted)).toContain("中断")
  })

  test("unknown 兜底：没有任何终止信号", () => {
    // 还可能有待处理输入、或者最后一条 assistant 消息缺失导致无从判定
    expect(classifyTerminalReason(state({ needsContinuation: true }))).toBe("unknown")
    expect(classifyTerminalReason(state({ pendingInput: true }))).toBe("unknown")
    expect(describeTerminalReason(state({ needsContinuation: true }))).toContain("无法")
  })

  test("unknown 兜底：预算超限不构成终止原因（不得臆造）", () => {
    // 依据 src/core/config.ts:120：超预算只 publish Budget.Warning，不 halt run；
    // src/core/config/quota-alert.ts:4 佐证预算分支只做告警判定。
    const overBudget = state({ budgetExceeded: true, needsContinuation: true })
    expect(classifyTerminalReason(overBudget)).toBe("unknown")
    // 枚举里根本没有 budget_exceeded 这个位
    expect(TERMINAL_REASONS).not.toContain("budget_exceeded")
    expect(TERMINAL_REASONS).toEqual([
      "completed",
      "max_steps",
      "permission_denied",
      "provider_error",
      "user_interrupted",
      "unknown",
    ])
  })

  test("持久化 error.name 可还原终止原因（零表改动读取路径）", () => {
    // message.data 里 assistant.error.name，见 src/schema/v1/session.ts:43-63
    expect(classifyTerminalReason(state({ errorName: "MessageAbortedError" }))).toBe("user_interrupted")
    expect(classifyTerminalReason(state({ errorName: "ProviderAuthError" }))).toBe("provider_error")
    expect(classifyTerminalReason(state({ errorName: "ContextOverflowError" }))).toBe("provider_error")
    expect(classifyTerminalReason(state({ errorName: "ContentFilterError" }))).toBe("provider_error")
  })

  test("优先级：实时信号 > 持久化 error.name > 步数上限", () => {
    expect(classifyTerminalReason(state({ interrupted: true, errorName: "APIError" }))).toBe("user_interrupted")
    expect(classifyTerminalReason(state({ permissionDenied: true, providerError: true }))).toBe("permission_denied")
    expect(classifyTerminalReason(state({ providerError: true, errorName: "MessageAbortedError" }))).toBe("provider_error")
    expect(classifyTerminalReason(state({ errorName: "APIError", steps: 8, maxSteps: 8 }))).toBe("provider_error")
  })
})

describe("面向用户的中文说明", () => {
  /** 每种原因各配一个必然被判成它的终止状态，保证文案覆盖到全部枚举值。 */
  const samples: readonly (readonly [TerminalReason, TerminalState])[] = [
    ["completed", state()],
    ["max_steps", state({ steps: 8, maxSteps: 8 })],
    ["permission_denied", state({ permissionDenied: true })],
    ["provider_error", state({ providerError: true, errorName: "APIError" })],
    ["user_interrupted", state({ interrupted: true })],
    ["unknown", state({ needsContinuation: true })],
  ]

  test("枚举、判定与文案三者一一对应", () => {
    expect(samples.map(([reason]) => reason)).toEqual([...TERMINAL_REASONS])
    const texts = new Set<string>()
    for (const [reason, sample] of samples) {
      expect(classifyTerminalReason(sample)).toBe(reason)
      const text = describeTerminalReason(sample)
      expect(text).toMatch(/[\u4e00-\u9fa5]/)
      expect(text.length).toBeGreaterThan(6)
      texts.add(text)
    }
    expect(texts.size).toBe(TERMINAL_REASONS.length)
  })

  test("文案点名根因而不是笼统的「已结束」", () => {
    expect(describeTerminalReason(state())).toContain("正常完成")
    expect(describeTerminalReason(state({ maxSteps: 8, steps: 8 }))).toContain("8")
    expect(describeTerminalReason(state({ interrupted: true }))).toContain("中断")
    expect(describeTerminalReason(state({ providerError: true, errorName: "APIError" }))).toContain("APIError")
    for (const [, sample] of samples) expect(describeTerminalReason(sample)).not.toBe("已结束")
  })
})

describe("执行报告汇总", () => {
  test("汇总步数、终止原因、成本与 token", () => {
    const report = buildExecutionReport({ ...state(), usage })
    expect(report.steps).toBe(3)
    expect(report.terminalReason).toBe("completed")
    expect(report.usage.cost).toBe(0.0123)
    expect(report.usage.tokens.input).toBe(1200)
    expect(report.usage.tokens.cache.write).toBe(64)
    expect(report.summary).toBe(describeTerminalReason(state()))
  })

  test("格式化后一行讲清步数、原因与花费", () => {
    const line = formatExecutionReport(buildExecutionReport({ ...state(), usage }))
    expect(line).toContain("3")
    expect(line).toContain("正常完成")
    expect(line).toContain("$0.012300")
    expect(line).toContain("1200")
    expect(line).toContain("340")
  })

  test("终止原因类型是只读枚举，不是任意字符串", () => {
    const report = buildExecutionReport({ ...state({ providerError: true }), usage })
    expect(TerminalReason.ProviderError).toBe("provider_error")
    expect(report.terminalReason).toBe("provider_error")
  })
})

describe("接线：零表改动 + 主循环控制流未被改动", () => {
  const repo = (rel: string) => path.join(import.meta.dir, "..", "..", "..", rel)

  test("llm.ts 主循环控制流逐行保持原样", () => {
    const source = readFileSync(path.join(import.meta.dir, "runner", "llm.ts"), "utf8")
    // 这些行是 R-5 之前就存在的控制流，实现只允许在其结束处追加纯上报
    expect(source).toContain("while (needsContinuation) {")
    expect(source).toContain("const result = yield* runTurn(input.sessionID, promotion, step)")
    expect(source).toContain("needsContinuation = result.needsContinuation")
    expect(source).toContain("step = result.step + 1")
    expect(source).toContain(`if (!needsContinuation) needsContinuation = yield* SessionInput.hasPending(db, input.sessionID, "steer")`)
    expect(source).toContain(`shouldRun = yield* SessionInput.hasPending(db, input.sessionID, "queue")`)
    // 上报不得写成任何分支条件
    expect(source).not.toMatch(/if\s*\([^)]*executionReport/)
    expect(source).not.toMatch(/\?\s*executionReport/)
  })

  test("llm.ts 确实接上了执行报告，且只在 run() 结束处上报一次", () => {
    const source = readFileSync(path.join(import.meta.dir, "runner", "llm.ts"), "utf8")
    expect(source).toContain("from \"../execution-report\"")
    expect(source).toContain("buildExecutionReport")
    expect(source).toContain("session execution report")
    const calls = source.match(/yield\* Effect\.logInfo\(\s*"session execution report"/g) ?? []
    expect(calls.length).toBe(1)
    // 上报必须紧贴 return，且 return 本身一字未改
    const reportIndex = source.indexOf('"session execution report"')
    const returnIndex = source.indexOf(
      "return { needsContinuation: !publisher.hasProviderError() && needsContinuation, step: currentStep }",
    )
    expect(reportIndex).toBeGreaterThan(-1)
    expect(returnIndex).toBeGreaterThan(reportIndex)
  })

  test("执行报告模块是纯函数、无建表语句", () => {
    const source = readFileSync(path.join(import.meta.dir, "execution-report.ts"), "utf8")
    expect(source).not.toContain("CREATE TABLE")
    expect(source).not.toContain("sqliteTable")
    expect(source).not.toContain("import ")
  })

  test("没有为执行报告新建表或迁移", () => {
    const schemaGen = readFileSync(repo("src/core/database/schema.gen.ts"), "utf8")
    const migrationGen = readFileSync(repo("src/core/database/migration.gen.ts"), "utf8")
    expect(schemaGen).not.toContain("execution_report")
    expect(migrationGen).not.toContain("execution_report")
  })
})
