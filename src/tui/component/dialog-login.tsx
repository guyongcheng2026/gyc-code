import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useToast } from "../ui/toast"
import { useConnected } from "./use-connected"

export function DialogLogin() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const toast = useToast()
  const connected = useConnected()

  dialog.setSize("medium")

  const consoleState = createMemo(() => sync.data.console_state)
  const hasOrg = createMemo(() => Boolean(consoleState().activeOrgName))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Login — 账号登录
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={connected()}
        fallback={
          <box>
            <text fg={theme.text}>未连接服务商</text>
            <text fg={theme.textMuted}>请在终端运行以下命令登录：</text>
            <text fg={theme.success}>  gyc account login</text>
          </box>
        }
      >
        <box>
          <text fg={theme.success}>✓ 已连接服务商</text>
          <Show when={hasOrg()}>
            <text fg={theme.textMuted}>当前组织: {consoleState().activeOrgName}</text>
          </Show>
          <text fg={theme.textMuted}>如需切换账号，请在终端运行：</text>
          <text fg={theme.warning}>  gyc account logout && gyc account login</text>
        </box>
      </Show>

      <text fg={theme.textMuted}>TUI 内登录需要浏览器交互，请使用 CLI 命令完成</text>
    </box>
  )
}
