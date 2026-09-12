// 沉淀提示词的契约单测：四条硬约束必须逐条写死在提示词里，格式约定不能含糊。
// 本模块是纯函数，测试不需要文件系统。
import { describe, expect, it } from "bun:test"
import { buildReviewPrompt } from "./review-prompt"

const TRANSCRIPT = "谷总：把 gateway 的限流阈值调高一点。\n助手：已改成 200 rps，顺手补了回归用例。"

function withDefaults(overrides: Partial<Parameters<typeof buildReviewPrompt>[0]> = {}) {
  return buildReviewPrompt({
    transcript: TRANSCRIPT,
    skills: ["gateway-ops", "release-notes"],
    loadedSkills: ["gateway-ops"],
    ...overrides,
  })
}

describe("learning/review-prompt 四条硬约束", () => {
  it("约束一：明说要主动，多数会话至少产生一次技能更新", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("要主动")
    expect(prompt).toContain("至少应产生一次技能更新")
    expect(prompt).toContain("错失机会")
  })

  it("约束二：给出优先级阶梯，且四档顺序不颠倒", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("优先级阶梯")
    expect(prompt).toContain("本次已加载的技能")
    expect(prompt).toContain("已有类级技能")
    expect(prompt).toContain("references/")
    expect(prompt).toContain("templates/")
    expect(prompt).toContain("scripts/")
    expect(prompt).toContain("新建类级技能")

    const ladder = ["①", "②", "③", "④"].map((mark) => prompt.indexOf(mark))
    expect(ladder.every((index) => index >= 0)).toBe(true)
    expect(ladder).toEqual([...ladder].sort((left, right) => left - right))
  })

  it("约束三：禁止捕获一次性报错串、环境偶然现象与任务绑定的临时做法", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("禁止捕获")
    expect(prompt).toContain("一次性报错串")
    expect(prompt).toContain("环境偶然现象")
    expect(prompt).toContain("临时做法")
  })

  it("约束四：谷总的风格与流程偏好要进 SKILL.md 正文，而不是只进记忆", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("谷总")
    expect(prompt).toContain("偏好")
    expect(prompt).toContain("SKILL.md")
    expect(prompt).toContain("而不只是写进记忆")
  })
})

describe("learning/review-prompt 技能清单渲染", () => {
  it("已有技能名与本次已加载技能名都出现在提示词里", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("gateway-ops")
    expect(prompt).toContain("release-notes")
    expect(prompt).toContain("本次已加载的技能")
  })

  it("技能库为空时给出明确说明，而不是留白", () => {
    const prompt = withDefaults({ skills: [], loadedSkills: [] })
    expect(prompt).toContain("当前技能库为空")
    expect(prompt).toContain("本次没有加载任何技能")
  })

  it("转录原文附在提示词末尾", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("会话转录")
    expect(prompt.trimEnd().endsWith(TRANSCRIPT.trimEnd())).toBe(true)
  })
})

describe("learning/review-prompt 输出格式约定", () => {
  it("写明只输出 JSON 数组、无动作给 []、禁止解释文字与 markdown 代码块", () => {
    const prompt = withDefaults()
    expect(prompt).toContain("只输出 JSON 数组")
    expect(prompt).toContain("[]")
    expect(prompt).toContain("不要任何解释文字")
    expect(prompt).toContain("markdown 代码块")
  })

  it("三个 action 的字段要求与 write_file 的目录前缀限制都写明", () => {
    const prompt = withDefaults()
    expect(prompt).toContain('"action": "create"')
    expect(prompt).toContain("patch")
    expect(prompt).toContain("write_file")
    expect(prompt).toContain("file_path")
    expect(prompt).toContain("content")
    expect(prompt).toContain("description")
    expect(prompt).toContain("body")
    expect(prompt).toContain("必须以")
  })
})
