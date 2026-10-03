import path from "path"
import { SessionV1 } from "@gyccode/core/v1/session"
import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import { Question } from "../question"
import { Session } from "@/session/session"
import { Provider } from "@/provider/provider"
import { InstanceState } from "@/effect/instance-state"
import { MessageID, PartID } from "../session/schema"
import EXIT_DESCRIPTION from "./plan-exit.txt"
import ENTER_DESCRIPTION from "./plan-enter.txt"

export const Parameters = Schema.Struct({})

/** 切换动作标识，用于回灌文案区分是「切到 plan」还是「切到 build」 */
export type PlanSwitchAction = "plan_enter" | "plan_exit"

/**
 * 保守默认：只有显式回答 "Yes" 才视为同意。
 * 取消 / 关闭对话框 / 无答案 / 大小写不一致一律视为拒绝，停留在当前代理。
 */
export function planApproval(answers?: readonly (readonly string[])[]) {
  return answers?.[0]?.[0] === "Yes"
}

/**
 * 对话框被拒绝（用户点「取消」/未作答）时的结构化回灌文案。
 * 纯函数，便于单测直接断言语义；不再经 orDie 升级成进程级 defect，
 * 模型能明确知道「这是用户主动取消」而不是「工具崩了」。
 */
export function planRejectedNotice(action: PlanSwitchAction) {
  const intent = action === "plan_enter" ? "切换到 plan 代理" : "切换到 build 代理"
  return [
    `<tool_notice kind="user_rejected" action="${action}">`,
    `用户没有同意${intent}（点了「取消」、跳过了对话框，或回答不是 Yes），本次未做任何代理切换，当前代理保持不变。`,
    `接下来可以：`,
    `1) 不要重复弹出同一个对话框，也不要把用户取消当成工具失败去重试；`,
    `2) 改为在正文里说明你的意图，直接用当前代理能用的手段继续推进；`,
    `3) 若任务确实必须切换代理，请提示用户重新发起该操作。`,
    `</tool_notice>`,
  ].join("\n")
}

/**
 * 读取会话历史失败时的可读诊断：把失败原因原样带给模型，并说明本轮未切换。
 */
export function planMessagesFailureNotice(reason: string) {
  return [
    `<tool_error kind="session_read_failed">`,
    `读取会话历史失败：${reason}`,
    `本轮未切换代理，状态保持不变。`,
    `接下来可以：基于当前已知上下文继续推进，或提示用户重新发起该操作；不要把它当成已成功切换。`,
    `</tool_error>`,
  ].join("\n")
}

/** 回灌结果结构：与 tool.ts 的 invalid_arguments 分支保持同一形状 */
type PlanNoticeResult = {
  title: string
  output: string
  metadata: { preview: string; truncated: boolean; loaded: string[] }
}

/** 对话框被拒绝时返回给模型的工具结果（正常返回值，不是 defect） */
export function planRejectedResult(action: PlanSwitchAction): PlanNoticeResult {
  return {
    title: action === "plan_enter" ? "用户未同意切换至计划代理" : "用户未同意切换至构建代理",
    output: planRejectedNotice(action),
    metadata: {
      preview: "用户取消/未作答，代理未切换",
      truncated: false,
      loaded: [] as string[],
    },
  }
}

/** 读取会话历史失败时返回给模型的工具结果（正常返回值，不是 defect） */
export function planMessagesFailureResult(action: PlanSwitchAction, reason: string): PlanNoticeResult {
  return {
    title: action === "plan_enter" ? "切换至计划代理失败" : "切换至构建代理失败",
    output: planMessagesFailureNotice(reason),
    metadata: {
      preview: `读取会话历史失败：${reason}`,
      truncated: false,
      loaded: [] as string[],
    },
  }
}

/** 切换过程中某一步失败时的语义标签 */
export type PlanFailureKind = "default_model_failed" | "message_write_failed" | "session_read_failed"

/**
 * 通用失败回灌：把「代理切换过程里某一步失败」变成可读诊断。
 *
 * 工具框架要求 `execute` 的错误通道为 `never`，因此不能 `Effect.fail`，
 * 只能把失败折成正常返回值——模型据此知道切换**没有生效**，而不是进程崩了。
 */
export function planStepFailureResult(
  action: PlanSwitchAction,
  kind: PlanFailureKind,
  reason: string,
): PlanNoticeResult {
  const intent = action === "plan_enter" ? "切换到 plan 代理" : "切换到 build 代理"
  const what =
    kind === "default_model_failed"
      ? "解析默认模型失败"
      : kind === "session_read_failed"
        ? "读取会话历史失败"
        : "写入代理切换消息失败"
  return {
    title: `${intent}失败`,
    output: [
      `<tool_error kind="${kind}">`,
      `${what}：${reason}`,
      `本轮未完成${intent}，当前代理保持不变。`,
      `接下来可以：先向用户确认可用的 provider/model，或提示用户重新发起该操作；不要把它当成已切换成功。`,
      `</tool_error>`,
    ].join("\n"),
    metadata: {
      preview: `${what}：${reason}`,
      truncated: false,
      loaded: [] as string[],
    },
  }
}

export const PlanEnterTool = Tool.define(  "plan_enter",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: ENTER_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          // 对话框被拒绝/ask 失败都不是进程级缺陷：统一按「用户未同意」处理，
          // 直接把取消语义和后续可行动作回灌给模型。
          const answers = yield* question
            .ask({
              sessionID: ctx.sessionID,
              questions: [
                {
                  question: "Would you like to switch to the plan agent to research and design before implementation?",
                  header: "Plan Agent",
                  custom: false,
                  options: [
                    { label: "Yes", description: "Switch to plan agent to research and create a plan" },
                    { label: "No", description: "Continue with the current agent" },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })
            .pipe(
              Effect.catch(() => Effect.succeed(undefined)),
              Effect.catchDefect(() => Effect.succeed(undefined)),
            )

          if (!planApproval(answers)) return planRejectedResult("plan_enter")

          // 读取会话历史失败属于可恢复错误：转成可读诊断回灌，保留当前代理不变。
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          )

          if (!messages.ok) {
            return planMessagesFailureResult("plan_enter", String(messages.error))
          }

          const lastUser = messages.value.findLast((item) => item.info.role === "user" && item.info.model)
          // 默认模型解析失败同样不能升级成 defect：折成可读诊断回灌。
          const fallback = yield* provider.defaultModel().pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          )
          if (!fallback.ok) return planStepFailureResult("plan_enter", "default_model_failed", String(fallback.error))
          const model = lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : fallback.value

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "plan",
            model,
          }
          // 切换本身靠这条消息落库；写失败即切换未生效，回灌诊断而不是崩掉。
          return yield* Effect.gen(function* () {
            yield* session.updateMessage(msg)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: ctx.sessionID,
              type: "text",
              text: "Switched to plan agent. Research and create a plan before implementation.",
              synthetic: true,
            } satisfies SessionV1.TextPart)
          }).pipe(
            Effect.map(() => ({
              title: "切换至计划代理",
              output: "User approved switching to plan agent. Wait for further instructions.",
              metadata: { preview: "代理已切换至 plan", truncated: false, loaded: [] as string[] },
            })),
            Effect.catch((error) =>
              Effect.succeed(planStepFailureResult("plan_enter", "message_write_failed", String(error))),
            ),
          )
        }),
    }
  }),
)

export const PlanExitTool = Tool.define(
  "plan_exit",
  Effect.gen(function* () {
    const session = yield* Session.Service
    const question = yield* Question.Service
    const provider = yield* Provider.Service

    return {
      description: EXIT_DESCRIPTION,
      parameters: Parameters,
      execute: (_params: {}, ctx: Tool.Context) =>
        Effect.gen(function* () {
          const instance = yield* InstanceState.context
          // 会话不存在时不弹对话框：先回灌诊断，避免后面 session.plan 抛 defect。
          const found = yield* session.get(ctx.sessionID).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          )
          if (!found.ok) return planStepFailureResult("plan_exit", "session_read_failed", String(found.error))
          const plan = path.relative(instance.worktree, Session.plan(found.value, instance))
          // 对话框被拒绝/ask 失败都不是进程级缺陷：统一按「用户未同意」处理，
          // 直接把取消语义和后续可行动作回灌给模型。
          const answers = yield* question
            .ask({
              sessionID: ctx.sessionID,
              questions: [
                {
                  question: `Plan at ${plan} is complete. Would you like to switch to the build agent and start implementing?`,
                  header: "Build Agent",
                  custom: false,
                  options: [
                    { label: "Yes", description: "Switch to build agent and start implementing the plan" },
                    { label: "No", description: "Stay with plan agent to continue refining the plan" },
                  ],
                },
              ],
              tool: ctx.callID ? { messageID: ctx.messageID, callID: ctx.callID } : undefined,
            })
            .pipe(
              Effect.catch(() => Effect.succeed(undefined)),
              Effect.catchDefect(() => Effect.succeed(undefined)),
            )

          // 只有显式回答 "Yes" 才允许切换到 build agent
          // 取消/关闭对话框/无答案时默认拒绝（留在 plan agent）
          if (!planApproval(answers)) return planRejectedResult("plan_exit")

          // 读取会话历史失败属于可恢复错误：转成可读诊断回灌，保留当前代理不变。
          const messages = yield* session.messages({ sessionID: ctx.sessionID }).pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          )

          if (!messages.ok) {
            return planMessagesFailureResult("plan_exit", String(messages.error))
          }

          const lastUser = messages.value.findLast((item) => item.info.role === "user" && item.info.model)
          const fallback = yield* provider.defaultModel().pipe(
            Effect.map((value) => ({ ok: true as const, value })),
            Effect.catch((error) => Effect.succeed({ ok: false as const, error })),
          )
          if (!fallback.ok) return planStepFailureResult("plan_exit", "default_model_failed", String(fallback.error))
          const model = lastUser?.info.role === "user" && lastUser.info.model ? lastUser.info.model : fallback.value

          const msg: SessionV1.User = {
            id: MessageID.ascending(),
            sessionID: ctx.sessionID,
            role: "user",
            time: { created: Date.now() },
            agent: "build",
            model,
          }
          return yield* Effect.gen(function* () {
            yield* session.updateMessage(msg)
            yield* session.updatePart({
              id: PartID.ascending(),
              messageID: msg.id,
              sessionID: ctx.sessionID,
              type: "text",
              text: `The plan at ${plan} has been approved, you can now edit files. Execute the plan`,
              synthetic: true,
            } satisfies SessionV1.TextPart)
          }).pipe(
            Effect.map(() => ({
              title: "切换至构建代理",
              output: "User approved switching to build agent. Wait for further instructions.",
              metadata: { preview: "代理已切换至 build", truncated: false, loaded: [] as string[] },
            })),
            Effect.catch((error) =>
              Effect.succeed(planStepFailureResult("plan_exit", "message_write_failed", String(error))),
            ),
          )
        }),
    }
  }),
)
