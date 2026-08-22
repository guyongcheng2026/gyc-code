import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"

export function DialogConfig() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const clipboard = useClipboard()
  const toast = useToast()

  dialog.setSize("large")

  const entries = createMemo(() => {
    const config = sync.data.config as Record<string, unknown>
    if (!config || typeof config !== "object") return []
    return Object.entries(config)
      .filter(([key]) => !key.startsWith("_"))
      .map(([key, value]) => ({
        key,
        value: typeof value === "object" ? JSON.stringify(value, null, 2) : String(value),
      }))
      .sort((a, b) => a.key.localeCompare(b.key))
  })

  const copy = () => {
    const text = entries()
      .map((e) => `${e.key}: ${e.value}`)
      .join("\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "配置已复制到剪贴板", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制配置", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Config — 当前配置
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <Show
        when={entries().length > 0}
        fallback={<text fg={theme.textMuted}>无配置项</text>}
      >
        <box>
          <For each={entries()}>
            {(entry) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.textMuted}>
                  {entry.key.padEnd(20)}
                </text>
                <text fg={theme.text} wrapMode="word">
                  {entry.value}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>配置文件路径见 /debug 或 ~/.gyccode/config.json</text>
        <text onMouseUp={copy}>
          <span fg={theme.text}>
            <b>copy</b>
          </span>{" "}
          <span fg={theme.textMuted}>enter</span>
        </text>
      </box>
    </box>
  )
}
