// gyc 消息网关：任务完成事件推送（TUI 完成钩子等场景复用）
// 定位：推送是「锦上添花」，绝不能参与主流程。因此本模块唯一公开入口永不抛错、永不阻塞：
// - 开关关闭（~/.gyc/.env 或环境变量 GYC_GATEWAY_TASK_NOTIFY 取关闭值）→ 直接返回，不加载网络依赖
// - 未配置微信凭证 → 静默返回 undefined（绝大多数机器的常态，不报错不刷屏）
// - 发送失败（网络 / 限流 / 凭证失效）→ 只落 logWarn，调用方拿不到异常
import type { GatewaySendResult } from "./adapter"
import { logWarn } from "@core/observability/log-error"
import { readWeixinEnv, resolveWeixinConfig, WeixinAdapter } from "./weixin"

/** 推送开关键名；取值 0/false/off/no/disabled/none 即关闭。 */
export const TASK_NOTIFY_SWITCH = "GYC_GATEWAY_TASK_NOTIFY"

const OFF_VALUES = new Set(["0", "false", "off", "no", "disabled", "none"])

// 摘要上限：留足余量使整条文案远低于 weixin.ts 的 2000 字符分段阈值，避免一条通知被拆成多条
const MAX_SUMMARY_CHARS = 400

export interface TaskCompleteNotice {
  /** 会话 / 任务标题；缺省时用通用文案 */
  title?: string
  /** 摘要正文，超长自动截断 */
  summary?: string
  /** 本轮耗时（毫秒）；缺省则不展示耗时 */
  durationMs?: number
}

/** 推送依赖：默认接真实微信适配器；单测可注入替身，避免触网。 */
export interface TaskNotifyDeps {
  /** 推送开关是否打开 */
  enabled: () => boolean
  /** 解析投递目标会话；返回 undefined 表示未启用网关，调用方应静默跳过 */
  resolveTarget: () => string | undefined
  /** 实际发送 */
  send: (chatId: string, text: string) => Promise<GatewaySendResult>
}

/** 判定开关取值是否表示「关闭」；空值视为开启（缺省开，靠缺凭证时静默来兜底）。 */
export function isTaskNotifySwitchOff(value: string): boolean {
  return OFF_VALUES.has(value.trim().toLowerCase())
}

export function isTaskNotifyEnabled(): boolean {
  return !isTaskNotifySwitchOff(readWeixinEnv(TASK_NOTIFY_SWITCH))
}

/** 组装推送正文：首行标题与耗时，次行摘要。 */
export function formatTaskCompleteMessage(notice: TaskCompleteNotice): string {
  const title = (notice.title ?? "").trim()
  const head = title ? `gyc 任务完成：${title}` : "gyc 任务完成"
  const seconds = notice.durationMs === undefined ? undefined : Math.max(0, Math.round(notice.durationMs / 1000))
  const cost = seconds === undefined ? "" : `（耗时 ${seconds} 秒）`
  const summary = (notice.summary ?? "").trim()
  const body = summary ? `\n${summary.length > MAX_SUMMARY_CHARS ? `${summary.slice(0, MAX_SUMMARY_CHARS)}…` : summary}` : ""
  return `${head}${cost}${body}`
}

const defaultDeps: TaskNotifyDeps = {
  enabled: isTaskNotifyEnabled,
  resolveTarget: () => {
    try {
      return resolveWeixinConfig().homeChannel
    } catch {
      // 缺凭证是正常态而非错误，交由调用方静默跳过
      return undefined
    }
  },
  send: async (chatId, text) => {
    const adapter = new WeixinAdapter()
    await adapter.connect()
    return adapter.sendText(chatId, text)
  },
}

/** 推送任务完成通知；任何情况下都不向调用方抛错。 */
export async function notifyTaskComplete(
  notice: TaskCompleteNotice,
  deps: TaskNotifyDeps = defaultDeps,
): Promise<GatewaySendResult | undefined> {
  try {
    if (!deps.enabled()) return undefined
    const chatId = deps.resolveTarget()
    if (!chatId) return undefined
    const result = await deps.send(chatId, formatTaskCompleteMessage(notice))
    if (!result.ok) logWarn("gateway.notify", `任务完成推送失败：${result.error ?? "未知原因"}`)
    return result
  } catch (cause) {
    // 兜底：推送链路的任何异常都不得冒泡回 TUI 完成钩子
    logWarn("gateway.notify", `任务完成推送异常：${String(cause).slice(0, 200)}`)
    return undefined
  }
}
