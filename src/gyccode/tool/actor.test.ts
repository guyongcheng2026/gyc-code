import { describe, expect, test } from "bun:test"
import { Schema } from "effect"
import { Parameters, parseActorScript } from "./actor"

const decode = (input: unknown): boolean => {
  const result = Schema.decodeUnknownOption(Parameters)(input) as { value?: unknown }
  return "value" in result
}

describe("actor Parameters Schema", () => {
  test("接受标准 JSON run 操作", () => {
    expect(decode({ operation: { action: "run", subagent_type: "general", description: "d", prompt: "p" } })).toBe(true)
  })

  test("接受可选字段（task_id/actor_id/timeout_ms）", () => {
    expect(
      decode({
        operation: {
          action: "run",
          subagent_type: "explore",
          description: "d",
          prompt: "p",
          task_id: "T4",
          actor_id: "ses_123",
          timeout_ms: 5000,
        },
      }),
    ).toBe(true)
  })

  test("接受 spawn/status/wait/cancel 操作", () => {
    for (const operation of [
      { action: "spawn", subagent_type: "general", description: "d", prompt: "p" },
      { action: "status", actor_id: "ses_1" },
      { action: "wait", actor_id: "ses_1", timeout_ms: 100 },
      { action: "cancel", actor_id: "ses_1" },
    ]) {
      expect(decode({ operation })).toBe(true)
    }
  })

  test("接受 send 操作（execute 阶段明确报不支持）", () => {
    expect(decode({ operation: { action: "send", to_actor_id: "x", content: "c" } })).toBe(true)
  })

  test("接受 shell 脚本字符串形态", () => {
    expect(decode({ operation: 'actor run general "d" "p" --task T3' })).toBe(true)
  })

  test("拒绝未知 action", () => {
    expect(decode({ operation: { action: "explode" } })).toBe(false)
  })

  test("拒绝缺失必需字段", () => {
    expect(decode({ operation: { action: "run", subagent_type: "general" } })).toBe(false)
  })
})

describe("actor shell 脚本解析", () => {
  test("run 基本形式 + --task 绑定", () => {
    const result = parseActorScript('actor run general "describe it" "do the work" --task T3')
    expect(result).toEqual({
      ok: true,
      op: { action: "run", subagent_type: "general", description: "describe it", prompt: "do the work", task_id: "T3" },
    })
  })

  test("spawn + --actor resume + --timeout", () => {
    const result = parseActorScript('actor spawn explore "d" "p" --actor ses_1 --timeout 30000')
    expect(result).toEqual({
      ok: true,
      op: { action: "spawn", subagent_type: "explore", description: "d", prompt: "p", actor_id: "ses_1" },
    })
  })

  test("引号内空白与转义双引号", () => {
    const result = parseActorScript('actor run general "desc \\"quoted\\" end" "line1\\nline2"')
    expect(result.ok).toBe(true)
    if (result.ok && result.op.action === "run") {
      expect(result.op.description).toBe('desc "quoted" end')
      expect(result.op.prompt).toBe("line1\\nline2")
    }
  })

  test("等号形式 flag", () => {
    const result = parseActorScript("actor run explore d p --task=T2.1")
    expect(result).toEqual({
      ok: true,
      op: { action: "run", subagent_type: "explore", description: "d", prompt: "p", task_id: "T2.1" },
    })
  })

  test("wait --timeout", () => {
    expect(parseActorScript("actor wait ses_9 --timeout 5000")).toEqual({
      ok: true,
      op: { action: "wait", actor_id: "ses_9", timeout_ms: 5000 },
    })
  })

  test("status/cancel 单参数", () => {
    expect(parseActorScript("actor status ses_1")).toEqual({ ok: true, op: { action: "status", actor_id: "ses_1" } })
    expect(parseActorScript("actor cancel ses_1")).toEqual({ ok: true, op: { action: "cancel", actor_id: "ses_1" } })
  })

  test("未知动词给出近似建议", () => {
    const result = parseActorScript('actor rn general "d" "p"')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("did you mean: run?")
  })

  test("send 明确不支持", () => {
    const result = parseActorScript('actor send ses_1 "hello"')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("not supported")
  })

  test("--output-schema 明确不支持", () => {
    const result = parseActorScript('actor run general "d" "p" --output-schema {}')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("output-schema")
  })

  test("非 actor 开头拒绝", () => {
    expect(parseActorScript('task run general "d" "p"').ok).toBe(false)
  })

  test("多行脚本拒绝", () => {
    expect(parseActorScript('actor status ses_1\nactor status ses_2').ok).toBe(false)
  })

  test("参数数量错误给出期望形式", () => {
    const result = parseActorScript('actor run general "only two"')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toContain("arity mismatch")
  })
})
