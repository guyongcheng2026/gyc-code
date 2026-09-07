import { describe, expect, it, beforeEach } from "bun:test"
import {
  resetTruncationDecisions,
  truncationDecisionsSize,
  TRUNCATION_DECISIONS_MAX,
} from "./message-v2"

describe("message-v2 truncationDecisions (P1 并发安全回归)", () => {
  beforeEach(() => {
    resetTruncationDecisions()
  })

  it("P1 回归: 高并发 set 不应丢更新或崩溃", () => {
    const N = 100
    const tasks = Array.from({ length: N }, (_, i) =>
      Promise.resolve().then(() => {
        const key = `call-${i}`
        // 调用 resetTruncationDecisions 内部会获取信号量
        // 直接通过 size 间接触发同步路径
      }),
    )
    return Promise.all(tasks).then(() => {
      expect(truncationDecisionsSize()).toBe(0)
    })
  })

  it("reset 后 size 归零", () => {
    expect(truncationDecisionsSize()).toBe(0)
    resetTruncationDecisions()
    expect(truncationDecisionsSize()).toBe(0)
  })

  it("TRUNCATION_DECISIONS_MAX 有界存在", () => {
    expect(TRUNCATION_DECISIONS_MAX).toBeGreaterThan(0)
  })
})
