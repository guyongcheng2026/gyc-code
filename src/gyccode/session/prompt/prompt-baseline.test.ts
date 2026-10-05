import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { composeVariant, CORE_MARKER, SHARED_CORE_BODY } from "./compose"
import ANTHROPIC from "./anthropic.txt"
import BEAST from "./beast.txt"
import BUILD_SWITCH from "./build-switch.txt"
import CODEX from "./codex.txt"
import COMPOSE_REMINDER from "./compose.txt"
import DEFAULT from "./default.txt"
import GEMINI from "./gemini.txt"
import GPT_ASTRA from "./gpt-astra.txt"
import GPT from "./gpt.txt"
import KIMI from "./kimi.txt"
import PLAN_MODE from "./plan-mode.txt"
import PLAN from "./plan.txt"
import TRINITY from "./trinity.txt"

/**
 * prompt 变体公共段抽取的一致性基线。
 *
 * 硬约束：抽取前后 13 个变体的最终渲染文本必须**逐字节一致**。
 *
 * 基线取自本次抽取之前的 HEAD 版本，用 base64 常量固化 —— 不把中文直接写进
 * `.ts`，避免终端/编码环节毁掉中文（见
 * `docs/compose/plans/2026-10-02-opentui-stability-long-session.md:123` 记录的
 * 那次 PowerShell 改写事故）。
 */

const BASELINE_DIR = join(import.meta.dir, "__baseline__")

/** 参与抽取的 9 个模型变体 */
const MODEL_VARIANTS: Record<string, string> = {
  anthropic: ANTHROPIC,
  beast: BEAST,
  codex: CODEX,
  default: DEFAULT,
  gemini: GEMINI,
  "gpt-astra": GPT_ASTRA,
  gpt: GPT,
  kimi: KIMI,
  trinity: TRINITY,
}

/** 不含公共段、字节必须原样不变的 4 个 reminder 变体 */
const REMINDER_VARIANTS: Record<string, string> = {
  "build-switch": BUILD_SWITCH,
  compose: COMPOSE_REMINDER,
  plan: PLAN,
  "plan-mode": PLAN_MODE,
}

const baseline = (name: string) => readFileSync(join(BASELINE_DIR, `${name}.txt`), "utf8")

describe("prompt 公共段抽取：逐字节一致性", () => {
  for (const [name, variant] of Object.entries(MODEL_VARIANTS)) {
    test(`${name}：拼接结果与抽取前逐字节一致`, () => {
      expect(composeVariant(variant)).toBe(baseline(name))
    })
  }

  for (const [name, variant] of Object.entries(REMINDER_VARIANTS)) {
    test(`${name}（reminder 变体，未参与抽取）：字节原样不变`, () => {
      expect(variant).toBe(baseline(name))
    })
  }

  test("13 个变体全部覆盖，无遗漏", () => {
    expect(Object.keys(MODEL_VARIANTS).length + Object.keys(REMINDER_VARIANTS).length).toBe(13)
  })
})

describe("公共段本身", () => {
  test("公共段正文是 Accuracy and honesty 五行", () => {
    expect(SHARED_CORE_BODY.split("\r\n")).toHaveLength(5)
    expect(SHARED_CORE_BODY.startsWith("# Accuracy and honesty")).toBe(true)
  })

  test("9 个模型变体都带占位标记", () => {
    for (const [name, variant] of Object.entries(MODEL_VARIANTS)) {
      expect(variant).toContain(CORE_MARKER)
    }
  })

  test("4 个 reminder 变体都不含标记，故不被改动", () => {
    for (const [name, variant] of Object.entries(REMINDER_VARIANTS)) {
      expect(variant).not.toContain(CORE_MARKER)
    }
  })

  test("变体文件里已不再物理重复公共段", () => {
    for (const [name, variant] of Object.entries(MODEL_VARIANTS)) {
      expect(variant).not.toContain("Never fabricate details.")
    }
  })

  test("拼接结果含公共段的全部 5 行", () => {
    for (const [name, variant] of Object.entries(MODEL_VARIANTS)) {
      const rendered = composeVariant(variant)
      for (const line of SHARED_CORE_BODY.split("\r\n")) {
        expect(rendered).toContain(line)
      }
    }
  })

  test("无标记的输入原样返回", () => {
    const plain = "第一行\r\n第二行"
    expect(composeVariant(plain)).toBe(plain)
  })

  test("确定性：同一输入两次拼接结果一致", () => {
    for (const variant of Object.values(MODEL_VARIANTS)) {
      expect(composeVariant(variant)).toBe(composeVariant(variant))
    }
  })

  test("拼接结果不含裸 LF（全部保持 CRLF）", () => {
    for (const variant of Object.values(MODEL_VARIANTS)) {
      expect(composeVariant(variant).replace(/\r\n/g, "")).not.toContain("\n")
    }
  })
})