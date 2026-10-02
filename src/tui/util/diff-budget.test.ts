import { describe, expect, test } from "bun:test"
import { MAX_DIFF_BYTES, capDiffByBytes, diffBytes } from "./diff-budget"
import type { SnapshotFileDiff } from "@gyccode/protocol/v2"

const diff = (file: string, patchBytes: number): SnapshotFileDiff => ({
  file,
  patch: "x".repeat(patchBytes),
  additions: 1,
  deletions: 0,
})

describe("diffBytes", () => {
  test("累计 patch 字节数（file 路径不计）", () => {
    expect(diffBytes([diff("a.ts", 100), diff("b.ts", 250)])).toBe(350)
  })

  test("patch 缺失时按 0 计", () => {
    expect(diffBytes([{ file: "a.ts", additions: 0, deletions: 0 }])).toBe(0)
  })

  test("空数组为 0", () => {
    expect(diffBytes([])).toBe(0)
  })
})

describe("capDiffByBytes", () => {
  test("总量未超预算：原样返回且 truncated 为 false", () => {
    const list = [diff("a.ts", 100), diff("b.ts", 100)]
    const r = capDiffByBytes(list, MAX_DIFF_BYTES)
    expect(r.truncated).toBe(false)
    expect(r.diff).toBe(list)
  })

  test("超预算：保留最新的文件并标注已裁剪数量", () => {
    const list = Array.from({ length: 50 }, (_, i) => diff(`f${i}.ts`, 40_000))
    const r = capDiffByBytes(list, 200_000)
    expect(r.truncated).toBe(true)
    expect(r.dropped).toBeGreaterThan(0)
    expect(diffBytes(r.diff)).toBeLessThanOrEqual(200_000)
    // 保留的是最新的（数组末尾）
    expect(r.diff[r.diff.length - 1]?.file).toBe("f49.ts")
  })

  test("单文件本身超预算：至少保留最新一个（不返回空列表）", () => {
    const r = capDiffByBytes([diff("huge.ts", 10_000_000)], 1000)
    expect(r.diff.length).toBe(1)
    // 没有文件被丢弃，只是这单个 patch 超预算：truncated 反映的是丢弃行为
    expect(r.dropped).toBe(0)
    expect(r.truncated).toBe(false)
  })

  test("预算 ≤ 0 时不裁剪（防御非法配置）", () => {
    const list = [diff("a.ts", 10_000_000)]
    const r = capDiffByBytes(list, 0)
    expect(r.truncated).toBe(false)
    expect(r.diff).toBe(list)
  })

  test("裁剪顺序稳定：从尾部向前保留（预算只够放下最新的 4 个）", () => {
    const list = Array.from({ length: 10 }, (_, i) => diff(`f${i}.ts`, 30_000))
    const r = capDiffByBytes(list, 100_000)
    // 4 × 30,000 = 120,000 > 100,000：实际只放得下 3 个（90,000）+ 第 4 个溢出
    expect(r.diff.map((d) => d.file)).toEqual(["f7.ts", "f8.ts", "f9.ts"])
    expect(r.dropped).toBe(7)
  })

  test("默认预算为 8MB 量级（覆盖长会话大量编辑）", () => {
    expect(MAX_DIFF_BYTES).toBeGreaterThanOrEqual(4 * 1024 * 1024)
    expect(MAX_DIFF_BYTES).toBeLessThanOrEqual(64 * 1024 * 1024)
  })
})
