// gyc 消息网关：平台无关适配器接口
// 设计对标 hermes BasePlatformAdapter 的核心抽象（connect/poll/send/disconnect），
// 保持零依赖、可被 CLI 与 TUI 共同复用。

import { GatewayErrorKind } from "./errors"

export interface GatewayTarget {
  platform: string
  chatId: string
}

export interface GatewayMessage {
  /** 对端会话/用户标识 */
  from: string
  text: string
  timestamp: number
}

export interface GatewaySendResult {
  ok: boolean
  messageId?: string
  error?: string
  kind?: GatewayErrorKind
}

/** 平台适配器契约：weixin 为首个实现，后续可挂 telegram 等。 */
export interface GatewayAdapter {
  readonly platform: string

  /** 校验配置并初始化网络资源；失败抛 GatewayError。 */
  connect(): Promise<void>

  /** 发送文本到指定会话；超长文本由实现方负责分段。 */
  sendText(chatId: string, text: string): Promise<GatewaySendResult>

  /**
   * 长轮询收信循环：持续拉取新消息并逐条回调，直到 abort 被触发。
   * 收到对端消息时应自动刷新回复凭证（如 iLink context_token）。
   */
  poll(onMessage: (message: GatewayMessage) => Promise<void>, abort: AbortSignal): Promise<void>

  disconnect(): Promise<void>
}
