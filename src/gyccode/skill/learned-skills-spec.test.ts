// 固化技能发现的两条不变量。它们一旦被误改，后果都不轻：
//
//   1. compose 技能必须保持 hidden——它们只在 Compose 模式经 <compose_skills> 块出现，
//      泄漏到普通模式的 available_skills 里会让每个会话都背上 15 个无关技能。
//   2. 沉淀闭环的自建技能必须**不**设 hidden——它们是要被谷总看见并复用的常规技能；
//      同时其根目录必须来自 gyc 自己的解析器，而不是 HERMES_HOME（那是 Hermes 的技能库）。
//
// 这两条都写在同一个函数里且没有独立导出，所以这里直接对源文件做断言。
// 与 session/instruction-system-spec.test.ts 是同一类「接线规格」测试。

import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"

const source = readFileSync(path.join(import.meta.dir, "index.ts"), "utf-8")
const lines = source.split("\n")
const flags = readFileSync(path.join(import.meta.dir, "..", "effect", "runtime-flags.ts"), "utf-8")

describe("技能发现 · 接线规格", () => {
  it("compose 技能扫描标记为 hidden", () => {
    const line = lines.find((item) => item.includes('scope: "compose"'))
    expect(line).toBeDefined()
    expect(line).toContain("hidden: true")
  })

  it("learned 技能扫描不标记 hidden", () => {
    const line = lines.find((item) => item.includes('scope: "learned"'))
    expect(line).toBeDefined()
    expect(line).not.toContain("hidden")
  })

  it("learned 技能根来自 gyc 自己的解析器，而非 HERMES_HOME", () => {
    expect(source).toContain('import { skillsRoot } from "@/learning/paths"')
    expect(source).toContain("const learnedRoot = skillsRoot()")
  })

  it("learned 扫描受独立开关控制，可被环境变量关闭", () => {
    expect(source).toContain("disableLearnedSkills")
    expect(flags).toContain("GYCCODE_DISABLE_LEARNED_SKILLS")
  })

  it("available() 过滤 hidden", () => {
    expect(source).toContain("skill.hidden !== true")
  })
})
