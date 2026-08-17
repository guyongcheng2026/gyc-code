import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { Token } from "@/util/token"
import type { UserMessage } from "@gyccode/protocol/v2"
import { DialogConfirm } from "../ui/dialog-confirm"

export function DialogRewind() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const sdk = useSDK()
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

  const userMessages = createMemo(() =>
    messages().filter((item): item is UserMessage => item.role === "user"),
  )

  const partOf = (id: string) => sync.data.part[id] ?? []

  const getUserText = (msg: UserMessage): string => {
    const parts = partOf(msg.id)
    const textPart = parts.find((p) => p.type === "text" && !p.synthetic)
    if (textPart && textPart.type === "text") return textPart.text
    return "(非文本消息)"
  }

  const truncate = (text: string, maxLen: number): string => {
    const cleaned = text.replace(/\n/g, " ").trim()
    if (cleaned.length <= maxLen) return cleaned
    return cleaned.slice(0, maxLen - 3) + "..."
  }

  const rewindTo = async (messageID: string) => {
    const ok = await DialogConfirm.show(
      dialog,
      "回退确认",
      "确定要回退到此处吗？之后的操作将被撤销。",
    )
    if (ok !== true) return

    void sdk.client.session
      .revert({
        sessionID: sessionID(),
        messageID,
      })
      .then(() => {
        toast.show({ message: "已回退", variant: "success" })
      })
      .catch((error: unknown) => {
        toast.show({
          message: error instanceof Error ? error.message : "回退失败",
          variant: "error",
        })
      })
    dialog.clear()
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Rewind — 回退到历史某点
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={userMessages().length > 0}
        fallback={<text fg={theme.textMuted}>没有可回退的用户消息</text>}
      >
        <text fg={theme.textMuted}>选择要回退到的用户消息（之后的操作将被撤销）：</text>
        <For each={[...userMessages()].reverse()}>
          {(msg, index) => (
            <box
              flexDirection="row"
              gap={1}
              onMouseDown={() => rewindTo(msg.id)}
            >
              <text flexShrink={0} fg={index() === 0 ? theme.success : theme.textMuted}>
                {index() === 0 ? "→" : " "}
              </text>
              <text flexShrink={0} fg={theme.textMuted}>
                {new Date(msg.time.created).toLocaleTimeString()}
              </text>
              <text fg={theme.text} wrapMode="word">
                {truncate(getUserText(msg), 60)}
              </text>
            </box>
          )}
        </For>
      </Show>
    </box>
  )
}
