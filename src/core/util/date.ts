// 会话默认标题使用本机本地时间格式化，避免 toISOString() 的 UTC（带 Z）与本机系统时间不一致。
export function formatSessionTitleDate(date: Date): string {
  const pad = (value: number, width = 2) => String(value).padStart(width, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}
