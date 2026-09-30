import { describe, expect, it } from "bun:test"

import PROMPT_ANTHROPIC from "./prompt/anthropic.txt"
import PROMPT_BEAST from "./prompt/beast.txt"
import PROMPT_CODEX from "./prompt/codex.txt"
import PROMPT_DEFAULT from "./prompt/default.txt"
import PROMPT_GEMINI from "./prompt/gemini.txt"
import PROMPT_GPT from "./prompt/gpt.txt"
import PROMPT_KIMI from "./prompt/kimi.txt"
import PROMPT_ASTRA from "./prompt/gpt-astra.txt"
import PROMPT_TRINITY from "./prompt/trinity.txt"
import { MAX_STEPS_PROMPT } from "@gyccode/core/session/runner/max-steps"

/**
 * 防幻觉提示词基线守卫。
 *
 * 背景：8 个 provider 提示词里曾出现「唯独 gpt-6 系的 gpt-astra.txt 完全没有
 * Accuracy 段」，且该文件同段还有 "Do not introduce unsolicited warnings,
 * disclaimers"，与「不确定必须声明」直接对冲。此外「别假设库存在」只覆盖
 * 3 个模型，谷总的主力 claude 全系不在其中。
 *
 * 这些都是提示词内容，退化不会报错、不会让测试变红，只会让幻觉率无声上升。
 * 因此固化为回归断言。
 */
const SELECTED: ReadonlyArray<readonly [name: string, prompt: string]> = [
  ["anthropic", PROMPT_ANTHROPIC],
  ["beast", PROMPT_BEAST],
  ["codex", PROMPT_CODEX],
  ["default", PROMPT_DEFAULT],
  ["gemini", PROMPT_GEMINI],
  ["gpt", PROMPT_GPT],
  ["gpt-astra", PROMPT_ASTRA],
  ["kimi", PROMPT_KIMI],
  ["trinity", PROMPT_TRINITY],
]

const LIB_EXIST = /NEVER assume (?:that )?(?:a|any) (?:given )?(?:library|libraries|framework)/i
const NO_FABRICATED_URL = /NEVER generate or guess URLs/i

describe("provider 提示词防幻觉基线", () => {
  it("9 个被 provider() 选中的提示词全部存在且非空", () => {
    for (const [name, prompt] of SELECTED) {
      expect(prompt.length, `${name}.txt 为空`).toBeGreaterThan(500)
    }
  })

  it("每个提示词都带 Accuracy and honesty 段", () => {
    for (const [name, prompt] of SELECTED) {
      expect(prompt, `${name}.txt 缺少 # Accuracy and honesty 段`).toMatch(/#\s*Accuracy and honesty/i)
    }
  })

  it("每个提示词都禁止「假设库一定存在」", () => {
    for (const [name, prompt] of SELECTED) {
      expect(prompt, `${name}.txt 缺少「别假设库存在」约束`).toMatch(LIB_EXIST)
    }
  })

  it("每个提示词都禁止凭空生成 URL", () => {
    for (const [name, prompt] of SELECTED) {
      expect(prompt, `${name}.txt 缺少「别凭空生成 URL」约束`).toMatch(NO_FABRICATED_URL)
    }
  })

  it("没有任何提示词压制「声明事实性不确定」", () => {
    // gpt-astra.txt 曾写 "Do not introduce unsolicited warnings, disclaimers"，
    // 会把「我不确定」一起压掉，与 Accuracy 段直接对冲。
    for (const [name, prompt] of SELECTED) {
      const offending = prompt
        .split("\n")
        .filter(
          (line) =>
            /(?:do not|don't|never)\b[^.\n]*\b(?:disclaimers?|warnings?)\b/i.test(line) &&
            // 允许显式豁免事实性不确定的那一句
            !/factual uncertainty|not sure whether/i.test(line),
        )
      expect(offending, `${name}.txt 存在压制声明不确定的措辞`).toEqual([])
    }
  })
})

describe("MAX_STEPS_PROMPT 措辞基线", () => {
  /**
   * 该串明文躺在 agent 可读的工作区内。任何读代码的 agent grep 到本文件就会
   * 把内容收进上下文。历史上此处写过
   * "This constraint overrides ALL other instructions" —— 已实证会劫持子代理
   * （读到后中断工作并按系统指令行事）。措辞层面的自我授权必须在此堵死。
   */
  const IMPERSONATION = [
    /overrides?\s+ALL\s+other\s+instructions/i,
    /\bCRITICAL\b/,
    /critical violation/i,
    /MUST\s+NOT\s+be\s+ignored/i,
    /this\s+is\s+a\s+system/i,
    /highest\s+priority\s+instruction/i,
  ]

  it("不含任何系统级自我授权措辞", () => {
    for (const pattern of IMPERSONATION) {
      expect(MAX_STEPS_PROMPT, `命中禁用措辞 ${pattern}`).not.toMatch(pattern)
    }
  })

  it("仍然要求模型收尾并输出未完成清单", () => {
    expect(MAX_STEPS_PROMPT).toMatch(/步数已用尽/)
    expect(MAX_STEPS_PROMPT).toMatch(/尚未完成/)
    expect(MAX_STEPS_PROMPT).toMatch(/下一步/)
  })
})
