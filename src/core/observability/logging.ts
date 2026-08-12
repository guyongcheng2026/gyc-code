import { Formatter, Logger, type LogLevel } from "effect"
import path from "path"
import { appendFile, rename, stat } from "fs/promises"
import { Global } from "../global"
import { runID } from "./shared"

// Cap the on-disk log so a long-running (24h+) session cannot grow it without
// bound. The newest log is always "gyccode.log"; when it exceeds the cap it is
// rotated to "gyccode.log.1" (previous rotated copies are discarded).
const MAX_LOG_BYTES = 10 * 1024 * 1024
const ROTATE_CHECK_INTERVAL_MS = 5000
// Serialize appends so log lines stay ordered (fire-and-forget would interleave).
let writeQueue: Promise<void> = Promise.resolve()

// Throttle repeated ERROR lines so a failing provider (e.g. a 60s header
// timeout retried 3x per step) cannot flood the log file with identical
// entries. Same run + message within the window is collapsed to one line.
const ERROR_THROTTLE_MS = 60_000
const ERROR_THROTTLE_MAX_KEYS = 200
const errorThrottle = new Map<string, { time: number }>()

function suppressedError(key: string): boolean {
  const now = Date.now()
  const hit = errorThrottle.get(key)
  if (hit && now - hit.time < ERROR_THROTTLE_MS) return true
  if (errorThrottle.size >= ERROR_THROTTLE_MAX_KEYS) errorThrottle.clear()
  errorThrottle.set(key, { time: now })
  return false
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

export function fileLogger(file = path.join(Global.Path.log, "gyccode.log"), id: string = runID) {
  const fmt = formatter(id)
  let lastCheck = 0
  return Logger.make((options) => {
    if (options.logLevel === "Error") {
      const key = `${id}:${String(options.message)}`
      if (suppressedError(key)) return
    }
    const line = fmt.log(options) + "\n"
    writeQueue = writeQueue.then(async () => {
      const now = Date.now()
      if (now - lastCheck > ROTATE_CHECK_INTERVAL_MS) {
        lastCheck = now
        try {
          const info = await stat(file)
          if (info.size > MAX_LOG_BYTES) {
            await rename(file, `${file}.1`).catch(() => {})
          }
        } catch {
          // File may not exist yet; nothing to rotate.
        }
      }
      await appendFile(file, line).catch(() => {
        // Never let a logging failure crash the session.
      })
    })
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
