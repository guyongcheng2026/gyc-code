import { useEffect, useMemo, useRef, useState } from "react"
import { useChatSession } from "../client/useChatSession"
import { useSendPrompt } from "../client/useSendPrompt"
import { usePermissions } from "../client/usePermissions"
import { useQuestions } from "../client/useQuestions"
import { useSessionActions } from "../client/useSessionActions"
import { useCommands } from "../client/useCommands"
import { useSessionInfo } from "../client/useSessionInfo"
import { useModels } from "../client/useModels"
import { sdk } from "../client/sdk"
import { MessageList } from "./MessageList"
import { PromptInput } from "./PromptInput"
import { PermissionCard } from "./PermissionCard"
import { QuestionCard } from "./QuestionCard"
import { StatusBar } from "./StatusBar"
import { ModelPicker } from "./ModelPicker"
import { ModeSwitcher, type ModeID } from "./ModeSwitcher"
import { TodoPanel } from "./TodoPanel"
import { QueueDock } from "./QueueDock"
import { useQueue } from "../client/useQueue"

const MODE_ORDER: ModeID[] = ["plan", "build", "compose"]

// 本地核心命令（对照 Claude Code / gyc TUI 对齐；服务端 command.list 之外的客户端命令）。
const LOCAL_COMMANDS = [
  { name: "new", description: "新建会话并切换" },
  { name: "clear", description: "清空上下文（新建会话），同 /new" },
  { name: "init", description: "为当前仓库生成/更新 AGENTS.md" },
  { name: "review", description: "对当前改动发起代码审查" },
  { name: "compact", description: "压缩会话上下文（保留摘要）" },
  { name: "summary", description: "生成会话摘要" },
  { name: "context", description: "显示当前会话上下文用量（消息数/模型/Token）" },
  { name: "status", description: "显示会话状态（模式/模型/耗时/待办）" },
  { name: "cost", description: "显示当前会话费用与 Token 消耗" },
  { name: "copy", description: "复制最近助手回复到剪贴板" },
  { name: "branch", description: "分支当前会话并切换到新分支" },
  { name: "help", description: "显示可用命令帮助" },
]

const HELP_TEXT = [
  "常用命令：",
  "  /new /clear   新建会话      /init    生成 AGENTS.md",
  "  /review       代码审查      /compact 压缩上下文",
  "  /summary      会话摘要      /context 上下文用量",
  "  /status       会话状态      /cost    费用统计",
  "  /copy         复制回复      /branch  分支会话",
  "其他命令由服务端动态提供；模型/模式用输入框下方控件切换。",
].join("\n")

export function ChatPanel({ sessionID, files, directory }: { sessionID: string; files?: string[]; directory?: string }) {
  const { messages, busy } = useChatSession(sessionID, directory)
  const { send, deliver } = useSendPrompt(sessionID, directory)
  const { queue, resolve } = usePermissions(sessionID, directory)
  const { requests, reply, reject } = useQuestions(sessionID, directory)
  const { command, abort, fork, summarize, compact, switchAgent, switchModel, background } = useSessionActions(directory)
  const { commands } = useCommands(directory)
  const { info, refresh: refreshInfo } = useSessionInfo(sessionID, directory)
  const { models, loading: modelsLoading } = useModels()
  const { queue: queuedPrompts } = useQueue(sessionID, directory)
  const [sendError, setSendError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const noticeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(noticeTimer.current), [])
  const showNotice = (text: string) => {
    setNotice(text)
    window.clearTimeout(noticeTimer.current)
    noticeTimer.current = window.setTimeout(() => setNotice(null), 8000)
  }

  // 本地命令优先；服务端命令与本地重名时去重（本地实现覆盖服务端同名项）
  const allCommands = useMemo(() => {
    const localNames = new Set(LOCAL_COMMANDS.map((c) => c.name))
    return [...LOCAL_COMMANDS, ...commands.filter((c) => !localNames.has(c.name))]
  }, [commands])

  // composer 接管：待审批 / 待提问取队首（对齐 DSH「每次只有一个请求拥有编辑器」）
  const pendingPermission = queue[0]
  const pendingQuestion = requests[0]

  // 是否有运行中的子代理（task 工具）：有则显示「后台化」按钮（对齐 mini 子代理面板）。
  const runningSubagent = messages.some((m) =>
    m.parts.some((p) => p.tool === "task" && p.state?.status === "running"),
  )

  const currentAgent = (info?.agent ?? "build") as ModeID
  const currentModel = info?.model ? `${info.model.providerID}/${info.model.modelID}` : ""
  const currentVariant = info?.model?.variant

  const err = (e: unknown) => {
    const message = e instanceof Error ? e.message : String(e)
    const friendly = /failed to fetch|network error|networkerror|load failed/i.test(message)
      ? "无法连接 gyc 服务：请确认 gyc web 仍在运行；若页面用 localhost 打开，请改用 http://127.0.0.1:4096"
      : message
    setSendError(friendly)
  }

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
    if (name === "new" || name === "clear") {
      try {
        const res = await sdk(directory).session.create({ body: {} })
        const created = (res.data as { id: string } | undefined)?.id
        if (created) {
          showNotice("已新建会话并切换。")
          window.location.hash = `#${created}`
        }
      } catch (e) {
        err(e)
      }
      return
    }
    if (name === "compact") {
      const [providerID, modelID] = currentModel.split("/")
      if (!providerID || !modelID) {
        showNotice("尚未选择模型，无法压缩会话。")
        return
      }
      compact(sessionID, { providerID, modelID }).catch(err)
      showNotice("压缩已发起，结果经消息流返回。")
      return
    }
    if (name === "summary") {
      const [providerID, modelID] = currentModel.split("/")
      if (!providerID || !modelID) {
        showNotice("尚未选择模型，无法生成摘要。")
        return
      }
      summarize(sessionID, { providerID, modelID }).catch(err)
      showNotice("摘要已发起，结果经消息流返回。")
      return
    }
    if (name === "status") {
      showNotice(
        [
          `状态:   ${info?.status ?? "idle"}`,
          `模式:   ${currentAgent}`,
          ...(currentModel ? [`模型:   ${currentModel}${currentVariant && currentVariant !== "default" ? ` (${currentVariant})` : ""}`] : []),
          `消息:   ${messages.length} 条`,
          ...(info?.todos.length ? [`待办:   ${info.todos.filter((x) => !x.done).length}/${info.todos.length}`] : []),
        ].join("\n"),
      )
      return
    }
    if (name === "cost") {
      const t = info?.tokens
      const cost = info?.cost
      showNotice(
        [
          ...(cost !== undefined ? [`费用:   $${cost.toFixed(4)}`] : ["费用:   暂无数据"]),
          ...(t
            ? [`Token:  输入 ${t.input} · 输出 ${t.output} · 推理 ${t.reasoning}`, `缓存:   读 ${t.cache.read} / 写 ${t.cache.write}`]
            : ["Token:  暂无数据"]),
        ].join("\n"),
      )
      return
    }
    if (name === "help") {
      showNotice(HELP_TEXT)
      return
    }
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
        <MessageList messages={messages} busy={busy} />
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
        {/* 计划条（对齐 DSH TodoDock：输入区上方，空列表自我隐藏） */}
        {/* 运行中投递队列（对齐 DSH QueueDock：busy 态排队/插话气泡） */}
        <QueueDock items={queuedPrompts} />
        <TodoPanel todos={info?.todos ?? []} />
        {/* composer 接管（对齐 DSH ApprovalPanel）：待审批 > 待提问 优先，逐个接管输入区 */}
        {pendingPermission ? (
          <div className="approval-panel">
            <div className="approval-banner">等待审批</div>
            <PermissionCard item={pendingPermission} onResolve={resolve} />
          </div>
        ) : pendingQuestion ? (
          <div className="approval-panel">
            <div className="approval-banner approval-banner-question">等待回答</div>
            <QuestionCard request={pendingQuestion} onReply={reply} onReject={reject} />
          </div>
        ) : (
          <PromptInput
            disabled={!sessionID}
            busy={busy}
            commands={allCommands}
            files={files}
            onSubmit={(text, files, delivery) =>
              delivery
                ? deliver(text, delivery, files).catch(err)
                : send(text, info?.model, files).catch(err)}
            onCommand={onCommand}
            onTabCycle={cycleMode}
          />
        )}
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
