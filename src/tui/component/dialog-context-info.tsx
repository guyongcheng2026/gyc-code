import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"
import { Token } from "@/util/token"
import * as Model from "../util/model"
import type { AssistantMessage, Message, Part } from "@gyccode/protocol/v2"

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

export function DialogContextInfo() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()
  const sdk = useSDK()
  const toast = useToast()

  dialog.setSize("large")

  const sessionID = createMemo(() =>
    route.data.type === "session" ? route.data.sessionID : "",
  )

  const messages = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.message[id] ?? []
  })

  const partOf = (id: string) => sync.data.part[id] ?? []

  const totals = createMemo(() => {
    let input = 0
    let output = 0
    let reasoning = 0
    let cacheRead = 0
    let cacheWrite = 0
    for (const item of messages()) {
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
    const last = messages().findLast((item): item is AssistantMessage => item.role === "assistant")
    if (!last) return undefined
    const provider = sync.data.provider.find((item) => item.id === last.providerID)
    const modelObj = provider?.models[last.modelID]
    return Model.contextWindow(sync.data.config, last.providerID, last.modelID, modelObj)
  })

  const percent = createMemo(() => {
    const w = win()
    if (!w) return null
    return Math.round((tokens() / w.effective) * 100)
  })

  const cost = createMemo(() =>
    messages().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
  )

  const recent = createMemo(() => messages().slice(-20))

  const compact = async () => {
    const last = messages().findLast((item): item is AssistantMessage => item.role === "assistant")
    if (!last) return
    const selectedModel = local.model.current()
    if (!selectedModel) {
      toast.show({
        variant: "warning",
        message: "连接服务商以总结此会话",
        duration: 3000,
      })
      return
    }
    void sdk.client.session.summarize({
      sessionID: sessionID(),
      modelID: selectedModel.modelID,
      providerID: selectedModel.providerID,
    })
    dialog.clear()
  }

  const contextColor = createMemo(() => {
    const pct = percent()
    if (pct === null) return theme.textMuted
    if (pct >= 90) return theme.error
    if (pct >= 70) return theme.warning
    return theme.success
  })

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Context — 上下文详情
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show when={win()}>
        {(w) => (
          <text fg={contextColor()}>
            {tokens().toLocaleString()} / {Token.format(w().effective)} tokens（{percent()}%）
            {w().source === "config" ? `，配置上限 ${Token.format(w().hard)}` : ""}
          </text>
        )}
      </Show>

      <text fg={theme.textMuted}>
        input {totals().input.toLocaleString()} · output {totals().output.toLocaleString()} · reasoning{" "}
        {totals().reasoning.toLocaleString()}
      </text>
      <text fg={theme.textMuted}>
        cache read {totals().cacheRead.toLocaleString()} · cache write {totals().cacheWrite.toLocaleString()}
      </text>
      <text fg={theme.textMuted}>cost {money.format(cost())}</text>

      <box>
        <text fg={theme.text}>
          <b>最近消息</b>
        </text>
        <For each={recent()}>
          {(item) => (
            <text fg={theme.textMuted} wrapMode="none">
              {item.role === "assistant"
                ? `assistant（${item.agent ?? item.mode}）: ${messageTokens(item).toLocaleString()} tokens`
                : `user: ${estimateParts(partOf(item.id)).toLocaleString()} tokens（估算）`}
            </text>
          )}
        </For>
      </box>

      <box marginTop={1}>
        <box
          backgroundColor={theme.backgroundElement}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          onMouseDown={compact}
        >
          <text fg={theme.text}>压缩上下文（/compact）</text>
        </box>
      </box>
    </box>
  )
}
