import { createSignal, onCleanup, Show } from "solid-js"
import { useEvent } from "../context/event"
import { useSync } from "../context/sync"
import { useTheme } from "../context/theme"
import { predictNextStep } from "../prompt/next-step"

const HINT_DURATION_MS = 6000

export function NextStepHint(props: { sessionID: string }) {
  const event = useEvent()
  const sync = useSync()
  const { theme } = useTheme()
  const [hint, setHint] = createSignal<string>()
  let timer: ReturnType<typeof setTimeout> | undefined

  function show(text: string) {
    setHint(text)
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => setHint(undefined), HINT_DURATION_MS)
  }

  onCleanup(() => {
    if (timer) clearTimeout(timer)
  })

  event.on("message.part.updated", (evt) => {
    const part = evt.properties.part
    if (part.type !== "tool") return
    if (part.sessionID !== props.sessionID) return
    if (part.state.status !== "completed") return

    const output =
      part.state.status === "completed" && typeof part.state.output === "string" ? part.state.output : ""
    const todos = sync.data.todo[props.sessionID] ?? []
    const prediction = predictNextStep({
      todos,
      lastToolName: part.tool,
      lastToolOutput: output,
    })
    if (prediction) show(prediction)
  })

  return (
    <Show when={hint()}>
      {(h) => (
        <box paddingLeft={3} flexDirection="row" gap={1}>
          <text fg={theme.accent}>▶</text>
          <text fg={theme.text}>下一步: {h()}</text>
        </box>
      )}
    </Show>
  )
}