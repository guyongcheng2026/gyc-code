import { useDialog } from "../ui/dialog"
import { DialogSelect } from "../ui/dialog-select"
import { createMemo, createSignal } from "solid-js"
import { Locale } from "../util/locale"
import { useTheme } from "../context/theme"
import { usePromptHistory, type PromptInfo } from "./prompt/history"
import { useCommandShortcut } from "../keymap"

function getHistoryPreview(input: string, maxLength: number = 50): string {
  const firstLine = input.split("\n")[0].trim()
  return Locale.truncate(firstLine, maxLength)
}

export function DialogHistory(props: { onSelect: (entry: PromptInfo) => void }) {
  const dialog = useDialog()
  const history = usePromptHistory()
  const { theme } = useTheme()

  const [toDelete, setToDelete] = createSignal<number>()
  const deleteHint = useCommandShortcut("history.delete")

  const options = createMemo(() => {
    const entries = history.list()
    // Show most recent first
    return entries
      .map((entry, index) => {
        const isDeleting = toDelete() === index
        const lineCount = (entry.input.match(/\n/g)?.length ?? 0) + 1
        return {
          title: isDeleting ? `再次按 ${deleteHint()} 以确认` : getHistoryPreview(entry.input),
          bg: isDeleting ? theme.error : undefined,
          value: index,
          description: entry.mode === "shell" ? "shell" : undefined,
          footer: lineCount > 1 ? `约 ${lineCount} 行` : undefined,
        }
      })
      .toReversed()
  })

  return (
    <DialogSelect
      title="历史记录"
      placeholder="搜索历史记录..."
      options={options()}
      onMove={() => {
        setToDelete(undefined)
      }}
      onSelect={(option) => {
        const entries = history.list()
        const entry = entries[option.value]
        if (entry) props.onSelect(entry)
        dialog.clear()
      }}
      actions={[
        {
          command: "history.delete",
          title: "删除",
          onTrigger: (option) => {
            if (toDelete() === option.value) {
              const entries = history.list()
              const entry = entries[option.value]
              if (entry) history.remove(option.value)
              setToDelete(undefined)
              return
            }
            setToDelete(option.value)
          },
        },
      ]}
    />
  )
}