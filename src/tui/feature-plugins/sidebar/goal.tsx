import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { Show, createMemo } from "solid-js"

const id = "internal:sidebar-goal"

export type GoalVerdictView = {
  ok: boolean
  impossible?: boolean
  error?: boolean
  reason: string
  attempt: number
}

export type GoalStateView = {
  condition: string
  lastVerdict?: GoalVerdictView
}

export type GoalStatus = {
  kind: "error" | "met" | "impossible" | "pending"
  label: string
}

/** Derive the judge status line from the latest verdict (pure, testable). */
export function goalStatus(verdict: GoalVerdictView | undefined): GoalStatus | undefined {
  if (!verdict) return undefined
  if (verdict.error) return { kind: "error", label: "error (stopped)" }
  if (verdict.ok) return { kind: "met", label: "met" }
  if (verdict.impossible) return { kind: "impossible", label: "impossible" }
  return { kind: "pending", label: `round ${verdict.attempt} · not met` }
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const goal = createMemo(() => props.api.state.session.goal(props.session_id) as GoalStateView | undefined)
  const status = createMemo(() => goalStatus(goal()?.lastVerdict))

  return (
    <Show when={goal()?.condition}>
      {(condition) => (
        <box>
          <box flexDirection="row" gap={1}>
            <text fg={theme().text}>
              <b>Goal</b>
            </text>
          </box>
          <box flexDirection="row" gap={1}>
            <text flexShrink={0} fg={theme().primary}>
              {"\u2022"}
            </text>
            <text fg={theme().textMuted} wrapMode="word">
              {condition()}
            </text>
          </box>
          <Show when={status()}>
            {(s) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={s().kind === "met" ? theme().success : s().kind === "impossible" ? theme().error : theme().warning}>
                  {"\u2022"}
                </text>
                <text fg={theme().textMuted} wrapMode="word">
                  Judge: {s().label}
                </text>
              </box>
            )}
          </Show>
        </box>
      )}
    </Show>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 350,
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