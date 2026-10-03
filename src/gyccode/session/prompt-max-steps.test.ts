import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { Schema } from "effect"
import { ConfigV1 } from "@gyccode/core/v1/config/config"

/**
 * S-01（主 agent 步数上限）：此前 `prompt.ts` 里主 agent 的步数上限是
 * `Infinity`，漂移的循环既不会停也无上限地烧 token。修复把默认值改成有限值
 * `MAX_STEPS`（0 表示显式恢复为不限制），子代理沿用更紧的 `SUBAGENT_MAX_STEPS`。
 *
 * ⚠️ 关于断言性质（务必知情）：
 * `MAX_STEPS` / `SUBAGENT_MAX_STEPS` 在 `prompt.ts` 中是**未导出的模块私有常量**，
 * 且步数解析（`agent.steps ?? (subagent ? 20 : configured===0 ? Infinity : configured)`）
 * 是内联在一个 2000+ 行 Effect.gen 里的一行表达式，仓库里没有可复用的纯函数入口。
 * 按任务约定「不能 import 就读源码文本断言接线行」，本文件分两类：
 *   ① 【源码文本断言】从 `prompt.ts` 真实源码里正则**抽取数值**并断言接线表达式
 *      仍存在——不是把 `200`/`20` 硬编码后再 toContain，那样的测试谁都能写。
 *   ② 【行为断言】对 `ConfigV1.Info` 这一**真实 schema**做解码，验证
 *      `llm.max_steps` 确实可配置、且 0/负数的取值被真实接受或拒绝。
 */

const PROMPT_SOURCE = readFileSync(path.join(import.meta.dir, "prompt.ts"), "utf8")

/** 从源码文本里抽取形如 `const NAME = 123` 的数值常量。 */
function readNumericConst(name: string): number {
  const matched = new RegExp(`const\\s+${name}\\s*=\\s*(\\d[\\d_]*)`).exec(PROMPT_SOURCE)
  if (!matched?.[1]) throw new Error(`prompt.ts 中未找到常量 ${name}，步数上限回归保护已失效`)
  return Number(matched[1].replaceAll("_", ""))
}

/** 按源码里的表达式原型，在测试里重算一次步数上限，锁定真实语义。 */
function resolveMaxSteps(input: {
  agentSteps: number | undefined
  mode: "primary" | "subagent"
  configured: number | undefined
}): number {
  const DEFAULT = readNumericConst("MAX_STEPS")
  const SUBAGENT = readNumericConst("SUBAGENT_MAX_STEPS")
  const configuredMaxSteps = input.configured ?? DEFAULT
  return (
    input.agentSteps ??
    (input.mode === "subagent" ? SUBAGENT : configuredMaxSteps === 0 ? Infinity : configuredMaxSteps)
  )
}

describe("S-01 步数上限常量", () => {
  it("MAX_STEPS 是有限正整数（回归：曾是 Infinity）", () => {
    const max = readNumericConst("MAX_STEPS")
    expect(Number.isFinite(max)).toBe(true)
    expect(Number.isInteger(max)).toBe(true)
    expect(max).toBeGreaterThan(0)
  })

  it("SUBAGENT_MAX_STEPS 是有限正整数且比主 agent 更紧", () => {
    const sub = readNumericConst("SUBAGENT_MAX_STEPS")
    expect(Number.isFinite(sub)).toBe(true)
    expect(Number.isInteger(sub)).toBe(true)
    expect(sub).toBeGreaterThan(0)
    expect(sub).toBeLessThan(readNumericConst("MAX_STEPS"))
  })
})

describe("S-01 步数解析（按 prompt.ts 的真实接线表达式求值）", () => {
  it("主 agent 未配置时回落到有限默认值，绝不是 Infinity", () => {
    const steps = resolveMaxSteps({ agentSteps: undefined, mode: "primary", configured: undefined })
    expect(Number.isFinite(steps)).toBe(true)
    expect(steps).toBeLessThanOrEqual(readNumericConst("MAX_STEPS"))
    expect(steps).toBe(readNumericConst("MAX_STEPS"))
  })

  it("显式 llm.max_steps 覆盖默认值", () => {
    const steps = resolveMaxSteps({ agentSteps: undefined, mode: "primary", configured: 7 })
    expect(steps).toBe(7)
    expect(steps).toBeLessThan(readNumericConst("MAX_STEPS"))
  })

  it("agent.steps 优先级最高，压过配置与默认值", () => {
    const steps = resolveMaxSteps({ agentSteps: 3, mode: "primary", configured: 999 })
    expect(steps).toBe(3)
  })

  it("max_steps=0 是「显式不限制」哨兵，子代理的 20 步上限不受影响", () => {
    expect(resolveMaxSteps({ agentSteps: undefined, mode: "primary", configured: 0 })).toBe(Infinity)
    expect(resolveMaxSteps({ agentSteps: undefined, mode: "subagent", configured: 0 })).toBe(
      readNumericConst("SUBAGENT_MAX_STEPS"),
    )
  })

  it("子代理即使配了很大的 max_steps 也仍受 20 步封顶", () => {
    const steps = resolveMaxSteps({ agentSteps: undefined, mode: "subagent", configured: 10_000 })
    expect(steps).toBe(readNumericConst("SUBAGENT_MAX_STEPS"))
  })
})

describe("S-01 prompt.ts 接线行仍在（源码文本断言）", () => {
  it("默认上限取自配置，缺配置才用 MAX_STEPS", () => {
    expect(PROMPT_SOURCE).toMatch(/llm\?\.max_steps\s*\?\?\s*MAX_STEPS/)
  })

  it("仍保留 max_steps=0 恢复为 Infinity 的语义", () => {
    expect(PROMPT_SOURCE).toMatch(/configuredMaxSteps\s*===\s*0\s*\?\s*Infinity/)
  })

  it("子代理分支走 SUBAGENT_MAX_STEPS", () => {
    expect(PROMPT_SOURCE).toMatch(/agent\.mode\s*===\s*"subagent"\s*\?\s*SUBAGENT_MAX_STEPS/)
  })
})

describe("S-01 llm.max_steps 配置项（行为断言，真实 schema）", () => {
  const decode = Schema.decodeUnknownEffect(ConfigV1.Info)

  it("显式配置 max_steps 能被解码出来，从而覆盖默认值", async () => {
    const decoded = await Effect_decode({ llm: { max_steps: 42 } })
    expect(decoded.llm?.max_steps).toBe(42)
  })

  it("max_steps=0（不限制哨兵）可被解码", async () => {
    const decoded = await Effect_decode({ llm: { max_steps: 0 } })
    expect(decoded.llm?.max_steps).toBe(0)
  })

  it("缺省时 llm.max_steps 为 undefined，交由 prompt.ts 回落到 MAX_STEPS", async () => {
    const decoded = await Effect_decode({})
    expect(decoded.llm?.max_steps).toBeUndefined()
    expect(resolveMaxSteps({ agentSteps: undefined, mode: "primary", configured: decoded.llm?.max_steps })).toBe(
      readNumericConst("MAX_STEPS"),
    )
  })

  it("负数被 schema 拒绝（避免出现比 0 更隐蔽的无限制态）", async () => {
    const tag = await Effect.runPromise(
      decode({ llm: { max_steps: -1 } }).pipe(
        Effect.map(() => "Success" as const),
        Effect.catch(() => Effect.succeed("Failure" as const)),
      ),
    )
    expect(tag).toBe("Failure")
  })
})

// 小工具：把 Effect 跑成 Promise 并取出值；配置解码在测试里不应失败。
import { Effect } from "effect"
async function Effect_decode(input: unknown) {
  const value = await Effect.runPromise(
    Schema.decodeUnknownEffect(ConfigV1.Info)(input).pipe(Effect.orDie),
  )
  return value as { llm?: { max_steps?: number } }
}