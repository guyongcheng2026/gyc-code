import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

/**
 * P1-1：编辑工具的锁池 LRU 驱逐破坏同文件互斥 → 并发丢更新。
 *
 * 原实现（edit.ts:38-65）注释断言「被驱逐的锁从未在使用中（An evicted lock is
 * never in flight）」，该断言不成立：调用方确实持有旧信号量引用，但被驱逐后新调用方
 * 会为同一路径**新建第二个信号量**，两者互不阻塞 → 同一文件的读-改-写交错 → 丢更新。
 *
 * 触发条件：单会话累计编辑过 200+ 个不同文件后，再次编辑早期文件。
 *
 * 修法：锁条目改为带引用计数，只有 `users === 0`（既无持有者也无等待者）的条目
 * 才允许回收。与 src/core/effect/keyed-mutex.ts:36-40 的 `users--` 归零回收一致。
 */

const source = () => readFileSync(path.join(import.meta.dir, "edit.ts"), "utf8")

describe("edit 锁条目必须带引用计数", () => {
  test("锁表存的是 { semaphore, users } 而不是裸信号量", () => {
    expect(source()).toMatch(/users:\s*0/)
    expect(source()).toMatch(/users\s*\+\+/)
  })

  test("持有结束时在 Effect.ensuring 里归还引用计数", () => {
    expect(source()).toContain("Effect.ensuring")
    expect(source()).toMatch(/users\s*--/)
  })

  test("驱逐只回收 users === 0 的条目，不按插入序盲目删除", () => {
    // 原实现：const oldest = locks.keys().next().value; locks.delete(oldest)
    expect(source()).not.toMatch(/const oldest = locks\.keys\(\)\.next\(\)\.value/)
    expect(source()).toMatch(/users\s*>\s*0/)
  })

  test("驱逐断言注释不再宣称「被驱逐的锁从未在使用中」", () => {
    expect(source()).not.toContain("An evicted lock is never in flight")
  })

  test("创建与递增在同一同步段内完成，中间没有 await 缝隙", () => {
    // 避免「取到条目 → 被并发回收 → 递增到已死条目」这一类竞态
    const text = source()
    const idx = text.indexOf("function lock")
    expect(idx).toBeGreaterThan(-1)
    const body = text.slice(idx, idx + 900)
    expect(body).toContain("Effect.suspend")
    expect(body).not.toMatch(/\byield\*/)
  })
})
