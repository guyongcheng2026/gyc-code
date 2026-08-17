import { TextAttributes } from "@opentui/core"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { createMemo, createResource, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

interface ReleaseNote {
  version: string
  date: string
  notes: string[]
}

async function getReleaseNotes(): Promise<ReleaseNote[]> {
  try {
    const { stdout } = await execFileAsync(
      "git",
      ["log", "--oneline", "-20", "--format=%H|%s|%ci"],
      {
        encoding: "utf8",
        timeout: 5000,
        maxBuffer: 4 * 1024 * 1024,
      },
    )
    const output = stdout.trim()

    if (!output) return []

    return output
      .split("\n")
      .map((line) => {
        const [hash, subject, date] = line.split("|")
        return {
          version: hash.slice(0, 7),
          date: date?.split(" ")[0] ?? "",
          notes: [subject],
        }
      })
      .filter((note) => note.version)
  } catch {
    return []
  }
}

export function DialogReleaseNotes() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()

  dialog.setSize("large")

  const [notesResource] = createResource(() => getReleaseNotes())
  const notes = createMemo(() => notesResource.latest ?? [])

  const copy = () => {
    const text = notes()
      .map(
        (note) =>
          `[${note.version}] ${note.date}\n${note.notes.map((n) => `  - ${n}`).join("\n")}`,
      )
      .join("\n\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "更新日志已复制", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制更新日志", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Release Notes — 更新日志
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>
        当前版本: <b>{InstallationVersion}</b>
      </text>

      <Show
        when={notes().length > 0}
        fallback={<text fg={theme.textMuted}>无法获取更新日志</text>}
      >
        <For each={notes()}>
          {(note) => (
            <box>
              <box flexDirection="row" gap={1}>
                <text fg={theme.text}>
                  <b>{note.version}</b>
                </text>
                <text fg={theme.textMuted}>{note.date}</text>
              </box>
              <For each={note.notes}>
                {(item) => (
                  <text fg={theme.textMuted} wrapMode="word">
                    {"  - "}{item}
                  </text>
                )}
              </For>
            </box>
          )}
        </For>
      </Show>

      <text fg={theme.textMuted}>完整日志请访问 GitHub 仓库</text>
    </box>
  )
}
