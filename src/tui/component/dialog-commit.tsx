import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { execSync } from "node:child_process"

interface GitStatus {
  staged: string[]
  unstaged: string[]
  untracked: string[]
  branch: string
  ahead: number
  behind: number
}

function runGit(args: string[], cwd?: string): string {
  try {
    return execSync(`git ${args.join(" ")}`, {
      encoding: "utf8",
      timeout: 5000,
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } catch {
    return ""
  }
}

function parseStatus(cwd?: string): GitStatus {
  const branch = runGit(["rev-parse", "--abbrev-ref", "HEAD"], cwd) || "unknown"
  const output = runGit(["status", "--porcelain=v1", "-z"], cwd)
  const staged: string[] = []
  const unstaged: string[] = []
  const untracked: string[] = []

  for (const line of output.split("\0")) {
    if (!line) continue
    const status = line[0]
    const file = line.slice(3)
    if (status === "?") untracked.push(file)
    else if (status === "A" || status === "M" || status === "D" || status === "R") staged.push(file)
    else unstaged.push(file)
  }

  const tracking = runGit(["rev-list", "--left-right", "--count", "@{upstream}...HEAD"], cwd)
  const [behind, ahead] = tracking.split(/\s+/).map((n) => parseInt(n, 10) || 0)

  return { staged, unstaged, untracked, branch, ahead, behind }
}

export function DialogCommit() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()

  dialog.setSize("large")

  const status = createMemo<GitStatus>(() => parseStatus())

  const totalChanges = createMemo(
    () =>
      status().staged.length +
      status().unstaged.length +
      status().untracked.length,
  )

  const copy = () => {
    const s = status()
    const text = [
      `Branch: ${s.branch}`,
      `Ahead: ${s.ahead}, Behind: ${s.behind}`,
      `Staged (${s.staged.length}):`,
      ...s.staged.map((f) => `  ${f}`),
      `Unstaged (${s.unstaged.length}):`,
      ...s.unstaged.map((f) => `  ${f}`),
      `Untracked (${s.untracked.length}):`,
      ...s.untracked.map((f) => `  ${f}`),
    ].join("\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "Git 状态已复制", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制 Git 状态", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Commit — Git 提交
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box flexDirection="row" gap={2}>
        <text fg={theme.text}>
          分支: <b>{status().branch}</b>
        </text>
        <Show when={status().ahead > 0}>
          <text fg={theme.success}>↑ {status().ahead}</text>
        </Show>
        <Show when={status().behind > 0}>
          <text fg={theme.warning}>↓ {status().behind}</text>
        </Show>
      </box>

      <Show
        when={totalChanges() > 0}
        fallback={<text fg={theme.success}>工作区干净，无待提交更改</text>}
      >
        <Show when={status().staged.length > 0}>
          <box>
            <text fg={theme.success}>
              <b>已暂存 ({status().staged.length})</b>
            </text>
            <For each={status().staged}>
              {(file) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {"  +"} {file}
                </text>
              )}
            </For>
          </box>
        </Show>

        <Show when={status().unstaged.length > 0}>
          <box>
            <text fg={theme.warning}>
              <b>未暂存 ({status().unstaged.length})</b>
            </text>
            <For each={status().unstaged}>
              {(file) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {"  ~"} {file}
                </text>
              )}
            </For>
          </box>
        </Show>

        <Show when={status().untracked.length > 0}>
          <box>
            <text fg={theme.textMuted}>
              <b>未跟踪 ({status().untracked.length})</b>
            </text>
            <For each={status().untracked}>
              {(file) => (
                <text fg={theme.textMuted} wrapMode="none">
                  {"  ?"} {file}
                </text>
              )}
            </For>
          </box>
        </Show>
      </Show>

      <text fg={theme.textMuted}>请在终端使用 git commit 提交更改</text>
    </box>
  )
}
