import type { AssistantMessage, Message, Part } from "@gyccode/protocol/v2"
import type { TuiPluginApi } from "@gyccode/protocol/plugin/tui"
import { createMemo, For, Show } from "solid-js"
import { Token } from "@/util/token"
import * as Model from "../util/model"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

function estimateParts(parts: ReadonlyArray<Part>): number {
  let total = 0
  for (const part of parts) {
    if (part.type === "text" || part.type === "reasoning") {
      total += Token.estimate(part.text)
    } else if (part.type === "tool") {
      total += Math.max(1, Math.ceil(JSON.stringify({ tool: part.tool, state: part.state }).length / 4))
    }
  }
  return total
}

function messageTokens(item: Message): number {
  if (item.role !== "assistant") return 0
  return (
    item.tokens.input +
    item.tokens.output +
    item.tokens.reasoning +
    item.tokens.cache.read +
    item.tokens.cache.write
  )
}

export function DialogContext(props: { api: TuiPluginApi; session_id: string }) {
  const theme = () => props.api.theme.current
  const Dialog = props.api.ui.Dialog
  const msg = createMemo(() => props.api.state.session.messages(props.session_id))
  const partOf = (id: string) => props.api.state.part(id)

  const totals = createMemo(() => {
    let input = 0
    let output = 0
    let reasoning = 0
    let cacheRead = 0
    let cacheWrite = 0
    for (const item of msg()) {
      if (item.role !== "assistant" || !item.time.completed) continue
      input += item.tokens.input
      output += item.tokens.output
      reasoning += item.tokens.reasoning
      cacheRead += item.tokens.cache.read
      cacheWrite += item.tokens.cache.write
    }
    return { input, output, reasoning, cacheRead, cacheWrite }
  })

  const tokens = createMemo(() => {
    const t = totals()
    return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite
  })

  const win = createMemo(() => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant")
    if (!last) return undefined
    const model = props.api.state.provider.find((item) => item.id === last.providerID)?.models[last.modelID]
    return Model.contextWindow(props.api.state.config, last.providerID, last.modelID, model)
  })

  const percent = createMemo(() => {
    const w = win()
    if (!w) return null
    return Math.round((tokens() / w.effective) * 100)
  })

  const cost = createMemo(() =>
    msg().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
  )

  const recent = createMemo(() => msg().slice(-20))

  const compact = async () => {
    const last = msg().findLast((item): item is AssistantMessage => item.role === "assistant")
    if (!last) return
    await props.api.client.session.summarize({
      sessionID: props.session_id,
      providerID: last.providerID,
      modelID: last.modelID,
    })
    props.api.ui.dialog.clear()
  }

  return (
    <Dialog size="large" onClose={() => props.api.ui.dialog.clear()}>
      <box flexDirection="column" gap={1}>
        <text fg={theme().text}>
          <b>Context 详情</b>
        </text>
        <Show when={win()}>
          {(w) => (
            <text fg={theme().textMuted}>
              {tokens().toLocaleString()} / {Token.format(w().effective)} tokens（{percent()}%）
              {w().source === "config" ? `，配置上限 ${Token.format(w().hard)}` : ""}
            </text>
          )}
        </Show>
        <text fg={theme().textMuted}>
          input {totals().input.toLocaleString()} · output {totals().output.toLocaleString()} · reasoning{" "}
          {totals().reasoning.toLocaleString()}
        </text>
        <text fg={theme().textMuted}>
          cache read {totals().cacheRead.toLocaleString()} · cache write {totals().cacheWrite.toLocaleString()}
        </text>
        <text fg={theme().textMuted}>cost {money.format(cost())}</text>
        <text fg={theme().text}>最近消息</text>
        <For each={recent()}>
          {(item) => (
            <text fg={theme().textMuted} wrapMode="none">
              {item.role === "assistant"
                ? `assistant（${item.agent ?? item.mode}）: ${messageTokens(item).toLocaleString()} tokens`
                : `user: ${estimateParts(partOf(item.id)).toLocaleString()} tokens（估算）`}
            </text>
          )}
        </For>
        <box marginTop={1}>
          <box
            backgroundColor={theme().backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            onMouseDown={compact}
          >
            <text fg={theme().text}>压缩上下文（/compact）</text>
          </box>
        </box>
      </box>
    </Dialog>
  )
}
