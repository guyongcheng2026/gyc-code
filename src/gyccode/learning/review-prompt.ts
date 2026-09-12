// 沉淀提示词：把「本会话转录 + 技能库现状」拼成一次技能评审请求。
// 纯函数模块：不做 I/O、不读时钟，所有输入由调用方注入。
// 提示词的四段硬约束（主动性 / 优先级阶梯 / 禁止捕获 / 偏好归处）是 Task 5 的契约，改动需同步单测。

export interface ReviewPromptInput {
  /** 本会话的可见文本转录（调用方已截断） */
  readonly transcript: string
  /** 当前技能库里已有的技能名（用于让模型优先改写而不是新建） */
  readonly skills: readonly string[]
  /** 本会话中实际加载过的技能名 */
  readonly loadedSkills: readonly string[]
}

function renderList(names: readonly string[], emptyHint: string): string {
  if (names.length === 0) return emptyHint
  return names.map((name) => `- ${name}`).join("\n")
}

export function buildReviewPrompt(input: ReviewPromptInput): string {
  const skillsBlock = renderList(
    input.skills,
    "当前技能库为空：这次只可能新建类级技能，若确实没有可复用经验就交白卷。",
  )
  const loadedBlock = renderList(input.loadedSkills, "本次没有加载任何技能。")

  return `你是 gyc 的技能沉淀评审员。读完下面的会话转录，挑出这次会话里真正可复用的经验，并直接给出技能变更动作。

## 硬约束

1. 要主动：多数会话至少应产生一次技能更新；空手而归是错失机会，只有确认没有任何可复用经验时才交白卷。
2. 优先级阶梯：按 ① → ② → ③ → ④ 自上而下挑最高的一档，不许跳级：
   ① 改本次已加载的技能；
   ② 改已有类级技能；
   ③ 往已有技能下加支持文件（references/ / templates/ / scripts/）；
   ④ 才允许新建类级技能。
3. 禁止捕获：一次性报错串、环境偶然现象、与本次任务绑定的临时做法，都不许写进技能。
4. 谷总的偏好归处：风格 / 流程偏好应写进治理该类任务的 SKILL.md 正文，而不只是写进记忆。

## 当前技能库

${skillsBlock}

## 本次已加载的技能

${loadedBlock}

## 输出格式

只输出 JSON 数组，不要任何解释文字或 markdown 代码块；无动作时输出 []。
数组元素形如：

[{"action": "create", "name": "gateway-ops", "description": "一句话说明何时用这个技能", "body": "技能正文"}]

允许的 action 与字段要求：

- create：需要 name / description / body，用于新建类级技能。
- patch：需要 name，可选 description / body，用于改写已有技能。
- write_file：需要 name / file_path / content；file_path 必须以 references/ 、templates/ 或 scripts/ 开头。

name 一律用可复用的类级 kebab-case 命名，禁止日期、禁止 fix-/debug- 这类描述单次处置的前缀。

## 会话转录

${input.transcript}`
}
