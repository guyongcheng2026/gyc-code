import { describe, expect, test } from "bun:test"
import { readFileSync } from "node:fs"
import path from "node:path"
import { QuestionV2 } from "../question"
import { UNANSWERED_NOTICE, toModelOutput } from "./question"

const prompt = (question: string): QuestionV2.Prompt => ({
  question,
  header: question,
  options: [],
})

describe("question 工具的答案回灌（A-2）", () => {
  test("空数组答案渲染成明确的中文未获答复标记，不再伪装成 Unanswered 答案", () => {
    const text = toModelOutput([prompt("使用哪种数据库?")], [[]])
    expect(text).not.toContain("Unanswered")
    expect(text).toContain(UNANSWERED_NOTICE)
    expect(UNANSWERED_NOTICE).toContain("未获答复")
  })

  test("答案缺失（answers 长度不足）同样按未获答复处理", () => {
    const text = toModelOutput([prompt("第一问")], [])
    expect(text).not.toContain("Unanswered")
    expect(text).toContain(UNANSWERED_NOTICE)
  })

  test("存在未获答复问题时额外给出中文提示，禁止模型自行假定答案", () => {
    const text = toModelOutput([prompt("第一问")], [[]])
    expect(text).toContain("未获答复的问题")
    expect(text).toContain("第一问")
    expect(text).toContain("请勿假定")
  })

  test("全部已作答时保持原有答案渲染，不注入未获答复提示", () => {
    const text = toModelOutput([prompt("第一问")], [["选 A"]])
    expect(text).toContain("选 A")
    expect(text).not.toContain(UNANSWERED_NOTICE)
    expect(text).not.toContain("未获答复的问题")
  })

  test("Answer 只有字符串数组形态，未回答只能由空数组表达", () => {
    expect(QuestionV2.Answer.make([])).toEqual([])
    expect(QuestionV2.Answer.make(["选 A"])).toEqual(["选 A"])
  })
})

describe("question 工具的失败通道（A-2）", () => {
  const source = readFileSync(path.join(import.meta.dir, "question.ts"), "utf8")

  test("ask 不再 orDie：全文件仅剩 register 一处 orDie，且该处位于 register 之后", () => {
    const count = source.split("Effect.orDie").length - 1
    expect(count).toBe(1)
    expect(source.indexOf("Effect.orDie")).toBeGreaterThan(source.indexOf(".register({"))
  })

  test("ask 的失败被映射为 ToolFailure，能回灌给模型而不是进程级 defect", () => {
    expect(source).toContain("Unable to ask the user")
    expect(source).toMatch(/question[\s\S]{0,200}?\.ask\(\{[\s\S]{0,400}?Effect\.mapError/)
  })

  test("register 的 orDie 保留，且注释写明 layer 错误通道非 never", () => {
    expect(source).toContain("Layer.effectDiscard")
    expect(source).toContain("never")
  })
})