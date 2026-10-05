export * as QuestionTool from "./question"

import { ToolFailure } from "@gyccode/llm"
import { Effect, Layer, Schema } from "effect"
import { makeLocationNode } from "../effect/app-node"
import { PermissionV2 } from "../permission"
import { QuestionV2 } from "../question"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "question"

export const description = `Use this tool when you need to ask the user questions during execution. This allows you to:
1. Gather user preferences or requirements
2. Clarify ambiguous instructions
3. Get decisions on implementation choices as you work
4. Offer choices to the user about what direction to take.

Usage notes:
- When \`custom\` is enabled (default), a "Type your own answer" option is added automatically; don't include "Other" or catch-all options
- Answers are returned as arrays of labels; set \`multiple: true\` to allow selecting more than one
- If you recommend a specific option, make that the first option in the list and add "(Recommended)" at the end of the label`

export const Input = Schema.Struct({
  questions: Schema.Array(QuestionV2.Prompt).annotate({ description: "Questions to ask" }),
})

export const Output = Schema.Struct({
  answers: Schema.Array(QuestionV2.Answer),
})
export type Output = typeof Output.Type

/**
 * 某题未获答复时的回灌标记。
 *
 * `Question.Answer` 是 `Schema.Array(Schema.String)`，协议里"未回答"唯一可表达的形态是空数组，
 * 所以这里用显式中文标记告诉模型"这一项没有答复"，而不是把它伪装成一个叫 Unanswered 的正常答案值。
 */
export const UNANSWERED_NOTICE = "（未获答复）"

export const toModelOutput = (
  questions: ReadonlyArray<QuestionV2.Prompt>,
  answers: ReadonlyArray<QuestionV2.Answer>,
) => {
  const unanswered: string[] = []
  const formatted = questions
    .map((question, index) => {
      const answer = answers[index]
      if (answer && answer.length > 0) return `"${question.question}"="${answer.join(", ")}"`
      unanswered.push(question.question)
      return `"${question.question}"="${UNANSWERED_NOTICE}"`
    })
    .join(", ")
  // 存在未获答复的问题时追加中文提示：模型必须知道这些问题的答案并不存在，禁止自行假定后继续推进。
  const notice =
    unanswered.length === 0
      ? ""
      : ` 未获答复的问题：${unanswered.join("、")}。这些问题没有拿到用户答复，请勿假定其答案；如必须得到答复，请重新提问。`
  return `User has answered your questions: ${formatted}.${notice} You can now continue with the user's answers in mind.`
}

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const question = yield* QuestionV2.Service
    const permission = yield* PermissionV2.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ input, output }) => [
            { type: "text", text: toModelOutput(input.questions, output.answers) },
          ],
          execute: (input, context) =>
            permission
              .assert({
                action: "question",
                resources: ["*"],
                sessionID: context.sessionID,
                agent: context.agent,
                source: { type: "tool", messageID: context.assistantMessageID, callID: context.toolCallID },
              })
              .pipe(
                Effect.mapError(() => new ToolFailure({ message: "Permission denied: question" })),
                Effect.andThen(
                  question
                    .ask({
                      sessionID: context.sessionID,
                      questions: input.questions,
                      tool: { messageID: context.assistantMessageID, callID: context.toolCallID },
                    })
                    .pipe(
                      // 用户拒绝回答只是本次工具执行失败，必须回灌给模型，旧实现 orDie 会升级成进程级 defect
                      Effect.mapError(
                        (error) => new ToolFailure({ message: `Unable to ask the user: ${error.message}` }),
                      ),
                    ),
                ),
                Effect.map((answers) => ({ answers })),
              ),
        }),
      })
      // 这里必须保留 orDie：register 的错误通道是 Tool.RegistrationError 而不是 never，
      // 而外层 Layer.effectDiscard 要求错误通道为 never；去掉 orDie 会让 layer 的类型契约不成立。
      // 该失败只在启动期由 Tool.validateName 校验非法工具名时产生，属于启动期不变量。
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/question",
  layer,
  deps: [ToolRegistry.node, PermissionV2.node, QuestionV2.node],
})