import { TextAttributes } from "@opentui/core"
import { createMemo, Show, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useKV } from "../context/kv"
import { useToast } from "../ui/toast"
import { VIM_MODE_KEY } from "../vim"

export function DialogVim() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const kv = useKV()
  const toast = useToast()

  const [enabled, setEnabled] = createSignal(kv.get(VIM_MODE_KEY, false))

  const toggle = () => {
    const next = !enabled()
    setEnabled(next)
    kv.set(VIM_MODE_KEY, next)
    toast.show({
      message: next ? "Vim 模式已开启：esc 进入 NORMAL（h/j/k/l 移动），i/a 进入 INSERT" : "Vim 模式已关闭",
      variant: "info",
      duration: 2500,
    })
    dialog.clear()
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Vim — 模式切换
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>当前状态:</text>
      <text fg={enabled() ? theme.success : theme.warning}>
        <b>{enabled() ? "已开启" : "已关闭"}</b>
      </text>

      <Show when={!enabled()}>
        <text fg={theme.textMuted}>开启后输入框支持 vim 双模式：esc 进入 NORMAL（h/j/k/l/w/b/0/$/x/dd/u 等移动编辑命令），i/a/o 等进入 INSERT</text>
      </Show>

      <box marginTop={1}>
        <box
          backgroundColor={theme.backgroundElement}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          onMouseDown={toggle}
        >
          <text fg={theme.text}>
            {enabled() ? "关闭 Vim 模式" : "开启 Vim 模式"}
          </text>
        </box>
      </box>
    </box>
  )
}
