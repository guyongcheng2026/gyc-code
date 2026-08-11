import type { AssistantMessage, Message, Part } from "@opencode-ai/sdk/v2"
import type { TuiPlugin, TuiPluginApi } from "@opencode-ai/plugin/tui"
import type { BuiltinTuiPlugin } from "../builtins"
import { Show, createEffect, createMemo, createSignal, onCleanup } from "solid-js"
import { completedTPS, formatTPS, streamingTPS } from "./tps"
import { Token } from "@/util/token"
import * as Model from "../../util/model"
import { DialogContext } from "../../component/dialog-context"

const id = "internal:sidebar-context"
const REFRESH_MS = 2000

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function estimatePart(part: Part): number {
  if (part.type === "text" || part.type === "reasoning") return Token.estimate(part.text)
  if (part.type === "tool") {
    return Math.max(1, Math.ceil(JSON.stringify({ tool: part.tool, state: part.state }).length / 4))
  }
  return 0
}

function estimateMessage(message: Message, partOf: (id: string) => ReadonlyArray<Part>): number {
  if (message.role === "assistant" && message.time.completed) {
    return (
      message.tokens.input +
      message.tokens.output +
      message.tokens.reasoning +
      message.tokens.cache.read +
      message.tokens.cache.write
    )
  }
  return partOf(message.id).reduce((sum, part) => sum + estimatePart(part), 0)
}

function View(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const cost = createMemo(() => msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0))

  const [tick, setTick] = createSignal(Date.now())

  const lastAssistant = createMemo(() =>
    msg().findLast((item): item is AssistantMessage => item.role === "assistant"),
  )

  const isStreaming = createMemo(() => {
    const m = lastAssistant()
    return m !== undefined && !m.time.completed
  })

  const session = createMemo(() => props.api.state.session.get(props.session_id))
  const isCompacting = createMemo(() => session()?.time.compacting !== undefined)
  const isBusy = createMemo(() => {
    if (isCompacting()) return true
    const last = msg().at(-1)
    if (!last) return false
    if (last.role === "user") return true
    return last.time.completed === undefined
  })

  createEffect(() => {
    if (!isStreaming() && !isBusy()) return
    const handle = setInterval(() => setTick(Date.now()), REFRESH_MS)
    onCleanup(() => clearInterval(handle))
  })

  const tps = createMemo<number | null>(() => {
    const m = lastAssistant()
    if (!m) return null

    if (isStreaming()) {
      tick() // reactivity dep so the readout updates between deltas
      const parts = props.api.state.part(m.id)
      const combined = parts
        .filter((p) => p.type === "text" || p.type === "reasoning")
        .map((p) => p.text)
        .join("")
      return streamingTPS(combined, m.time.created, Date.now())
    }

    const idleTarget = msg().findLast(
      (item): item is AssistantMessage =>
        item.role === "assistant" &&
        item.time.completed !== undefined &&
        item.tokens.output + item.tokens.reasoning > 0,
    )
    if (!idleTarget || idleTarget.time.completed === undefined) return null
    return completedTPS(
      idleTarget.tokens.output,
      idleTarget.tokens.reasoning,
      idleTarget.time.created,
      idleTarget.time.completed,
    )
  })

  const tpsLabel = createMemo(() => formatTPS(tps()))

  const state = createMemo(() => {
    const msgs = msg()
    const last = msgs.findLast((item): item is AssistantMessage => item.role === "assistant" && item.tokens.output > 0)
    if (!last) {
      return {
        tokens: 0,
        percent: null,
        limit: null,
        compacting: isCompacting(),
      }
    }

    let tokens =
      last.tokens.input + last.tokens.output + last.tokens.reasoning + last.tokens.cache.read + last.tokens.cache.write
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    const win = Model.contextWindow(props.api.state.config, last.providerID, last.modelID, model)
    if (isBusy()) {
      tick() // 忙碌态由 2s 节流驱动实时估算
      tokens = msgs.reduce((sum, message) => sum + estimateMessage(message, (id) => props.api.state.part(id)), 0)
    }
    return {
      tokens,
      percent: win ? Math.round((tokens / win.effective) * 100) : null,
      limit: win,
      compacting: isCompacting(),
    }
  })

  const contextColor = createMemo(() => {
    const pct = state().percent
    if (pct === null) return theme().textMuted
    if (pct >= 95) return theme().error
    if (pct >= 80) return theme().warning
    return theme().textMuted
  })

  return (
    <box onMouseDown={() => props.api.ui.dialog.replace(() => <DialogContext api={props.api} session_id={props.session_id} />)}>
      <text fg={theme().text}>
        <b>Context</b>
      </text>
      <Show when={state().compacting}>
        <text fg={theme().warning}>compacting…</text>
      </Show>
      <text fg={contextColor()}>{state().tokens.toLocaleString()} tokens</text>
      <text fg={contextColor()}>{state().percent ?? 0}% used</text>
      <Show when={state().limit}>
        {(win) => (
          <text fg={theme().textMuted}>
            limit {Token.format(win().effective)}
            {win().source === "config" ? ` of ${Token.format(win().hard)}` : ""}
          </text>
        )}
      </Show>
      <Show when={tpsLabel()}>{(label) => <text fg={theme().textMuted}>{label()}</text>}</Show>
      <text fg={theme().textMuted}>{money.format(cost())} spent</text>
    </box>
  )
}

const tui: TuiPlugin = async (api) => {
  api.slots.register({
    order: 100,
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
