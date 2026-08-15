import { useState } from "react"
import { useChatSession } from "../client/useChatSession"
import { useSendPrompt } from "../client/useSendPrompt"
import { usePermissions } from "../client/usePermissions"
import { useSessionActions } from "../client/useSessionActions"
import { useCommands } from "../client/useCommands"
import { useSessionInfo } from "../client/useSessionInfo"
import { useModels } from "../client/useModels"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionCard } from "./PermissionCard"
import { StatusBar } from "./StatusBar"
import { ModelPicker } from "./ModelPicker"
import { ModeSwitcher, type ModeID } from "./ModeSwitcher"

const MODE_ORDER: ModeID[] = ["build", "plan", "compose"]

export function ChatPanel({ sessionID }: { sessionID: string }) {
  const { messages, busy } = useChatSession(sessionID)
  const { send } = useSendPrompt(sessionID)
  const { queue, resolve } = usePermissions(sessionID)
  const { command, abort, fork, summarize, switchAgent, switchModel } = useSessionActions()
  const { commands } = useCommands()
  const { info, refresh: refreshInfo } = useSessionInfo(sessionID)
  const { models, loading: modelsLoading } = useModels()
  const [sendError, setSendError] = useState<string | null>(null)

  const currentAgent = (info?.agent ?? "build") as ModeID
  const currentModel = info?.model ? `${info.model.providerID}/${info.model.modelID}` : ""

  const err = (e: unknown) => setSendError(e instanceof Error ? e.message : String(e))

  const setMode = (mode: ModeID) => switchAgent(sessionID, mode).then(() => refreshInfo()).catch(err)

  // TAB / Shift+TAB 循环模式（复刻 TUI agent.cycle）
  const cycleMode = (delta: number) => {
    const idx = MODE_ORDER.indexOf(currentAgent)
    const next = MODE_ORDER[(idx + delta + MODE_ORDER.length) % MODE_ORDER.length]
    setMode(next)
  }

  const onModelSelect = (label: string) => {
    const [providerID, modelID] = label.split("/")
    if (providerID && modelID)
      switchModel(sessionID, providerID, modelID)
        .then(() => refreshInfo())
        .catch(err)
  }

  const onCommand = (name: string, args: string) => {
    // session.command 是同步端点（阻塞至命令回合完成）；这里 fire-and-forget，
    // 命令输出经 SSE 流式呈现，避免 UI 卡住。
    command(sessionID, name, args).catch(err)
  }

  return (
    <section style={{ display: "flex", flexDirection: "column", flex: 1, minWidth: 0, height: "100%" }}>
      {/* 会话操作栏 */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "6px 24px",
          borderBottom: "1px solid var(--border-subtle)",
        }}
      >
        <span style={{ fontSize: 12, color: "var(--inactive)", fontWeight: 600, marginRight: "auto" }}>
          {info?.title ?? "会话"}
        </span>
        {busy ? (
          <button
            className="btn"
            style={{ color: "var(--error)", borderColor: "var(--error)" }}
            onClick={() => abort(sessionID)}
          >
            ⏹ 停止
          </button>
        ) : null}
        <button
          className="btn btn-ghost"
          onClick={async () => {
            const id = await fork(sessionID)
            if (id) window.location.hash = `#${id}`
          }}
        >
          ⑂ 分支
        </button>
        <button className="btn btn-ghost" onClick={() => summarize(sessionID).catch(() => {})}>
          摘要
        </button>
      </div>

      {/* 消息区（Virtuoso 自行滚动，保证 followOutput 生效） */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "12px 24px" }}>
        {queue.map((p) => (
          <PermissionCard key={p.id} item={p} onResolve={resolve} />
        ))}
        <MessageList messages={messages} />
      </div>
      {sendError ? <div style={{ padding: "0 24px", color: "var(--error)", fontSize: 13 }}>{sendError}</div> : null}

      {/* 输入区 + footer（模式 + 模型，与 TUI 位置一致：输入框下方左侧） */}
      <div style={{ padding: "8px 24px 10px" }}>
        <PromptInput
          disabled={busy}
          commands={commands}
          onSubmit={(text) => send(text, info?.model).catch(err)}
          onCommand={onCommand}
          onTabCycle={cycleMode}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 4px 0" }}>
          <ModeSwitcher current={currentAgent} disabled={busy} onSelect={setMode} />
          <ModelPicker models={models} current={currentModel} loading={modelsLoading} onSelect={onModelSelect} />
        </div>
        <StatusBar info={info} />
      </div>
    </section>
  )
}
