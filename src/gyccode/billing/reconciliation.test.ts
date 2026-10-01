import { describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { reconcile, formatReport } from "./reconciliation"
import { BillingUnavailable, get, listAll, register, registered } from "./provider-billing"

/**
 * C-04：核销的前提是能算出差额。以前只会把一个数字标成「估算」或「provider 报」，
 * 两个数字之间的差从来没被摆到同一张表上——于是账单来了也看不出差在哪。
 */

const at = (ms: number) => ({ startTime: ms - 1000, endTime: ms + 1000 })

describe("reconcile 逐行对账", () => {
  test("两侧一致时 drift 为 0 且不标记超阈值", () => {
    const report = reconcile([{ key: "s1", amount: 10 }], [{ key: "s1", amount: 10 }])
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]!.drift).toBeCloseTo(0, 10)
    expect(report.rows[0]!.mismatched).toBe(false)
    expect(report.mismatchedCount).toBe(0)
    expect(report.missingProvider).toBe(0)
  })

  test("drift 超过 1% 阈值即标记 —— 这是核销失败，必须看得见", () => {
    const report = reconcile([{ key: "s1", amount: 1 }], [{ key: "s1", amount: 1.05 }])
    expect(report.rows[0]!.mismatched).toBe(true)
    expect(report.rows[0]!.driftRatio).toBeCloseTo(0.05 / 1.05, 10)
    expect(report.mismatchedCount).toBe(1)
    expect(report.totalDrift).toBeCloseTo(0.05, 10)
  })

  test("阈值以下的浮点抖动不算分叉", () => {
    // 逐条累加产生的舍入噪声：$10 上差 $0.005（0.05%）
    const report = reconcile([{ key: "s1", amount: 10 }], [{ key: "s1", amount: 10.005 }])
    expect(report.rows[0]!.mismatched).toBe(false)
  })

  test("只有本地没有账单时不算 mismatch，而是单独记为缺账单", () => {
    const report = reconcile([{ key: "s1", amount: 3 }], [])
    expect(report.rows[0]!.provider).toBeNull()
    expect(report.rows[0]!.drift).toBeNull()
    // 缺账单不是「对上了」——否则报表会假装已核销
    expect(report.rows[0]!.mismatched).toBe(false)
    expect(report.missingProvider).toBe(1)
  })

  test("有账单但本地漏记时显式暴露，local 记 0", () => {
    const report = reconcile([], [{ key: "s1", amount: 5 }])
    expect(report.rows[0]!.local).toBe(0)
    expect(report.rows[0]!.drift).toBeCloseTo(5, 10)
    expect(report.rows[0]!.mismatched).toBe(true)
  })

  test("同一 key 的多条流水先聚合再比，不按行数误报", () => {
    const report = reconcile(
      [
        { key: "s1", amount: 1 },
        { key: "s1", amount: 2 },
      ],
      [{ key: "s1", amount: 3 }],
    )
    expect(report.rows).toHaveLength(1)
    expect(report.rows[0]!.local).toBeCloseTo(3, 10)
    expect(report.rows[0]!.mismatched).toBe(false)
  })

  test("provider 金额为 0 时 driftRatio 不除零", () => {
    const report = reconcile([{ key: "s1", amount: 0 }], [{ key: "s1", amount: 0 }])
    expect(report.rows[0]!.driftRatio).toBe(0)
    expect(report.rows[0]!.mismatched).toBe(false)
  })

  test("两侧合计分别汇总，可直接核销总额", () => {
    const report = reconcile(
      [
        { key: "s1", amount: 1 },
        { key: "s2", amount: 2 },
      ],
      [
        { key: "s1", amount: 1 },
        { key: "s2", amount: 4 },
      ],
    )
    expect(report.totalLocal).toBeCloseTo(3, 10)
    expect(report.totalProvider).toBeCloseTo(5, 10)
    expect(report.totalDrift).toBeCloseTo(2, 10)
  })
})

describe("formatReport 报表输出", () => {
  test("把缺账单与超阈值分别标出来，不让两者混为一谈", () => {
    const report = reconcile(
      [
        { key: "s1", amount: 1 },
        { key: "s2", amount: 3 },
      ],
      [{ key: "s1", amount: 1.5 }],
    )
    const text = formatReport(report)
    expect(text).toContain("缺账单")
    expect(text).toContain("超阈值")
    expect(text).toContain("s2")
  })

  test("行数超限时给出截断提示，而不是静默截断", () => {
    const local = Array.from({ length: 5 }, (_, i) => ({ key: `s${i}`, amount: 1 }))
    const text = formatReport(reconcile(local, local), 2)
    expect(text).toContain("另有 3 行未显示")
  })

  test("两侧皆空时如实说明，而不是打印一张全 0 的表", () => {
    expect(formatReport(reconcile([], []))).toContain("无对账数据")
  })
})

describe("provider 账单注册表", () => {
  test("取不到账单与账单为空是两种语义，必须分开", async () => {
    register({
      providerID: "test-empty",
      list: () => Effect.succeed([]),
    })
    expect(await Effect.runPromise(listAll(at(0)))).toEqual([])

    register({
      providerID: "test-missing",
      list: () => Effect.fail(new BillingUnavailable("test-missing", "未配置凭据")),
    })
    await expect(Effect.runPromise(listAll({ ...at(0), providerIDs: ["test-missing"] }))).rejects.toThrow(
      "未配置凭据",
    )
  })

  test("多 provider 的 key 加上 provider 前缀，避免不同家撞键", async () => {
    register({ providerID: "p1", list: () => Effect.succeed([]) })
    register({
      providerID: "p2",
      list: () =>
        Effect.succeed([
          {
            time: 0,
            providerID: "p2",
            modelID: "m",
            inputTokens: 0,
            outputTokens: 0,
            cacheReadTokens: 0,
            cacheWriteTokens: 0,
            costUSD: 1,
            key: "same",
          },
        ]),
    })
    const entries = await Effect.runPromise(listAll({ ...at(0), providerIDs: ["p2"] }))
    expect(entries[0]!.key).toBe("p2:same")
  })

  test("未知 provider 返回 undefined 而非报错，便于可选接入", () => {
    expect(get("never-registered")).toBeUndefined()
    expect(registered()).toContain("p1")
  })
})