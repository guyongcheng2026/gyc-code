import type { Event } from "@gyccode/protocol/v2"
import type { TuiAttentionSoundName, TuiPlugin, TuiPluginApi } from "@gyccode/protocol/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"

const id = "internal:notifications"

type SessionError = Extract<Event, { type: "session.error" }>["properties"]["error"]

function notify(api: TuiPluginApi, sessionID: string | undefined, message: string, sound: TuiAttentionSoundName) {
  const session = sessionID ? api.state.session.get(sessionID) : undefined
  const isSubagent = session?.parentID !== undefined
  void api.attention.notify({
    title: session?.title,
    message,
    notification: isSubagent ? false : { when: "blurred" },
    sound: { name: sound, when: "always" },
  })
}

function sessionErrorMessage(error: SessionError) {
  if (error?.name === "MessageAbortedError") return "Session interrupted"
  const data = error?.data
  if (data && typeof data === "object" && "message" in data && data.message === "SSE read timed out") {
    return "模型停止响应"
  }
  return "会话出错"
}

/**
 * 任务完成推送到微信网关：fire-and-forget，绝不参与 TUI 主流程。
 * 四重护栏——动态 import 失败、推送开关关闭、未配置微信凭证、发送失败
 * 一律不打断交互；其中发送失败由网关侧落 logWarn，终端不刷屏。
 */
function pushToGateway(
  api: TuiPluginApi,
  sessionID: string,
  title: string | undefined,
  busyAt: number | undefined,
) {
  // 子代理会话不推送：一轮任务可派生大量子会话，全推会淹没微信
  if (api.state.session.get(sessionID)?.parentID) return
  const cwd = api.state.session.cwd(sessionID)
  void import("@/gateway/notify")
    .then((gateway) =>
      gateway.notifyTaskComplete({
        title: title?.trim() || "gyc 会话",
        summary: cwd ? `工作目录：${cwd}` : "",
        durationMs: busyAt === undefined ? undefined : Date.now() - busyAt,
      }),
    )
    .catch(() => undefined)
}

const tui: TuiPlugin = async (api) => {
  const active = new Set<string>()
  /** busy→idle 的起始时刻，用于推送里计算本轮耗时 */
  const busySince = new Map<string, number>()
  const errored = new Set<string>()
  const questions = new Set<string>()
  const permissions = new Set<string>()

  api.event.on("question.asked", (event) => {
    if (questions.has(event.properties.id)) return
    questions.add(event.properties.id)
    notify(api, event.properties.sessionID, "有提问待输入", "question")
  })

  api.event.on("question.replied", (event) => {
    questions.delete(event.properties.requestID)
  })

  api.event.on("question.rejected", (event) => {
    questions.delete(event.properties.requestID)
  })

  api.event.on("permission.asked", (event) => {
    if (permissions.has(event.properties.id)) return
    permissions.add(event.properties.id)
    notify(api, event.properties.sessionID, "有待确认的权限", "permission")
  })

  api.event.on("permission.replied", (event) => {
    permissions.delete(event.properties.requestID)
  })

  api.event.on("session.status", (event) => {
    const sessionID = event.properties.sessionID
    if (event.properties.status.type === "busy" || event.properties.status.type === "retry") {
      active.add(sessionID)
      busySince.set(sessionID, Date.now())
      errored.delete(sessionID)
      return
    }

    if (event.properties.status.type !== "idle") return
    if (!active.has(sessionID)) return
    active.delete(sessionID)
    const busyAt = busySince.get(sessionID)
    busySince.delete(sessionID)

    if (errored.has(sessionID)) {
      errored.delete(sessionID)
      return
    }

    const session = api.state.session.get(sessionID)
    notify(api, sessionID, "会话已完成", session?.parentID ? "subagent_done" : "done")
    pushToGateway(api, sessionID, session?.title, busyAt)
  })

  api.event.on("session.error", (event) => {
    const sessionID = event.properties.sessionID
    if (!sessionID) return
    if (!active.has(sessionID)) return
    errored.add(sessionID)
    notify(api, sessionID, sessionErrorMessage(event.properties.error), "error")
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin
