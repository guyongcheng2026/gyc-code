// 连续空转判定：只有「纯工具调用轮 + 无可见文本 +（工具失败 或 与历史完全重复）」
// 才计为空转。避免把「思考 + 成功执行工具」的正常工作流误判为无进展。
// 原实现只检查「无文本」，会误杀 Compose/DeepSeek 等工具轮不带 text 的模型。

export interface ToolLikePart {
  type: string
  tool?: string
  state?: { status?: string; input?: Record<string, unknown> }
}

export interface ToolStallInput {
  finish: string | undefined
  parts: ReadonlyArray<{
    type: string
    synthetic?: boolean
    tool?: string
    state?: { status?: string; input?: Record<string, unknown> }
  }>
  historySignatures: ReadonlySet<string>
}

/** 稳定序列化工具入参（键排序），保证相同参数产生相同签名。 */
export function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined"
  if (value === null || typeof value !== "object") return JSON.stringify(value)
  if (Array.isArray(value)) return "[" + value.map(stableStringify).join(",") + "]"
  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => JSON.stringify(k) + ":" + stableStringify(v))
  return "{" + entries.join(",") + "}"
}

/** 单轮工具签名列表：工具名 + 稳定入参。 */
export function toolSignatures(parts: ReadonlyArray<ToolLikePart>): string[] {
  return parts
    .filter((part) => part.type === "tool" && part.tool)
    .map((part) => part.tool + ":" + stableStringify(part.state?.input))
}

/** 判定该轮是否属于空转：无可见文本，且（工具失败/未完成 或 全部与历史重复）。 */
export function isStalledToolOnlyStep(input: ToolStallInput): boolean {
  if (input.finish !== "tool-calls") return false
  const hasVisibleText = input.parts.some((part) => part.type === "text" && !part.synthetic)
  if (hasVisibleText) return false
  const toolParts = input.parts.filter((part) => part.type === "tool")
  if (toolParts.length === 0) return false
  const hasFailure = toolParts.some((part) => part.state?.status !== "completed")
  const signatures = toolSignatures(toolParts)
  const allRepeat = signatures.length > 0 && signatures.every((sig) => input.historySignatures.has(sig))
  return hasFailure || allRepeat
}
