import { describe, expect, test } from "bun:test"
import { detectHallucinationMarkers, HALLUCINATION_PATTERNS } from "./dream"
import { partitionByHallucination } from "./extract"

describe("H-07 幻觉措辞检测不再误伤技术表述", () => {
  test("模型自我声明仍然会被抓出来", () => {
    expect(detectHallucinationMarkers("As an AI language model, I cannot verify this.")).toContain(
      "ai-self-reference",
    )
    expect(detectHallucinationMarkers("I don't know the answer.")).toContain("first-person-unknown")
    expect(detectHallucinationMarkers("I'm just guessing here.")).toContain("fabrication-hedge")
    expect(detectHallucinationMarkers("The fabricated line number 42 is nonsense.")).toContain(
      "fabricated-detail",
    )
  })

  test("技术文本里的 maybe / possibly / not sure 不再算幻觉", () => {
    // All three sentences are routine in real summaries; the old bare-word
    // patterns flagged every one of them as hallucination.
    expect(detectHallucinationMarkers("Possibly a caching layer sits between disk and memory.")).toEqual([])
    expect(detectHallucinationMarkers("Maybe the retry budget should be larger; not sure yet.")).toEqual([])
    expect(detectHallucinationMarkers("This is maybe-cached, possibly stale, not sure which.")).toEqual([])
  })

  test("正常的归纳段落不命中任何模式", () => {
    const summary = [
      "## 关键结论",
      "- 缓存命中率此前统计缺失，导致指标被误读",
      "- 修复后 stats 与 db cache 共用同一把尺子",
      "- 可能还需要在下个版本补充账单对账",
    ].join("\n")
    expect(detectHallucinationMarkers(summary)).toEqual([])
  })

  test("模式表非空且每条都有名称", () => {
    expect(HALLUCINATION_PATTERNS.length).toBeGreaterThan(0)
    for (const [name, pattern] of HALLUCINATION_PATTERNS) {
      expect(name).toBeTruthy()
      expect(pattern).toBeInstanceOf(RegExp)
    }
  })
})

describe("H-07 记忆提取出口把关（覆盖模型输出）", () => {
  test("带幻觉措辞的候选被丢弃，正常条目保留", () => {
    const { kept, dropped } = partitionByHallucination([
      "谷总要求压缩保留 read/grep 的事实证据，否则幻觉率上升",
      "As an AI, I cannot determine the exact line number.",
      "缓存锚点原先存在内存 Map 里，重启即丢失",
    ])
    expect(kept).toHaveLength(2)
    expect(dropped).toHaveLength(1)
    expect(dropped[0]?.markers).toContain("ai-self-reference")
  })

  test("全部合规时不丢弃任何条目", () => {
    const input = ["第一条记忆：工具默认走 openai-compatible", "第二条记忆：命中率口径已统一"]
    const { kept, dropped } = partitionByHallucination(input)
    expect(kept).toEqual(input)
    expect(dropped).toEqual([])
  })

  test("空输入安全返回", () => {
    expect(partitionByHallucination([])).toEqual({ kept: [], dropped: [] })
  })
})