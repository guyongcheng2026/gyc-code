import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { InstallationVersion } from "@gyccode/core/installation/version"

const FEEDBACK_URL = "https://github.com/guyongcheng2026/gyc-code/issues"
const FEEDBACK_EMAIL = "feedback@gyccode.dev"

export function DialogFeedback() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()

  dialog.setSize("medium")

  const copyUrl = () => {
    void clipboard
      .write?.(FEEDBACK_URL)
      .then(() => toast.show({ message: "反馈链接已复制", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制反馈链接", group: "Dialog", cmd: copyUrl }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Feedback — 反馈
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>
        版本: <b>{InstallationVersion}</b>
      </text>

      <box>
        <text fg={theme.text}>
          <b>提交反馈</b>
        </text>
        <text fg={theme.textMuted}>GitHub Issues:</text>
        <text fg={theme.success} wrapMode="word">
          {"  "}{FEEDBACK_URL}
        </text>
        <text fg={theme.textMuted}>邮箱:</text>
        <text fg={theme.success}>
          {"  "}{FEEDBACK_EMAIL}
        </text>
      </box>

      <box>
        <text fg={theme.text}>
          <b>反馈建议包含</b>
        </text>
        <text fg={theme.textMuted}>  1. 版本号和操作系统</text>
        <text fg={theme.textMuted}>  2. 复现步骤</text>
        <text fg={theme.textMuted}>  3. 预期行为和实际行为</text>
        <text fg={theme.textMuted}>  4. 错误日志（如有）</text>
      </box>

      <box marginTop={1}>
        <box
          backgroundColor={theme.backgroundElement}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          onMouseDown={copyUrl}
        >
          <text fg={theme.text}>复制反馈链接</text>
        </box>
      </box>
    </box>
  )
}
