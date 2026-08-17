import { useMemo, useState } from "react"
import { useChatSession } from "../client/useChatSession"
import { useSendPrompt } from "../client/useSendPrompt"
import { usePermissions } from "../client/usePermissions"
import { useQuestions } from "../client/useQuestions"
import { useSessionActions } from "../client/useSessionActions"
import { useCommands } from "../client/useCommands"
import { useSessionInfo } from "../client/useSessionInfo"
import { useModels } from "../client/useModels"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionCard } from "./PermissionCard"
import { QuestionCard } from "./QuestionCard"
import { StatusBar } from "./StatusBar"
import { ModelPicker } from "./ModelPicker"
import { ModeSwitcher, type ModeID } from "./ModeSwitcher"

const MODE_ORDER: ModeID[] = ["build", "plan", "compose"]

// 本地斜杠命令（与 CLI/TUI 三端一致；服务端 command.list 之外的客户端命令）。
const LOCAL_COMMANDS = [
  { name: "context", description: "显示当前会话上下文用量（消息数/模型/Token）" },
  { name: "copy", description: "复制最近助手回复到剪贴板" },
  { name: "branch", description: "分支当前会话并切换到新分支" },
]

export function ChatPanel({ sessionID }: { sessionID: string }) {
  const { messages, busy } = useChatSession(sessionID)
  const { send } = useSendPrompt(sessionID)
  const { queue, resolve } = usePermissions(sessionID)
  const { requests, reply, reject } = useQuestions(sessionID)
  const { command, abort, fork, summarize, compact, switchAgent, switchModel, background } = useSessionActions()
  const { commands } = useCommands()
  const { info, refresh: refreshInfo } = useSessionInfo(sessionID)
  const { models, loading: modelsLoading } = useModels()
  const [sendError, setSendError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const showNotice = (text: string) => {
    setNotice(text)
    window.setTimeout(() => setNotice(null), 8000)
  }

  const allCommands = useMemo(() => [...LOCAL_COMMANDS, ...commands], [commands])

  // 是否有运行中的子代理（task 工具）：有则显示「后台化」按钮（对齐 mini 子代理面板）。
  const runningSubagent = messages.some((m) =>
    m.parts.some((p) => p.tool === "task" && p.state?.status === "running"),
  )

  const currentAgent = (info?.agent ?? "build") as ModeID
  const currentModel = info?.model ? `${info.model.providerID}/${info.model.modelID}` : ""
  const currentVariant = info?.model?.variant

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

  const onVariantSelect = (variant: string | undefined) => {
    const [providerID, modelID] = currentModel.split("/")
    if (providerID && modelID)
      switchModel(sessionID, providerID, modelID, variant)
        .then(() => refreshInfo())
        .catch(err)
  }

  const onCommand = async (name: string, _args: string) => {
    if (name === "context") {
      const userCount = messages.filter((m) => m.role === "user").length
      const assistantCount = messages.filter((m) => m.role === "assistant").length
      const otherCount = messages.length - userCount - assistantCount
      const model = info?.model
        ? `${info.model.providerID}/${info.model.modelID}${info.model.variant && info.model.variant !== "default" ? ` (${info.model.variant})` : ""}`
        : undefined
      const t = info?.tokens
      const tokens = t
        ? `输入 ${t.input} · 输出 ${t.output} · 推理 ${t.reasoning} · 缓存读 ${t.cache.read} / 写 ${t.cache.write}`
        : undefined
      showNotice(
        [
          `上下文：${messages.length} 条消息`,
          ...(model ? [`模型:   ${model}`] : []),
          ...(tokens ? [`Token:  ${tokens}`] : []),
          `消息:   用户 ${userCount} · 助手 ${assistantCount}${otherCount > 0 ? ` · 其他 ${otherCount}` : ""}`,
        ].join("\n"),
      )
      return
    }
    if (name === "copy") {
      const texts: string[] = []
      for (let i = messages.length - 1; i >= 0 && texts.length < 20; i--) {
        const msg = messages[i]
        if (!msg || msg.role !== "assistant") continue
        const text = msg.parts
          .filter((p) => p.type === "text")
          .map((p) => p.text ?? "")
          .join("\n\n")
          .trim()
        if (text) texts.push(text)
      }
      const content = texts.join("\n\n---\n\n")
      if (!content) {
        showNotice("当前会话没有可复制的助手回复。")
        return
      }
      try {
        await navigator.clipboard.writeText(content)
        showNotice(`已复制 ${content.length} 字符 ${content.split("\n").length} 行。`)
      } catch {
        showNotice("浏览器剪贴板不可用，请手动选择复制。")
      }
      return
    }
    if (name === "branch") {
      try {
        const id = await fork(sessionID)
        if (id) {
          showNotice("已分支会话并切换到新分支。")
          window.location.hash = `#${id}`
        } else {
          showNotice("分支创建失败。")
        }
      } catch (e) {
        err(e)
      }
      return
    }
    // session.command 是同步端点（阻塞至命令回合完成）；这里 fire-and-forget，
    // 命令输出经 SSE 流式呈现，避免 UI 卡住。
    command(sessionID, name, _args).catch(err)
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
        <button
          className="btn btn-ghost"
          onClick={() => {
            const [providerID, modelID] = currentModel.split("/")
            if (!providerID || !modelID) {
              showNotice("尚未选择模型，无法生成摘要。")
              return
            }
            summarize(sessionID, { providerID, modelID }).catch(err)
          }}
        >
          摘要
        </button>
        <button
          className="btn btn-ghost"
          onClick={() => {
            const [providerID, modelID] = currentModel.split("/")
            if (!providerID || !modelID) {
              showNotice("尚未选择模型，无法压缩会话。")
              return
            }
            compact(sessionID, { providerID, modelID }).catch(err)
          }}
          title="压缩会话上下文（保留摘要）"
        >
          压缩
        </button>
        {runningSubagent ? (
          <button
            className="btn btn-ghost"
            onClick={() => background(sessionID).catch(() => {})}
            title="将阻塞子代理转为后台运行"
          >
            ↻ 后台化
          </button>
        ) : null}
      </div>

      {/* 消息区（Virtuoso 自行滚动，保证 followOutput 生效） */}
      <div style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column", padding: "12px 24px" }}>
        {queue.map((p) => (
          <PermissionCard key={p.id} item={p} onResolve={resolve} />
        ))}
        {requests.map((r) => (
          <QuestionCard key={r.id} request={r} onReply={reply} onReject={reject} />
        ))}
        <MessageList messages={messages} />
      </div>
      {sendError ? <div style={{ padding: "0 24px", color: "var(--error)", fontSize: 13 }}>{sendError}</div> : null}
      {notice ? (
        <div
          style={{
            margin: "0 24px 8px",
            padding: "8px 12px",
            borderRadius: 8,
            fontSize: 13,
            whiteSpace: "pre-wrap",
            background: "var(--selection-bg)",
            border: "1px solid var(--border)",
          }}
        >
          {notice}
        </div>
      ) : null}

      {/* 输入区 + footer（模式 + 模型，与 TUI 位置一致：输入框下方左侧） */}
      <div style={{ padding: "8px 24px 10px" }}>
        <PromptInput
          disabled={busy}
          commands={allCommands}
          onSubmit={(text, files) => send(text, info?.model, files).catch(err)}
          onCommand={onCommand}
          onTabCycle={cycleMode}
        />
        <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "6px 4px 0" }}>
          <ModeSwitcher current={currentAgent} disabled={busy} onSelect={setMode} />
          <ModelPicker
            models={models}
            current={currentModel}
            currentVariant={currentVariant}
            loading={modelsLoading}
            onSelect={onModelSelect}
            onSelectVariant={onVariantSelect}
          />
        </div>
        <StatusBar info={info} />
      </div>
    </section>
  )
}
