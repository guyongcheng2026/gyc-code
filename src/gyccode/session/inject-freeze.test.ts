// 注入快照会话级冻结：date/记忆/画像在会话首轮定型后不再重算，
// 保证第一条 user 消息跨轮字节 100% 稳定（CH 前缀不折断）。
import { describe, expect, test } from "bun:test"
import { freezeInject, type InjectSnapshot } from "./inject-freeze"

describe("freezeInject（注入快照会话级冻结）", () => {
  test("同会话二次调用不再执行 compute：即使记忆/日期已变化，字节与首轮一致", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    let computes = 0
    const first = freezeInject(snapshots, "s1", () => {
      computes++
      return { date: "Today's date: 2026-09-24\n", memories: "<m>fact A</m>" }
    })
    // 模拟：记忆库更新 + 跨天后，实时重算会得到不同内容（旧实现每轮重算 → 前缀折断）
    const second = freezeInject(snapshots, "s1", () => {
      computes++
      return { date: "Today's date: 2026-09-25\n", memories: "<m>fact B</m>" }
    })
    expect(computes).toBe(1)
    expect(second.date).toBe(first.date)
    expect(second.memories).toBe(first.memories)
  })

  test("不同会话独立冻结", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    freezeInject(snapshots, "s1", () => ({ date: "d1", memories: "m1" }))
    const other = freezeInject(snapshots, "s2", () => ({ date: "d2", memories: "m2" }))
    expect(other).toEqual({ date: "d2", memories: "m2" })
    expect(snapshots.size).toBe(2)
  })

  test("memories 为 undefined（无记忆）也冻结，后续有记忆也不回填", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    freezeInject(snapshots, "s1", () => ({ date: "d", memories: undefined }))
    const again = freezeInject(snapshots, "s1", () => ({ date: "d", memories: "late" }))
    expect(again.memories).toBeUndefined()
  })

  test("超上限淘汰最旧会话（有界内存）", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    const max = 3 // 用注入的小上限不可行——测试真实上限：循环 1001 次
    void max
    let firstKey = ""
    for (let i = 0; i < 1001; i++) {
      const key = `s${i}`
      if (i === 0) firstKey = key
      freezeInject(snapshots, key, () => ({ date: "d", memories: undefined }))
    }
    expect(snapshots.size).toBeLessThanOrEqual(1000)
    expect(snapshots.has(firstKey)).toBe(false)
  })
})
