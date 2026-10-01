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
// C-07：与 `gyc db cache` / `gyc stats` 共用同一份命中率实现，避免 UI 与 CLI 各算各的
import { promptCacheStats } from "@gyccode/core/session/cache-rate"

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

  const cacheHitRate = createMemo(() => {
    // C-07：此前这里手写了一份前缀命中率算法，而 `gyc db cache` 与 `gyc stats`
    // 各用 db.ts 的 promptCacheStats。三份口径迟早分叉，界面上显示的命中率就会
    // 和 CLI 报的对不上。改为统一走 promptCacheStats —— UI 与 CLI 同一把尺子。
    const rows = messages()
      .filter((m): m is AssistantMessage => m.role === "assistant" && m.time.completed !== undefined)
      .map((m) => ({
        data: JSON.stringify({
          sessionID: sessionID() ?? "",
          tokens: {
            input: m.tokens.input,
            cache: { read: m.tokens.cache.read, write: m.tokens.cache.write },
          },
        }),
        time_created: m.time.completed ?? 0,
        session_id: sessionID() ?? "",
      }))
    const stats = promptCacheStats(rows)
    // 分母为 0 表示样本不足（如仅有首轮），此时 rate 保持 0 且 base=0，
    // 调用方据此显示「样本不足」而不是一个假的 0%。
    return { rate: stats.prefixBase > 0 ? stats.prefixHit / stats.prefixBase : 0, hitTokens: stats.prefixHit, totalInput: stats.prefixBase }
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
      `token：${totalTokens().toLocaleString()}`,
      `  输入：${t.input.toLocaleString()}`,
      `  输出：${t.output.toLocaleString()}`,
      `  推理：${t.reasoning.toLocaleString()}`,
      `  缓存读取：${t.cacheRead.toLocaleString()}`,
      `  缓存写入：${t.cacheWrite.toLocaleString()}`,
    ].join("\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "Cost info copied to clipboard", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "Copy cost info", group: "对话框", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Cost — Session Spend
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.text}>
        Total Cost: <b>{money.format(cost())}</b>
      </text>

      <Show when={win()}>
        {(w) => (
          <text fg={theme.textMuted}>
            {totalTokens().toLocaleString()} / {Token.format(w().effective)} tokens（{percent()}%）
            {w().source === "config" ? ` (config limit ${Token.format(w().hard)})` : undefined}
          </text>
        )}
      </Show>

      <box>
        <text fg={theme.text}>
          <b>Token 明细</b>
        </text>
        <text fg={theme.textMuted}>输入 {totals().input.toLocaleString()}</text>
        <text fg={theme.textMuted}>输出 {totals().output.toLocaleString()}</text>
        <text fg={theme.textMuted}>推理 {totals().reasoning.toLocaleString()}</text>
        <text fg={theme.textMuted}>缓存读取 {totals().cacheRead.toLocaleString()}</text>
        <text fg={theme.textMuted}>缓存写入 {totals().cacheWrite.toLocaleString()}</text>
        <text fg={theme.accent}>Cache Hit {(cacheHitRate().rate * 100).toFixed(1)}% ({cacheHitRate().hitTokens.toLocaleString()} / {cacheHitRate().totalInput.toLocaleString()})</text>
      </box>

      <box>
        <text fg={theme.text}>
          <b>最近消息</b>
        </text>
        <For each={messages().slice(-10)}>
          {(item) => (
            <text fg={theme.textMuted} wrapMode="none">
{item.role === "assistant"
                  ? `助手：${messageTokens(item).toLocaleString()} token`
                  : `用户：${estimateParts(partOf(item.id)).toLocaleString()} token（估算）`}
            </text>
          )}
        </For>
      </box>

      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>按 enter 复制详细信息</text>
        <text onMouseUp={copy}>
          <span style={{ fg: theme.text }}>
            <b>复制</b>
          </span>{" "}
          <span style={{ fg: theme.textMuted }}>enter</span>
        </text>
      </box>
    </box>
  )
}
