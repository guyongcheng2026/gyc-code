// 注入快照会话级冻结：date/记忆/画像在会话首轮定型后不再重算，
// 保证第一条 user 消息跨轮字节 100% 稳定（CH 前缀不折断）。
// date 例外：跨天单独滚动更新（跨天折断一次是原设计已接受的代价）。
import { describe, expect, test } from "bun:test"
import { freezeInject, injectSnapshots, dropInjectSnapshot, type InjectSnapshot } from "./inject-freeze"

const D1 = "Today's date: 2026-09-24\n"
const D2 = "Today's date: 2026-09-25\n"

describe("freezeInject（注入快照会话级冻结）", () => {
  test("同会话同日二次调用不再执行 compute：即使记忆已变化，字节与首轮一致", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    let computes = 0
    const first = freezeInject(
      snapshots,
      "s1",
      () => {
        computes++
        return { date: D1, memories: "<m>fact A</m>" }
      },
      D1,
    )
    // 模拟：记忆库更新后实时重算会得到不同内容（旧实现每轮重算 → 前缀折断）
    const second = freezeInject(
      snapshots,
      "s1",
      () => {
        computes++
        return { date: D1, memories: "<m>fact B</m>" }
      },
      D1,
    )
    expect(computes).toBe(1)
    expect(second.date).toBe(first.date)
    expect(second.memories).toBe(first.memories)
  })

  test("跨天只滚动 date、memories 仍冻结（date 陈旧缺陷回归防护）", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    let computes = 0
    freezeInject(
      snapshots,
      "s1",
      () => {
        computes++
        return { date: D1, memories: "m1" }
      },
      D1,
    )
    const next = freezeInject(
      snapshots,
      "s1",
      () => {
        computes++
        return { date: D2, memories: "m2" }
      },
      D2,
    )
    expect(computes).toBe(1)
    expect(next).toEqual({ date: D2, memories: "m1" })
  })

  test("不同会话独立冻结", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    freezeInject(snapshots, "s1", () => ({ date: D1, memories: "m1" }), D1)
    const other = freezeInject(snapshots, "s2", () => ({ date: D2, memories: "m2" }), D2)
    expect(other).toEqual({ date: D2, memories: "m2" })
    expect(snapshots.size).toBe(2)
  })

  test("memories 为 undefined（无记忆）也冻结，后续有记忆也不回填", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    freezeInject(snapshots, "s1", () => ({ date: D1, memories: undefined }), D1)
    const again = freezeInject(snapshots, "s1", () => ({ date: D1, memories: "late" }), D1)
    expect(again.memories).toBeUndefined()
  })

  test("persistOnMiss=false：miss 时不写入快照（TOCTOU 窗口淘汰后不污染）", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    const v = freezeInject(snapshots, "s1", () => ({ date: D1, memories: undefined }), D1, false)
    expect(v).toEqual({ date: D1, memories: undefined })
    expect(snapshots.has("s1")).toBe(false)
  })

  test("超上限淘汰最旧会话（有界内存）", () => {
    const snapshots = new Map<string, InjectSnapshot>()
    let firstKey = ""
    for (let i = 0; i < 1001; i++) {
      const key = `s${i}`
      if (i === 0) firstKey = key
      freezeInject(snapshots, key, () => ({ date: D1, memories: undefined }), D1)
    }
    expect(snapshots.size).toBeLessThanOrEqual(1000)
    expect(snapshots.has(firstKey)).toBe(false)
  })

  test("dropInjectSnapshot：Session.remove 清理模块级快照（同 ID 复用不继承）", () => {
    const id = "__drop_test_session__"
    freezeInject(injectSnapshots, id, () => ({ date: D1, memories: "m" }), D1)
    expect(injectSnapshots.has(id)).toBe(true)
    dropInjectSnapshot(id)
    expect(injectSnapshots.has(id)).toBe(false)
  })
})
