import path from "path"
import { SessionV1 } from "@gyccode/core/v1/session"
import { Effect } from "effect"
import { Agent } from "@/agent/agent"
import { FSUtil } from "@gyccode/core/fs-util"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { MessageID, PartID, SessionID } from "./schema"
import { Session } from "./session"
import PROMPT_PLAN from "./prompt/plan.txt"
import BUILD_SWITCH from "./prompt/build-switch.txt"
import PLAN_MODE from "./prompt/plan-mode.txt"
import PROMPT_COMPOSE from "./prompt/compose.txt"
import { findInjectionTarget, VERIFY_REMINDER } from "./verify-reminder"
import { ComposeSkill } from "../skill/compose"

/**
 * 向 compose 会话的首条用户消息注入系统提示（纯函数，无服务依赖，便于测试）。
 * 注入只发生一次：按前缀去重，避免同一消息在长会话中反复累积。
 */
export function injectComposeReminder(messages: SessionV1.WithParts[]): SessionV1.WithParts[] {
  const userMessage = messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return messages
  const composeMessage = messages.find(
    (msg) => msg.info.role === "user" && msg.info.agent === "compose",
  )
  if (!composeMessage) return messages
  const injected = composeMessage.parts.some(
    (part) =>
      part.type === "text" &&
      part.synthetic === true &&
      typeof part.text === "string" &&
      part.text.startsWith(PROMPT_COMPOSE.trimStart().slice(0, 32)),
  )
  if (!injected) {
    const skills = ComposeSkill.composeSkillsBlock()
    composeMessage.parts.unshift({
      id: PartID.ascending(),
      messageID: composeMessage.info.id,
      sessionID: composeMessage.info.sessionID,
      type: "text",
      text: skills ? `${PROMPT_COMPOSE}\n\n${skills}` : PROMPT_COMPOSE,
      synthetic: true,
    })
  }
  return messages
}

export const apply = Effect.fn("SessionReminders.apply")(function* (input: {
  messages: SessionV1.WithParts[]
  agent: Agent.Info
  session: Session.Info
}) {
  const flags = yield* RuntimeFlags.Service
  const fsys = yield* FSUtil.Service
  const sessions = yield* Session.Service
  const userMessage = input.messages.findLast((msg) => msg.info.role === "user")
  if (!userMessage) return input.messages

  if (input.agent.name === "compose") {
    return injectComposeReminder(input.messages)
  }

  if (!flags.experimentalPlanMode) {
    if (input.agent.name === "plan") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: PROMPT_PLAN,
        synthetic: true,
      })
    }
    const wasPlan = input.messages.some((msg) => msg.info.role === "assistant" && msg.info.agent === "plan")
    if (wasPlan && input.agent.name === "build") {
      userMessage.parts.push({
        id: PartID.ascending(),
        messageID: userMessage.info.id,
        sessionID: userMessage.info.sessionID,
        type: "text",
        text: BUILD_SWITCH,
        synthetic: true,
      })
    }
    return input.messages
  }

  const assistantMessage = input.messages.findLast((msg) => msg.info.role === "assistant")

  // 2026-09-30（三指标 S-03）：未验证改动的框架级提醒。
  //
  // 放在 plan/build 分支之前，因为「改完没验证」与当前 agent 模式无关：
  // plan 改完也要能编过。plan 模式本身跳过 —— plan 阶段的改动不该立刻编译。
  if (input.agent.name !== "plan") {
    const target = findInjectionTarget(input.messages)
    if (target) {
      const part = yield* sessions
        .updatePart({
          id: PartID.ascending(),
          messageID: target.info.id as MessageID,
          sessionID: target.info.sessionID as SessionID,
          type: "text",
          text: VERIFY_REMINDER,
          synthetic: true,
        })
        .pipe(Effect.catchCause((cause) => Effect.logWarning("验证提醒注入失败", { cause }).pipe(Effect.asVoid)))
      if (part) (target.parts as SessionV1.Part[]).push(part)
    }
  }

  if (input.agent.name !== "plan" && assistantMessage?.info.agent === "plan") {
    const ctx = yield* InstanceState.context
    const plan = Session.plan(input.session, ctx)
    const exists = yield* fsys.existsSafe(plan)
    const part = yield* sessions.updatePart({
      id: PartID.ascending(),
      messageID: userMessage.info.id,
      sessionID: userMessage.info.sessionID,
      type: "text",
      text: exists
        ? `${BUILD_SWITCH}\n\nA plan file exists at ${plan}. You should execute on the plan defined within it`
        : BUILD_SWITCH,
      synthetic: true,
    })
    userMessage.parts.push(part)
    return input.messages
  }

  if (input.agent.name !== "plan" || assistantMessage?.info.agent === "plan") return input.messages

  const ctx = yield* InstanceState.context
  const plan = Session.plan(input.session, ctx)
  const exists = yield* fsys.existsSafe(plan)
  if (!exists) yield* fsys.ensureDir(path.dirname(plan)).pipe(Effect.catch(Effect.die))
  const part = yield* sessions.updatePart({
    id: PartID.ascending(),
    messageID: userMessage.info.id,
    sessionID: userMessage.info.sessionID,
    type: "text",
    text: PLAN_MODE.replace("${planInfo}", () =>
      exists
        ? `A plan file already exists at ${plan}. You can read it and make incremental edits using the edit tool.`
        : `No plan file exists yet. You should create your plan at ${plan} using the write tool.`,
    ),
    synthetic: true,
  })
  userMessage.parts.push(part)
  return input.messages
})

export * as SessionReminders from "./reminders"
