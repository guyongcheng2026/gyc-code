import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { createMemo, For, Show, createSignal } from "solid-js"
import { TodoItem } from "../../component/todo-item"

const id = "internal:sidebar-todo"
const RECENT_DONE_LIMIT = 3

const STATUS_ORDER: Record<string, number> = { in_progress: 0, pending: 1 }

/** Sort todos: active work first (in_progress > pending), completed last. */
export function sortTodos<T extends { status: string }>(items: T[]): T[] {
  return [...items].sort(
    (a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) ||
      a.status.localeCompare(b.status),
  )
}

/** Split into active (non-completed) and a recent-done tail. */
export function splitTodos<T extends { status: string }>(items: readonly T[], recentDone = RECENT_DONE_LIMIT) {
  const active = items.filter((t) => t.status !== "completed" && t.status !== "cancelled")
  const done = items.filter((t) => t.status === "completed")
  const visibleDone = done.slice(0, recentDone)
  return {
    active: sortTodos(active),
    visibleDone,
    hiddenDoneCount: Math.max(0, done.length - visibleDone.length),
  }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const [open, setOpen] = createSignal(true)
  const [doneExpanded, setDoneExpanded] = createSignal(false)
  const theme = () => props.api.theme.current
  const all = createMemo(() => props.api.state.session.todo(props.session_id))
  const parts = createMemo(() => splitTodos(all()))
  const rows = createMemo(() => (doneExpanded() ? [...parts().active, ...all().filter((t) => t.status === "completed")] : [...parts().active, ...parts().visibleDone]))
  const show = createMemo(() => rows().length > 0)
  const collapsible = createMemo(() => rows().length + (parts().hiddenDoneCount > 0 ? 1 : 0) > 2)

  return (
    <Show when={show()}>
      <box>
        <box flexDirection="row" gap={1} onMouseDown={() => collapsible() && setOpen((x) => !x)}>
          <Show when={collapsible()}>
            <text fg={theme().text}>{open() ? "\u25BC" : "\u25B6"}</text>
          </Show>
          <text fg={theme().text}>
            <b>Todo</b>
          </text>
        </box>
        <Show when={!collapsible() || open()}>
          <For each={rows()}>{(item) => <TodoItem status={item.status} content={item.content} />}</For>
          <Show when={parts().hiddenDoneCount > 0 || doneExpanded()}>
            <box flexDirection="row" gap={0} onMouseDown={() => setDoneExpanded((x) => !x)}>
              <text fg={theme().textMuted}>
                {doneExpanded() ? "\u25B2 fewer done" : `\u25BC ${parts().hiddenDoneCount} more done`}
              </text>
            </box>
          </Show>
        </Show>
      </box>
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 400,
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