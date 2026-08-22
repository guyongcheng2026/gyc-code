import { expect, test } from "bun:test"
import { formatSessionTitleDate, isDefaultTitle } from "./date"

function localOffsetOf(date: Date): string {
  const offsetMin = -date.getTimezoneOffset()
  const sign = offsetMin >= 0 ? "+" : "-"
  const abs = Math.abs(offsetMin)
  const pad = (n: number) => String(n).padStart(2, "0")
  return `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
}

function localWallClock(date: Date): string {
  const pad = (n: number, w = 2) => String(n).padStart(w, "0")
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`
}

test("formatSessionTitleDate: 输出含本地时区偏移后缀，格式为 YYYY-MM-DDTHH:mm:ss.SSS±HH:MM", () => {
  const title = formatSessionTitleDate(new Date("2026-08-11T15:22:51.123Z"))
  expect(title).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{2}:\d{2}$/)
})

test("formatSessionTitleDate: 偏移后缀与机器当前时区一致", () => {
  const d = new Date("2026-08-11T15:22:51.123Z")
  expect(formatSessionTitleDate(d).endsWith(localOffsetOf(d))).toBe(true)
})

test("formatSessionTitleDate: 墙钟部分为本机本地时间（非 UTC）", () => {
  const d = new Date("2026-08-11T15:22:51.123Z")
  expect(formatSessionTitleDate(d).startsWith(localWallClock(d))).toBe(true)
})

test("formatSessionTitleDate: 毫秒三位补零", () => {
  expect(formatSessionTitleDate(new Date(2026, 7, 11, 23, 22, 51, 5))).toContain(".005")
  expect(formatSessionTitleDate(new Date(2026, 7, 11, 23, 22, 51, 0))).toContain(".000")
})

test("formatSessionTitleDate: 本地时间 + 偏移可还原绝对时刻（跨时区/DST 不丢信息）", () => {
  const d = new Date("2026-08-11T15:22:51.123Z")
  const title = formatSessionTitleDate(d)
  const m = title.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})\.(\d{3})([+-]\d{2}:\d{2})$/)
  expect(m).not.toBeNull()
  const [, y, mo, day, h, mi, s, ms, off] = m!
  const sign = off[0] === "+" ? 1 : -1
  const [oh, om] = off.slice(1).split(":").map(Number)
  const localUtc = Date.UTC(Number(y), Number(mo) - 1, Number(day), Number(h), Number(mi), Number(s), Number(ms))
  const offsetMs = sign * (oh * 60 + om) * 60000
  expect(localUtc - offsetMs).toBe(d.getTime())
})

test("isDefaultTitle: 新格式（本地时间无后缀）识别", () => {
  expect(isDefaultTitle("New session - 2026-08-11T23:22:51.123")).toBe(true)
  expect(isDefaultTitle("Child session - 2026-08-11T23:22:51.123")).toBe(true)
})

test("isDefaultTitle: 旧格式（UTC Z 后缀）识别", () => {
  expect(isDefaultTitle("New session - 2026-08-11T15:22:51.123Z")).toBe(true)
})

test("isDefaultTitle: 带时区偏移后缀识别", () => {
  expect(isDefaultTitle("New session - 2026-08-11T23:22:51.123+08:00")).toBe(true)
  expect(isDefaultTitle("New session - 2026-08-11T15:22:51.123-05:00")).toBe(true)
})

test("isDefaultTitle: 拒绝非默认标题", () => {
  expect(isDefaultTitle("我的自定义标题")).toBe(false)
  expect(isDefaultTitle("")).toBe(false)
  expect(isDefaultTitle("New session - 2026-08-11T23:22:51.12")).toBe(false)
  expect(isDefaultTitle("New session - 2026-08-11 23:22:51.123")).toBe(false)
  expect(isDefaultTitle("New session - 2026-08-11T23:22:51.123+8:00")).toBe(false)
  expect(isDefaultTitle("Session - 2026-08-11T23:22:51.123")).toBe(false)
})
