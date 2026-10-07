import { describe, expect, test } from "bun:test"
import { selectPruneTargetCount } from "./prune-targets"

/**
 * 事件表超出 32MB 上限时，需要裁掉多少个「最老会话」才够。
 *
 * 旧实现是 while 循环里一次只删一个会话，且每次迭代重跑一次
 * `SELECT SUM(LENGTH(data))` 全表统计 —— 实测一次启动删 79 个会话、耗时 36.7 秒，
 * 全部同步阻塞在 Database layer 构造期（即冷启动路径）。这里把「选多少个」
 * 提成纯函数，裁剪就能收敛成一条带 LIMIT 的批量 DELETE。
 */
describe("selectPruneTargetCount", () => {
  test("未超出上限时不裁剪任何会话", () => {
    expect(selectPruneTargetCount([{ bytes: 10 }, { bytes: 20 }], 0)).toBe(0)
    expect(selectPruneTargetCount([{ bytes: 10 }, { bytes: 20 }], -5)).toBe(0)
  })

  test("按传入顺序（最老优先）累计到覆盖超额为止", () => {
    expect(selectPruneTargetCount([{ bytes: 10 }, { bytes: 20 }, { bytes: 30 }], 15)).toBe(2)
    expect(selectPruneTargetCount([{ bytes: 10 }, { bytes: 20 }, { bytes: 30 }], 30)).toBe(2)
    expect(selectPruneTargetCount([{ bytes: 10 }, { bytes: 20 }, { bytes: 30 }], 31)).toBe(3)
  })

  test("全部会话删完仍不够时只返回全部会话数（不越界）", () => {
    expect(selectPruneTargetCount([{ bytes: 10 }, { bytes: 20 }], 1000)).toBe(2)
  })

  test("没有可裁剪会话时返回 0", () => {
    expect(selectPruneTargetCount([], 100)).toBe(0)
  })
})
