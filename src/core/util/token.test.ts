import { describe, expect, test } from "bun:test"
import { estimate, estimateWithAPI } from "./token"
import { tokenize } from "./tokenizer"

test("estimate returns 0 for empty input", () => {
  expect(estimate("")).toBe(0)
})

test("estimate counts word-ish tokens for ASCII prose", () => {
  const text = "the quick brown fox"
  // tokenizer: 4 words + 3 whitespace runs = 7 tokens
  expect(estimate(text)).toBe(7)
})

test("estimate treats CJK as denser than ASCII of the SAME length", () => {
  const zh = "中".repeat(20) // 20 CJK chars → 20 tokens
  const en = "a".repeat(20) // 20 ASCII chars → 1 token
  expect(estimate(zh)).toBeGreaterThan(estimate(en))
})

test("estimate treats code symbols as denser than prose of the SAME length", () => {
  const code = "a{b}c[d]e(f)g<h>i{j}k[l]m(n)o{p}q[r]s{t}u"
  const prose = "b".repeat(code.length)
  expect(estimate(code)).toBeGreaterThan(estimate(prose))
})

test("estimate handles mixed content deterministically", () => {
  const a = estimate("some text 12345 !@#$% 中文混排")
  const b = estimate("some text 12345 !@#$% 中文混排")
  expect(a).toBe(b)
})

test("estimate matches tokenize length (parity)", () => {
  const samples = ["hello world", "中文测试", '{"a":1}', "a{b}c", "  spaced  out  "]
  for (const s of samples) {
    expect(estimate(s)).toBe(tokenize(s).length)
  }
})

describe("estimateWithAPI", () => {
  test("falls back to local estimate when the API call throws", async () => {
    const api = {
      countTokens: async () => {
        throw new Error("network down")
      },
    } as any
    const result = await estimateWithAPI("你好世界", { api, model: "anthropic/claude-haiku-4-5" })
    expect(result).toBe(4) // local tokenize count
  })

  test("returns the API count when it succeeds", async () => {
    const api = {
      countTokens: async () => 123,
    } as any
    const result = await estimateWithAPI("some text", { api, model: "anthropic/claude-haiku-4-5" })
    expect(result).toBe(123)
  })

  test("falls back to local estimate when the API returns an invalid count", async () => {
    for (const invalid of [-1, NaN]) {
      const api = {
        countTokens: async () => invalid,
      } as any
      const result = await estimateWithAPI("中文测试", { api, model: "anthropic/claude-haiku-4-5" })
      expect(result).toBe(4) // local tokenize count
    }
  })

  test("uses local estimate when no api/model provided", async () => {
    const result = await estimateWithAPI("你好世界", {})
    expect(result).toBe(4)
  })
})

describe("estimateBlocks", () => {
  // 镜像 Claude Code tokenEstimation.roughTokenCountEstimationForBlock：
  // text→本地 tokenizer、image→2000、tool_use→JSON 长度/4、thinking→文本。
  // 接受 Anthropic content block 数组（text/image/tool_use/tool_result/thinking）。

  test("estimates empty blocks as 0", () => {
    const { estimateBlocks } = require("./token") as typeof import("./token")
    expect(estimateBlocks([] as any)).toBe(0)
  })

  test("text blocks use local tokenizer", () => {
    const { estimateBlocks, estimate } = require("./token") as typeof import("./token")
    const n = estimateBlocks([{ type: "text", text: "the quick brown fox" }] as any)
    expect(n).toBe(estimate("the quick brown fox"))
  })

  test("image blocks cost 2000 tokens each (Claude convention)", () => {
    const { estimateBlocks } = require("./token") as typeof import("./token")
    const n = estimateBlocks([
      { type: "text", text: "" },
      { type: "image", source: { data: "x".repeat(10_000) } },
    ] as any)
    // one image = 2000
    expect(n).toBe(2000)
  })

  test("tool_use blocks estimate JSON of name+input", () => {
    const { estimateBlocks } = require("./token") as typeof import("./token")
    const n = estimateBlocks([{ type: "tool_use", id: "x", name: "bash", input: { command: "pwd" } }] as any)
    expect(n).toBeGreaterThan(0)
    // 期望约等于 JSON.stringify({name:'bash',input:{...}}).length / 4
  })

  test("thinking blocks cost their text length via tokenizer", () => {
    const { estimateBlocks, estimate } = require("./token") as typeof import("./token")
    const n = estimateBlocks([{ type: "thinking", thinking: "think hard about this" }] as any)
    expect(n).toBe(estimate("think hard about this"))
  })

  test("mixed blocks sum per-block costs", () => {
    const { estimateBlocks, estimate } = require("./token") as typeof import("./token")
    const text = "some important text"
    const n = estimateBlocks([
      { type: "text", text },
      { type: "image", source: {} },
      { type: "tool_use", id: "i", name: "read", input: { file_path: "a.ts" } },
      { type: "thinking", thinking: "thinking chunk" },
    ] as any)
    const toolUseCost = Math.max(1, Math.ceil(JSON.stringify({ name: "read", input: { file_path: "a.ts" } }).length / 4))
    expect(n).toBe(estimate(text) + 2000 + estimate("thinking chunk") + toolUseCost)
    expect(n).toBeGreaterThan(estimate(text) + 2000)
  })
})
