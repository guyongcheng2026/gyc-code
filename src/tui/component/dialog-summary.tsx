import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useLocal } from "../context/local"
import { useToast } from "../ui/toast"
import { DialogConfirm } from "../ui/dialog-confirm"

export function DialogSummary() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
  const local = useLocal()
  const toast = useToast()

  dialog.setSize("large")

  const sessionID = createMemo(() =>
    route.data.type === "session" ? route.data.sessionID : "",
  )

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.message[id] ?? []
  })

  const messageCount = createMemo(() => messages().length)
  const userCount = createMemo(() => messages().filter((m) => m.role === "user").length)
  const assistantCount = createMemo(() => messages().filter((m) => m.role === "assistant").length)

  const totalTokens = createMemo(() => {
    let total = 0
    for (const msg of messages()) {
      if (msg.role === "assistant") {
        total += msg.tokens.input + msg.tokens.output + msg.tokens.reasoning
      }
    }
    return total
  })

  const totalCost = createMemo(() =>
    messages().reduce((sum, m) => sum + (m.role === "assistant" ? m.cost : 0), 0),
  )

  const generateSummary = async () => {
    const ok = await DialogConfirm.show(
      dialog,
      "生成会话摘要",
      "将使用当前模型生成会话摘要并压缩上下文。继续？",
    )
    if (ok !== true) return

    const selectedModel = local.model.current()
    if (!selectedModel) {
      toast.show({ message: "请先连接服务商", variant: "warning" })
      return
    }

    void sdk.client.session
      .summarize({
        sessionID: sessionID(),
        modelID: selectedModel.modelID,
        providerID: selectedModel.providerID,
      })
      .then(() => {
        toast.show({ message: "会话摘要已生成", variant: "success" })
        dialog.clear()
      })
      .catch((error: unknown) => {
        toast.show({
          message: error instanceof Error ? error.message : "生成摘要失败",
          variant: "error",
        })
      })
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Summary — 会话摘要
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={messageCount() > 0}
        fallback={<text fg={theme.textMuted}>当前会话无消息</text>}
      >
        <box>
          <text fg={theme.text}>
            <b>消息统计</b>
          </text>
          <text fg={theme.textMuted}>总消息: {messageCount()}</text>
          <text fg={theme.textMuted}>用户消息: {userCount()}</text>
          <text fg={theme.textMuted}>助手消息: {assistantCount()}</text>
        </box>

        <box>
          <text fg={theme.text}>
            <b>资源使用</b>
          </text>
          <text fg={theme.textMuted}>总 Token: {totalTokens().toLocaleString()}</text>
          <text fg={theme.textMuted}>
            总花费: ${totalCost().toFixed(4)}
          </text>
        </box>

        <box marginTop={1}>
          <box
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            onMouseDown={generateSummary}
          >
            <text fg={theme.text}>生成摘要并压缩上下文</text>
          </box>
        </box>

        <text fg={theme.textMuted}>
          压缩后会话历史将被摘要替代，释放上下文窗口
        </text>
      </Show>
    </box>
  )
}
