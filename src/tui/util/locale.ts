export function titlecase(str: string) {
  return str.replace(/\b\w/g, (c) => c.toUpperCase())
}

export function time(input: number): string {
  const date = new Date(input)
  return date.toLocaleTimeString(undefined, { timeStyle: "short" })
}

export function datetime(input: number): string {
  const date = new Date(input)
  const localTime = time(input)
  const localDate = date.toLocaleDateString()
  return `${localTime} · ${localDate}`
}

export function todayTimeOrDateTime(input: number): string {
  const date = new Date(input)
  const now = new Date()
  const isToday =
    date.getFullYear() === now.getFullYear() && date.getMonth() === now.getMonth() && date.getDate() === now.getDate()

  if (isToday) {
    return time(input)
  } else {
    return datetime(input)
  }
}

export function number(num: number): string {
  if (num >= 1000000) {
    return (num / 1000000).toFixed(1) + "M"
  } else if (num >= 1000) {
    return (num / 1000).toFixed(1) + "K"
  }
  return num.toString()
}

export function duration(input: number) {
  if (input < 1000) {
    return `${input}ms`
  }
  if (input < 60000) {
    return `${(input / 1000).toFixed(1)}s`
  }
  if (input < 3600000) {
    const minutes = Math.floor(input / 60000)
    const seconds = Math.floor((input % 60000) / 1000)
    return `${minutes}m ${seconds}s`
  }
  if (input < 86400000) {
    const hours = Math.floor(input / 3600000)
    const minutes = Math.floor((input % 3600000) / 60000)
    return `${hours}h ${minutes}m`
  }
  const days = Math.floor(input / 86400000)
  const hours = Math.floor((input % 86400000) / 3600000)
  return `${days}d ${hours}h`
}

// 增补平面字符（emoji、部分生僻字）在 UTF-16 中占两个码元。只有含代理对时，
// str.length 才会与「字符数」不等。truncate 属 TUI 每行渲染热路径，
// 绝大多数文本是纯 BMP 字符，用一次正则快筛避免为每个字符串分配码点数组。
const HAS_SURROGATE_PAIR = /[\uD800-\uDBFF]/

export function truncate(str: string, len: number): string {
  if (len <= 0) return ""
  if (!HAS_SURROGATE_PAIR.test(str)) {
    if (str.length <= len) return str
    return str.slice(0, len - 1) + "…"
  }
  // 按码点切片：UTF-16 长度会把中文/emoji 切出半个代理对
  const chars = Array.from(str)
  if (chars.length <= len) return str
  if (len === 1) return "…"
  return chars.slice(0, len - 1).join("") + "…"
}

export function truncateLeft(str: string, len: number): string {
  if (len <= 0) return ""
  if (!HAS_SURROGATE_PAIR.test(str)) {
    if (str.length <= len) return str
    return "…" + str.slice(-(len - 1))
  }
  const chars = Array.from(str)
  if (chars.length <= len) return str
  if (len === 1) return "…"
  return "…" + chars.slice(chars.length - (len - 1)).join("")
}

export function truncateMiddle(str: string, maxLength: number = 35): string {
  if (str.length <= maxLength) return str

  const ellipsis = "…"
  const keepStart = Math.ceil((maxLength - ellipsis.length) / 2)
  const keepEnd = Math.floor((maxLength - ellipsis.length) / 2)

  return str.slice(0, keepStart) + ellipsis + str.slice(-keepEnd)
}

export function pluralize(count: number, singular: string, plural: string): string {
  const template = count === 1 ? singular : plural
  return template.replace("{}", count.toString())
}

export * as Locale from "./locale"
