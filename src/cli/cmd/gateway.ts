// gyc gateway: weixin gateway long-lived guard (B plan exclusive connection)
// Responsibility: long poll receive -> LLM reply -> reply back; pre-check hermes gateway and residual gyc guards
// Prevent dual consumer competition; Ctrl+C graceful exit. Switch guide see docs/compose/plans/2026-08-25-gateway-weixin.md
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, constants, statSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { EOL } from "node:os"
import process from "node:process"
import { Effect, Scope } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import { isPidAlive, recordHeartbeat, resolveWeixinConfig, WeixinAdapter } from "@/gateway/weixin"
import { Replier } from "@/gateway/reply"

interface GatewayArgs {
  force?: boolean
}

interface HermesGatewayState {
  pid?: number
  gateway_state?: string
}

/** Check if hermes gateway holds the same bot connection (read state file and probe) */
export function detectHermesGateway(): string | null {
  const stateFile = join(homedir(), "AppData", "Local", "hermes", "gateway_state.json")
  let raw: string
  try {
    raw = readFileSync(stateFile, "utf-8")
  } catch {
    return null
  }
  try {
    const state = JSON.parse(raw) as HermesGatewayState
    if (state.gateway_state === "running" && typeof state.pid === "number" && isPidAlive(state.pid)) {
      return `hermes gateway is running (PID ${state.pid})`
    }
  } catch {
    return null
  }
  return null
}

/** Atomically acquire exclusive lock file (O_EXCL), returns fd on success, null on failure */
export function tryAcquireLock(): number | null {
  const lockFile = join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
  try {
    // O_EXCL | O_CREAT | O_WRONLY: only create and open if file doesn't exist
    return openSync(lockFile, constants.O_EXCL | constants.O_CREAT | constants.O_WRONLY)
  } catch {
    return null
  }
}

/** Lock stale threshold: if lock file not updated for this long, consider holder crashed */
const LOCK_STALE_MS = 30_000

/** Release lock file: close fd and delete file, otherwise stale lock permanently blocks subsequent starts */
export function releaseLock(fd: number | null): void {
  const lockFile = join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
  if (fd !== null) {
    try {
      closeSync(fd)
    } catch {
      // fd may already be closed, ignore
    }
  }
  try {
    unlinkSync(lockFile)
  } catch {
    // lock file may already be deleted, ignore
  }
}

/**
 * Clean up stale lock: only delete if heartbeat indicates no living guard.
 * Returns whether cleaned up. Heartbeat is written by caller immediately after acquiring lock,
 * so "lock exists but no heartbeat" means previous run didn't release properly.
 */
export function recoverStaleLock(): boolean {
  const heartbeatFile = join(homedir(), ".gyc", "data", "weixin", "heartbeat.json")
  const lockFile = join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
  let alive = false
  try {
    const previous = JSON.parse(readFileSync(heartbeatFile, "utf-8")) as { pid?: number; ts?: number }
    // PID alive + another process: trust it regardless of heartbeat age — heartbeat
    // only refreshes on startup/send, so an idle guard's ts would falsely go stale
    // and let a second instance steal the lock (dual-consumer risk).
    // PID reuse after crash is covered by lock mtime staleness (isLockStaleByMtime).
    if (typeof previous.pid === "number" && previous.pid !== process.pid && isPidAlive(previous.pid)) {
      alive = true
    }
  } catch {
    // heartbeat missing or unreadable: treat as no living guard
  }
  if (alive) return false
  try {
    unlinkSync(lockFile)
  } catch {
    return false
  }
  return true
}

/**
 * Check if lock file is stale based on modification time (fallback when heartbeat missing).
 * Used as additional safety net.
 */
function isLockStaleByMtime(): boolean {
  const lockFile = join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
  try {
    const stat = statSync(lockFile)
    return Date.now() - stat.mtimeMs > LOCK_STALE_MS
  } catch {
    return false // file doesn't exist = not stale
  }
}

export function detectGycHeartbeat(): string | null {
  const heartbeatFile = join(homedir(), ".gyc", "data", "weixin", "heartbeat.json")
  try {
    const previous = JSON.parse(readFileSync(heartbeatFile, "utf-8")) as { pid?: number }
    if (typeof previous.pid === "number" && previous.pid !== process.pid && isPidAlive(previous.pid)) {
      return `gyc guard already running (PID ${previous.pid})`
    }
  } catch {
    return null
  }
  return null
}

/** Acquire lock with automatic release via Effect scope, including stale detection */
function acquireLockWithScope(): Effect.Effect<number, never, Scope.Scope> {
  return Effect.acquireRelease(
    Effect.sync(() => {
      // Try direct acquire first
      let fd = tryAcquireLock()
      if (fd !== null) return fd

      // Lock held: check if stale by heartbeat OR mtime
      const staleByHeartbeat = !detectGycHeartbeat()?.includes("running") // no living heartbeat
      const staleByMtime = isLockStaleByMtime()
      if (staleByHeartbeat || staleByMtime) {
        recoverStaleLock() // best effort
        fd = tryAcquireLock()
      }
      if (fd === null) {
        throw new Error("Another gyc gateway instance is starting or running, holding exclusive lock. Please retry or use --force")
      }
      return fd
    }),
    (fd) => Effect.sync(() => releaseLock(fd)),
  )
}

export const GatewayCommand = effectCmd({
  command: "gateway",
  describe: "Run gyc weixin gateway guard process (poll messages and auto-reply via LLM)",
  instance: false,
  builder: (yargs) =>
    yargs.option("force", {
      describe: "Start even if hermes gateway or other gyc guard detected (risk: messages split)",
      type: "boolean",
    }),
  handler: (args: GatewayArgs) => Effect.scoped(gatewayHandler(args)),
})

const gatewayHandler = Effect.fn("Cli.gateway")(function* (args: GatewayArgs) {
    resolveWeixinConfig()
    if (!args.force) {
      const conflict = detectHermesGateway() ?? (yield* Effect.sync(() => detectGycHeartbeat()))
      if (conflict) {
        return yield* fail(
          `${conflict} -- both polling simultaneously will split messages. Stop the other first (see plan doc), or use --force`,
        )
      }
    }

    // Acquire lock with automatic release on scope exit (normal or error)
    const lockFd = yield* acquireLockWithScope()

    // Record heartbeat immediately after acquiring lock (before connect):
    // - makes recoverStaleLock's "no living guard" determination hold ASAP
    // - subsequent instances' detectGycHeartbeat also relies on this to block multi-guard coexistence
    // - heartbeat/connect any throw (Effect.promise -> defect) skips normal release path,
    //   onError fallback releases lock, prevents "one failure = permanent lock"
    //   releaseLock swallows all exceptions internally, safe to re-enter
    yield* Effect.promise(() => recordHeartbeat())

    const adapter = new WeixinAdapter()
    yield* Effect.promise(() => adapter.connect())

    const replier = new Replier()
    const controller = new AbortController()
    const onSignal = () => {
      process.stdout.write(`${EOL}[gyc gateway] Received exit signal, disconnecting${EOL}`)
      controller.abort()
      void adapter.disconnect()
    }
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)

    process.stdout.write(`[gyc gateway] Started, long polling (PID ${process.pid}); Ctrl+C to exit${EOL}`)
    const outcome = yield* Effect.promise(() =>
      adapter
        .poll(async (message) => {
          process.stdout.write(`[gyc gateway] Received from ${message.from.slice(0, 12)}...: ${message.text.slice(0, 40)}${EOL}`)
          try {
            const answer = await replier.reply(message.from, message.text)
            await adapter.sendText(message.from, answer)
            process.stdout.write(`[gyc gateway] Replied: ${answer.slice(0, 40)}${EOL}`)
          } catch (cause) {
            // Any single message failure (LLM jitter, send error, task error) must not propagate up to kill guard
            process.stdout.write(`[gyc gateway] Message handling failed: ${String(cause).slice(0, 200)}${EOL}`)
            await adapter
              .sendText(message.from, `Error processing message, please retry. Cause: ${String(cause).slice(0, 120)}`)
              .catch(() => undefined)
          }
        }, controller.signal)
        .catch((cause: unknown) => ({ error: String(cause) })),
    )
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)

    // Lock automatically released via Scope exit (acquireRelease)
    const failure = (outcome as { error?: string }).error
    if (failure) {
      process.stdout.write(`[gyc gateway] Stopped: ${failure}${EOL}`)
    }
    return undefined
})