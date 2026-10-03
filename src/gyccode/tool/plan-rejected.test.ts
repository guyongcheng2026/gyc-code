import { describe, expect, test } from "bun:test"
import {
  planApproval,
  planMessagesFailureNotice,
  planRejectedNotice,
  planRejectedResult,
} from "./plan"

describe("plan 切换对话框被拒绝时的结构化回灌", () => {
  test("planApproval: 只有显式 Yes 才算同意，其余一律按拒绝处理", () => {
    expect(planApproval([["Yes"]])).toBe(true)
    expect(planApproval([["No"]])).toBe(false)
    expect(planApproval([["yes"]])).toBe(false)
    expect(planApproval([])).toBe(false)
    expect(planApproval(undefined)).toBe(false)
  })

  test("planRejectedNotice: 含取消语义与可行动提示", () => {
    const enter = planRejectedNotice("plan_enter")
    expect(enter).toContain('kind="user_rejected"')
    expect(enter).toContain("取消")
    expect(enter).toContain("接下来可以")

    const exit = planRejectedNotice("plan_exit")
    expect(exit).toContain('action="plan_exit"')
    expect(exit).toContain("取消")
  })

  test("planRejectedResult: 返回可用的工具结果对象，而不是抛出 defect", () => {
    let result: ReturnType<typeof planRejectedResult> | undefined
    expect(() => {
      result = planRejectedResult("plan_exit")
    }).not.toThrow()
    expect(result).toBeDefined()
    expect(result!.title.length).toBeGreaterThan(0)
    expect(result!.output).toContain("user_rejected")
    expect(result!.metadata.truncated).toBe(false)
  })

  test("planMessagesFailureNotice: 回灌可读诊断并带上失败原因", () => {
    const notice = planMessagesFailureNotice("session store unavailable")
    expect(notice).toContain("session store unavailable")
    expect(notice).toContain("读取会话历史失败")
    expect(notice).toContain("接下来可以")
  })
})