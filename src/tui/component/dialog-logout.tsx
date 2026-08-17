import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useConnected } from "./use-connected"

export function DialogLogout() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const connected = useConnected()

  dialog.setSize("medium")

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Logout — 账号登出
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={connected()}
        fallback={<text fg={theme.textMuted}>当前未连接任何服务商</text>}
      >
        <text fg={theme.text}>已连接服务商</text>
        <text fg={theme.textMuted}>TUI 内登出需要终端交互，请运行：</text>
        <text fg={theme.warning}>  gyc account logout</text>
      </Show>
    </box>
  )
}
