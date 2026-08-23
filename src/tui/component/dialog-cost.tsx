import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"
import { Token } from "@/util/token"
import * as Model from "../util/model"
import type { AssistantMessage, Message, Part } from "@gyccode/protocol/v2"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

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

export function DialogCost() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const clipboard = useClipboard()
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

  const totalTokens = createMemo(() => {
    const t = totals()
    return t.input + t.output + t.reasoning + t.cacheRead + t.cacheWrite
  })

  const cost = createMemo(() =>
    messages().reduce((sum, item) => sum + (item.role === "assistant" ? item.cost : 0), 0),
  )

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
    return Math.round((totalTokens() / w.effective) * 100)
  })

  const copy = () => {
    const t = totals()
    const text = [
      `Cost: ${money.format(cost())}`,
      `Tokens: ${totalTokens().toLocaleString()}`,
      `  Input: ${t.input.toLocaleString()}`,
      `  Output: ${t.output.toLocaleString()}`,
      `  Reasoning: ${t.reasoning.toLocaleString()}`,
      `  Cache Read: ${t.cacheRead.toLocaleString()}`,
      `  Cache Write: ${t.cacheWrite.toLocaleString()}`,
    ].join("\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "花费信息已复制到剪贴板", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制花费信息", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Cost — 会话花费
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.text}>
        总花费: <b>{money.format(cost())}</b>
      </text>

      <Show when={win()}>
        {(w) => (
          <text fg={theme.textMuted}>
            {totalTokens().toLocaleString()} / {Token.format(w().effective)} tokens（{percent()}%）
            {w().source === "config" ? `，配置上限 ${Token.format(w().hard)}` : undefined}
          </text>
        )}
      </Show>

      <box>
        <text fg={theme.text}>
          <b>Token 明细</b>
        </text>
        <text fg={theme.textMuted}>input {totals().input.toLocaleString()}</text>
        <text fg={theme.textMuted}>output {totals().output.toLocaleString()}</text>
        <text fg={theme.textMuted}>reasoning {totals().reasoning.toLocaleString()}</text>
        <text fg={theme.textMuted}>cache read {totals().cacheRead.toLocaleString()}</text>
        <text fg={theme.textMuted}>cache write {totals().cacheWrite.toLocaleString()}</text>
      </box>

      <box>
        <text fg={theme.text}>
          <b>最近消息</b>
        </text>
        <For each={messages().slice(-10)}>
          {(item) => (
            <text fg={theme.textMuted} wrapMode="none">
              {item.role === "assistant"
                ? `assistant: ${messageTokens(item).toLocaleString()} tokens`
                : `user: ${estimateParts(partOf(item.id)).toLocaleString()} tokens（估算）`}
            </text>
          )}
        </For>
      </box>

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>按 enter 复制详细信息</text>
        <text onMouseUp={copy}>
          <span style={{ fg: theme.text }}>
            <b>copy</b>
          </span>{" "}
          <span style={{ fg: theme.textMuted }}>enter</span>
        </text>
      </box>
    </box>
  )
}
