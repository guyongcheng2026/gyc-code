import type { TuiPlugin, TuiPluginApi } from "@gyccode/protocol/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { For, Show, createMemo } from "solid-js"

const id = "internal:sidebar-instructions"

/** Abbreviate a file path for sidebar display (drop the project-relative prefix). */
export function abbreviateInstruction(file: string, projectDir: string | undefined): string {
  const dir = projectDir || ""
  const normalized = file.replaceAll("\\", "/")
  if (dir && normalized.startsWith(dir.replaceAll("\\", "/"))) {
    return normalized.slice(dir.length).replace(/^\/+/, "")
  }
  return normalized
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const list = createMemo(() => props.api.state.session.instructions(props.session_id))
  const projectDir = createMemo(() => props.api.state.path.directory)

  return (
    <Show when={list().length > 0}>
      <box>
        <box flexDirection="row" gap={1}>
          <text fg={theme().text}>
            <b>Instructions</b>
          </text>
        </box>
        <For each={list()}>
          {(file) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={theme().primary}>
                {"\u2022"}
              </text>
              <text fg={theme().textMuted} wrapMode="none">
                {abbreviateInstruction(file, projectDir())}
              </text>
            </box>
          )}
        </For>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 150,
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