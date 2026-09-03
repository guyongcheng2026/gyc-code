import { Formatter, Logger, type LogLevel } from "effect"
import path from "path"
import { appendFile, rename, stat } from "fs/promises"
import { Global } from "../global"
import { runID } from "./shared"

// Cap the on-disk log so a long-running (24h+) session cannot grow it without
// bound. The newest log is always "gyccode.log"; when it exceeds the cap it is
// rotated to "gyccode.log.1" (previous rotated copies are discarded).
const MAX_LOG_BYTES = 5 * 1024 * 1024
const ROTATE_CHECK_INTERVAL_MS = 5000
// Serialize appends so log lines stay ordered (fire-and-forget would interleave).
let writeQueue: Promise<void> = Promise.resolve()

// Throttle repeated log lines so a failing provider (e.g. a 60s header
// timeout retried 3x per step) or a busy loop cannot flood the log file with
// identical entries. Same run + level + message within the window collapses
// to one line. Applied to WARN and above, where repeated noise is most costly.
const THROTTLE_MS = 60_000
const THROTTLE_MAX_KEYS = 200
const lineThrottle = new Map<string, { time: number }>()

function suppressedLine(key: string): boolean {
  const now = Date.now()
  const hit = lineThrottle.get(key)
  if (hit && now - hit.time < THROTTLE_MS) return true
  if (lineThrottle.size >= THROTTLE_MAX_KEYS) {
    const oldest = lineThrottle.keys().next().value
    if (oldest !== undefined) lineThrottle.delete(oldest)
  }
  lineThrottle.set(key, { time: now })
  return false
}

// INFO-level noise (e.g. per-step lifecycle logs) is bounded by default INFO
// level filtering; WARN/ERROR get the throttle on top.
function shouldThrottle(level: string): boolean {
  return level === "Error" || level === "Warning"
}

function formatter(id: string = runID) {
  return Logger.map(Logger.formatStructured, (output) => {
    const messages = Array.isArray(output.message) ? output.message : [output.message]
    return [
      ["timestamp", output.timestamp],
      ["level", output.level],
      ["run", id],
      ...messages.flatMap((value) => (plain(value) ? flatten(value) : [["message", value] as const])),
      ...(output.cause === undefined ? [] : [["cause", output.cause] as const]),
      ...flatten(output.spans),
      ...flatten(output.annotations),
    ]
      .map(([key, value]) => `${key}=${format(value)}`)
      .join(" ")
  })
}

function flatten(
  input: Record<string, unknown>,
  prefix = "",
  seen = new WeakSet<object>(),
): Array<readonly [string, unknown]> {
  if (seen.has(input)) return [[prefix, "[Circular]"]]
  seen.add(input)
  const entries = Object.entries(input)
  if (entries.length === 0 && prefix) return [[prefix, input]]
  return entries.flatMap(([key, value]) => {
    const path = prefix ? `${prefix}.${key}` : key
    return plain(value) ? flatten(value, path, seen) : [[path, value] as const]
  })
}

function plain(input: unknown): input is Record<string, unknown> {
  if (input === null || typeof input !== "object" || Array.isArray(input)) return false
  const prototype = Object.getPrototypeOf(input)
  return prototype === Object.prototype || prototype === null
}

function format(input: unknown) {
  const value = typeof input === "string" ? input : Formatter.format(input)
  return /^[^\s="\\]+$/.test(value) ? value : JSON.stringify(value)
}

// Batch log lines in memory and flush them with a single appendFile every
// FLUSH_INTERVAL_MS (or when the buffer fills). Collapsing many small writes
// into one large write drastically cuts disk activity, which matters on
// spinning disks where each write triggers an audible head seek. The trailing
// <1s of logs may be lost on exit (timer is unref'd); acceptable for
// diagnostics.
const FLUSH_INTERVAL_MS = 1000
const FLUSH_MAX_LINES = 500

export function fileLogger(file = path.join(Global.Path.log, "gyccode.log"), id: string = runID) {
  const fmt = formatter(id)
  let lastCheck = 0
  let pending: string[] = []
  let flushTimer: NodeJS.Timeout | undefined

  const drain = () => {
    if (flushTimer) {
      clearTimeout(flushTimer)
      flushTimer = undefined
    }
    if (pending.length === 0) return
    const chunk = pending.join("")
    pending = []
    writeQueue = writeQueue.then(async () => {
      const now = Date.now()
      if (now - lastCheck > ROTATE_CHECK_INTERVAL_MS) {
        lastCheck = now
        try {
          const info = await stat(file)
          if (info.size > MAX_LOG_BYTES) {
            // 日志轮转时旧文件可能已被占用或不存在，失败不阻断写入
            await rename(file, `${file}.1`).catch(() => {})
          }
        } catch {
          // File may not exist yet; nothing to rotate.
        }
      }
      await appendFile(file, chunk).catch(() => {
        // Never let a logging failure crash the session.
      })
    })
  }

  return Logger.make((options) => {
    if (shouldThrottle(options.logLevel)) {
      const key = `${id}:${options.logLevel}:${String(options.message)}`
      if (suppressedLine(key)) return
    }
    pending.push(fmt.log(options) + "\n")
    if (pending.length >= FLUSH_MAX_LINES) {
      drain()
      return
    }
    if (!flushTimer) {
      flushTimer = setTimeout(drain, FLUSH_INTERVAL_MS)
      // Do not keep the process alive just to flush trailing log lines.
      flushTimer.unref?.()
    }
  })
}

const stderrLogger = Logger.make((options) => process.stderr.write(formatter().log(options) + "\n"))

export function minimumLogLevel() {
  const value = process.env.GYCCODE_LOG_LEVEL?.toUpperCase()
  const levels = {
    DEBUG: "Debug",
    INFO: "Info",
    WARN: "Warn",
    ERROR: "Error",
  } as const satisfies Record<string, LogLevel.LogLevel>
  return value && value in levels ? levels[value as keyof typeof levels] : levels.INFO
}

export function loggers() {
  return process.env.GYCCODE_PRINT_LOGS === "1" ? [fileLogger(), stderrLogger] : [fileLogger()]
}

export * as Logging from "./logging"
