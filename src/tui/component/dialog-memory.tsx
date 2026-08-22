import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { readMemories, type MemoryEntry } from "../../gyccode/memory/memory-bridge"

export function DialogMemory() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()

  dialog.setSize("large")

  const [entries, setEntries] = createSignal<MemoryEntry[]>([])
  const [loading, setLoading] = createSignal(true)

  const load = async () => {
    setLoading(true)
    try {
      const result = await readMemories()
      setEntries(result)
    } catch {
      setEntries([])
    }
    setLoading(false)
  }
  void load()

  const entryCount = createMemo(() => entries().length)

  const copy = () => {
    const text = entries()
      .map((e, i) => `[${i + 1}] ${e.value}`)
      .join("\n\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "记忆已复制到剪贴板", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制记忆", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Memory — 跨会话记忆
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>
        共 <b>{entryCount()}</b> 条记忆
      </text>

      <Show
        when={!loading()}
        fallback={<text fg={theme.textMuted}>加载中...</text>}
      >
        <Show
          when={entryCount() > 0}
          fallback={
            <box>
              <text fg={theme.textMuted}>暂无跨会话记忆</text>
              <text fg={theme.textMuted}>记忆文件: ~/.gyc/memory/gyccode_memory.md</text>
              <text fg={theme.textMuted}>助手会在会话中自动积累重要信息</text>
            </box>
          }
        >
          <For each={entries().slice(0, 50)}>
            {(entry, index) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.textMuted}>
                  {String(index() + 1).padStart(3, " ")}.
                </text>
                <text fg={theme.text} wrapMode="word">
                  {entry.value.length > 120
                    ? entry.value.slice(0, 117) + "..."
                    : entry.value}
                </text>
              </box>
            )}
          </For>
          <Show when={entryCount() > 50}>
            <text fg={theme.textMuted}>... 还有 {entryCount() - 50} 条</text>
          </Show>
        </Show>
      </Show>

      <text fg={theme.textMuted}>记忆文件: ~/.gyc/memory/gyccode_memory.md</text>
    </box>
  )
}
