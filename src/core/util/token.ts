export * as Token from "./token"

const CHARS_PER_TOKEN = 4
const JSON_CHARS_PER_TOKEN = 2

export const estimate = (input: string) => {
  const perToken = isJson(input) ? JSON_CHARS_PER_TOKEN : CHARS_PER_TOKEN
  return Math.max(0, Math.round(input.length / perToken))
}

function isJson(input: string) {
  const head = input.trimStart()
  return head.startsWith("{") || head.startsWith("[")
}

// Compact token count for display: 300000 -> "300K", 1050000 -> "1.05M".
export const format = (value: number) => {
  if (value >= 1_000_000) return `${Number((value / 1_000_000).toFixed(2))}M`
  if (value >= 1_000) return `${Math.round(value / 1_000)}K`
  return `${value}`
}
