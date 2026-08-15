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

export function ChatPanel({ sessionID }: { sessionID: string }) {
  const { messages, busy } = useChatSession(sessionID)
  const { send } = useSendPrompt(sessionID)
  const { queue, resolve } = usePermissions(sessionID)
  const { command, abort, fork, summarize, switchAgent } = useSessionActions()
  const { commands } = useCommands()
  const { info } = useSessionInfo(sessionID)
  const { models, loading: modelsLoading } = useModels()
  const [sendError, setSendError] = useState<string | null>(null)
  const [planMode, setPlanMode] = useState(false)

  const currentModel = info?.model ? `${info.model.providerID}/${info.model.modelID}` : ""

  const onCommand = (name: string, args: string) => {
    // session.command 是同步端点（阻塞至命令回合完成）；这里 fire-and-forget，
    // 命令输出经 SSE 流式呈现，避免 UI 卡住。
    command(sessionID, name, args).catch((err) => {
      setSendError(err instanceof Error ? err.message : String(err))
    })
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
        <ModeSwitcher
          current={info?.agent ?? "build"}
          disabled={busy}
          onSelect={(mode: ModeID) => {
            switchAgent(sessionID, mode).catch((err) =>
              setSendError(err instanceof Error ? err.message : String(err)),
            )
          }}
        />
        <ModelPicker
          models={models}
          current={currentModel}
          loading={modelsLoading}
          onSelect={(label) => onCommand("model", label)}
        />
        {busy ? (
          <button className="btn" style={{ color: "var(--error)", borderColor: "var(--error)" }} onClick={() => abort(sessionID)}>
            ⏹ 停止
          </button>
        ) : null}
        <button
          className="btn btn-ghost"
          style={planMode ? { color: "var(--plan-mode)", borderColor: "var(--plan-mode)" } : undefined}
          onClick={() => setPlanMode((v) => !v)}
        >
          🗒 {planMode ? "计划模式" : "对话模式"}
        </button>
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

      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 24px" }}>
        {queue.map((p) => (
          <PermissionCard key={p.id} item={p} onResolve={resolve} />
        ))}
        <MessageList messages={messages} />
      </div>
      {sendError ? <div style={{ padding: "0 24px", color: "var(--error)", fontSize: 13 }}>{sendError}</div> : null}
      <div style={{ padding: "8px 24px 12px" }}>
        <PromptInput
          disabled={busy}
          commands={commands}
          onSubmit={(text) => {
            // 计划模式：先计划后执行（计划模式 agent 思路）
            const prompt = planMode
              ? `先不要修改任何代码。请先针对以下需求制定一份详细计划，包含：步骤拆解、每步风险、最终如何验证。计划确定后等我确认再执行。\n\n需求：${text}`
              : text
            send(prompt).catch((err) => setSendError(err instanceof Error ? err.message : String(err)))
          }}
          onCommand={onCommand}
        />
        <StatusBar info={info} />
      </div>
    </section>
  )
}

