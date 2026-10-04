import { EventV2Bridge } from "@/event-v2-bridge"
import { TuiEvent } from "@/server/tui-event"
import { Session } from "@/session/session"
import { Permission, type PermissionMode } from "@/permission"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiError } from "effect/unstable/httpapi"
import { nextTuiRequest, submitTuiResponse } from "@/server/shared/tui-control"
import { InstanceHttpApi } from "../api"
import { CommandPayload, TuiPublishPayload } from "../groups/tui"
import * as SessionError from "./session-errors"

const commandAliases = {
  session_new: "session.new",
  session_share: "session.share",
  session_interrupt: "session.interrupt",
  session_compact: "session.compact",
  messages_page_up: "session.page.up",
  messages_page_down: "session.page.down",
  messages_line_up: "session.line.up",
  messages_line_down: "session.line.down",
  messages_half_page_up: "session.half.page.up",
  messages_half_page_down: "session.half.page.down",
  messages_first: "session.first",
  messages_last: "session.last",
  agent_cycle: "agent.cycle",
} as const

/**
 * 权限模式变更走 executeCommand 的开放字符串命令（`permission.mode:<mode>`）。
 *
 * 为什么复用它而不是新开 endpoint：CommandPayload.command 本就是开放字符串，
 * 而新增 endpoint 要连带改协议组与 gen/sdk.gen.ts 的生成产物，代价远大于收益；
 * 且 TUI 与 Server 本就在同一进程内同跑（TUI 的 fetch 直接打到
 * Server.Default().app.fetch），这条命令通道本就是 TUI→Server 的既有通路。
 *
 * 不接的后果：TUI 自留本地 store 只驱动界面显示，后端 mode() 恒为 default，
 * 于是 --auto/--yolo 与界面上的模式切换对真实权限裁决毫无影响。
 */
const PERMISSION_MODE_COMMAND = "permission.mode:"
const PERMISSION_MODES = ["default", "acceptEdits", "bypassPermissions", "plan", "dontAsk"] as const

export const tuiHandlers = HttpApiBuilder.group(InstanceHttpApi, "tui", (handlers) =>
  Effect.gen(function* () {
    const events = yield* EventV2Bridge.Service
    const session = yield* Session.Service
    const permission = yield* Permission.Service
    const publishCommand = (command: typeof TuiEvent.CommandExecute.data.Type.command | undefined) =>
      // 未知别名会得到 undefined，而 schema 的 command 是必填：
      // 直接发布会让客户端按 event-manifest 解码失败，或把 undefined 传给命令分发器
      command === undefined
        ? Effect.logWarning("unknown tui command alias; no command event published")
        : events.publish(TuiEvent.CommandExecute, { command })

    /** 返回 true 表示这条命令已被权限模式接管，不再走别名分发。 */
    const applyPermissionMode = (command: string) => {
      if (!command.startsWith(PERMISSION_MODE_COMMAND)) return Effect.succeed(false)
      const next = command.slice(PERMISSION_MODE_COMMAND.length)
      if (!(PERMISSION_MODES as readonly string[]).includes(next))
        return Effect.logWarning("unknown permission mode in tui command", { command }).pipe(Effect.as(true))
      return permission.setMode(next as PermissionMode).pipe(Effect.as(true))
    }

    const appendPrompt = Effect.fn("TuiHttpApi.appendPrompt")(function* (ctx: {
      payload: typeof TuiEvent.PromptAppend.data.Type
    }) {
      yield* events.publish(TuiEvent.PromptAppend, ctx.payload)
      return true
    })

    const openHelp = Effect.fn("TuiHttpApi.openHelp")(function* () {
      yield* publishCommand("help.show")
      return true
    })

    const openSessions = Effect.fn("TuiHttpApi.openSessions")(function* () {
      yield* publishCommand("session.list")
      return true
    })

    // 修复：原先与 openSessions 重复地发布了 "session.list"，导致点击"主题"却打开会话列表。
    // 当前命令集未定义 theme 打开命令；在两端补齐主题面板命令前，避免把错误的 session.list
    // 发给前端（不再误导打开错误面板）。后续接入主题命令时替换为对应 command 即可。
    const openThemes = Effect.fn("TuiHttpApi.openThemes")(function* () {
      return true
    })

    const openModels = Effect.fn("TuiHttpApi.openModels")(function* () {
      yield* publishCommand("model.list")
      return true
    })

    const submitPrompt = Effect.fn("TuiHttpApi.submitPrompt")(function* () {
      yield* publishCommand("prompt.submit")
      return true
    })

    const clearPrompt = Effect.fn("TuiHttpApi.clearPrompt")(function* () {
      yield* publishCommand("prompt.clear")
      return true
    })

    const executeCommand = Effect.fn("TuiHttpApi.executeCommand")(function* (ctx: {
      payload: typeof CommandPayload.Type
    }) {
      // 权限模式必须落到后端，界面上切换模式才算真的生效
      if (yield* applyPermissionMode(ctx.payload.command)) return true
      // Legacy only publishes known aliases; unknown commands become undefined.
      yield* publishCommand(commandAliases[ctx.payload.command as keyof typeof commandAliases])
      return true
    })

    const showToast = Effect.fn("TuiHttpApi.showToast")(function* (ctx: {
      payload: typeof TuiEvent.ToastShow.data.Type
    }) {
      yield* events.publish(TuiEvent.ToastShow, ctx.payload)
      return true
    })

    const publish = Effect.fn("TuiHttpApi.publish")(function* (ctx: { payload: typeof TuiPublishPayload.Type }) {
      if (ctx.payload.type === TuiEvent.PromptAppend.type)
        yield* events.publish(TuiEvent.PromptAppend, ctx.payload.properties)
      if (ctx.payload.type === TuiEvent.CommandExecute.type)
        yield* events.publish(TuiEvent.CommandExecute, ctx.payload.properties)
      if (ctx.payload.type === TuiEvent.ToastShow.type)
        yield* events.publish(TuiEvent.ToastShow, ctx.payload.properties)
      if (ctx.payload.type === TuiEvent.SessionSelect.type)
        yield* events.publish(TuiEvent.SessionSelect, ctx.payload.properties)
      return true
    })

    const selectSession = Effect.fn("TuiHttpApi.selectSession")(function* (ctx: {
      payload: typeof TuiEvent.SessionSelect.data.Type
    }) {
      if (!ctx.payload.sessionID.startsWith("ses")) return yield* new HttpApiError.BadRequest({})
      yield* SessionError.mapStorageNotFound(session.get(ctx.payload.sessionID))
      yield* events.publish(TuiEvent.SessionSelect, ctx.payload)
      return true
    })

    const controlNext = Effect.fn("TuiHttpApi.controlNext")(function* () {
      return yield* Effect.promise(() => nextTuiRequest())
    })

    const controlResponse = Effect.fn("TuiHttpApi.controlResponse")(function* (ctx: { payload: unknown }) {
      submitTuiResponse(ctx.payload)
      return true
    })

    return handlers
      .handle("appendPrompt", appendPrompt)
      .handle("openHelp", openHelp)
      .handle("openSessions", openSessions)
      .handle("openThemes", openThemes)
      .handle("openModels", openModels)
      .handle("submitPrompt", submitPrompt)
      .handle("clearPrompt", clearPrompt)
      .handle("executeCommand", executeCommand)
      .handle("showToast", showToast)
      .handle("publish", publish)
      .handle("selectSession", selectSession)
      .handle("controlNext", controlNext)
      .handle("controlResponse", controlResponse)
  }),
)
