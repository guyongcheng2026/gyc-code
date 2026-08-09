import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo } from "solid-js"

const id = "internal:sidebar-cwd"

/** Normalize a working-directory path for display (forward slashes; fall back to the project directory). */
export function formatCwd(cwd: string | undefined, projectDir: string | undefined): string {
  const dir = cwd || projectDir || ""
  if (!dir) return ""
  return dir.replaceAll("\\", "/")
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const cwd = createMemo(() => props.api.state.session.cwd(props.session_id))
  const projectDir = createMemo(() => props.api.state.path.directory)
  const display = createMemo(() => formatCwd(cwd(), projectDir()))

  return (
    <box>
      <text fg={theme().text}>
        <b>CWD</b>
      </text>
      <text fg={theme().textMuted}>{display()}</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 125,
    slots: {
      sidebar_content(_ctx, props) {
        return <View api={api} session_id={props.session_id} />
      },
    },
  })
}

const plugin: BuiltinTuiPlugin = {
  id,
  tui,
}

export default plugin