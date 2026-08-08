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
