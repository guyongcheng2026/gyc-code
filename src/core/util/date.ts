// 会话默认标题使用本机本地时间格式化，避免 toISOString() 的 UTC（带 Z）与本机系统时间不一致。
// 后缀附带本机时区偏移（如 +08:00），既显示本地钟点，又保留绝对时刻，跨时区/换机/DST 均不丢信息。
export const parentTitlePrefix = "New session - "
export const childTitlePrefix = "Child session - "

export function formatSessionTitleDate(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0")
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? "+" : "-"
  const abs = Math.abs(offsetMin)
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}${offset}`
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")

// 单一来源：默认标题的识别与生成共用 parentTitlePrefix/childTitlePrefix，前缀演进不会造成正则漂移。
export function isDefaultTitle(title: string) {
  return new RegExp(
    `^(${escapeRegExp(parentTitlePrefix)}|${escapeRegExp(childTitlePrefix)})\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}(Z|[+-]\\d{2}:\\d{2})?$`,
  ).test(title)
}
