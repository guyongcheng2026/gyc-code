// TUI worker pool: worker lifecycle management (extracted from cli/cmd/tui.ts, 2026-08-31 P2-1).
// Responsibilities: spawn / crash auto-restart (exponential backoff + restart budget) /
// idle unload (extreme memory saving) / heap budget (resourceLimits fixes dual isolate FatalOOM) /
// graceful shutdown.
// RPC bridging (fetch/EventSource adapters) remains in cmd/tui.ts — they are transport layer concerns.
import { Worker } from "node:worker_threads"
import path from "node:path"
import os from "node:os"
import { appendFile, mkdir } from "node:fs/promises"
import { Global } from "@gyccode/core/global"
import { Rpc } from "@/util/rpc"
import { withTimeout } from "@/util/timeout"
import type { rpc } from "./worker"

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

// resourceLimits (fixes FatalOOM crashes): worker isolate inherits main process
// --max-old-space-size when unlimited; dual isolates can each grow to that value,
// plus OpenTUI native memory. On ~4GB machines V8 C++ layer (TurboFan compiler/
// address space allocation) exhausts memory before JS heap guard, triggering
// uncaught FatalOOM abort (crashes within minutes). With resourceLimits set,
// worker heap OOM throws catchable RangeError in worker, worker.ts detects and
// exits proactively, pool auto-restarts for self-healing.
export function workerHeapLimits(): { maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number } {
  const explicit = Number(process.env.GYC_WORKER_OLD_SPACE)
  if (Number.isFinite(explicit) && explicit > 0) {
    return { maxOldGenerationSizeMb: Math.round(explicit), maxYoungGenerationSizeMb: 64 }
  }
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
  // 2026-08-27 empirical fix: 4GB machine main process ~800MB resident + worker 1024MB budget,
  // combined with system exceeds physical memory -> Windows paging -> continuous disk I/O (heat/
  // noise primary cause). Worker lowered to 768MB: main+worker ~1.6GB, leaving
  // ~2.4GB headroom for system; OOM triggers existing exit(12) auto-restart self-heal.
  const oldMb = totalMb <= 4096 ? 768 : totalMb <= 8192 ? 1536 : 2048
  return { maxOldGenerationSizeMb: oldMb, maxYoungGenerationSizeMb: 64 }
}

export type WorkerPool = {
  /** Worker alive: return client directly; after idle unload (or crash restart window) recreate on demand. */
  ensure: () => RpcClient | undefined
  /** Notify pool of activity (reset idle timer). */
  touch: () => void
  /** Graceful shutdown: shutdown RPC (5s timeout) then terminate. */
  stop: () => Promise<void>
  /** Check if pool is in circuit-breaker open state (too many restarts). */
  isCircuitOpen: () => boolean
}

export function createWorkerPool(opts: { file: URL | string; external: boolean }): WorkerPool {
  let currentWorker: Worker | undefined
  let currentClient: RpcClient | undefined
  let restarts = 0
  let successfulRuns = 0
  const MAX_WORKER_RESTARTS = 3
  const RESTART_WINDOW_MS = 60_000 // reset restarts after 60s of success
  let circuitOpen = false
  let lastRestartAt = 0

  // Idle unload (saves memory): after no RPC activity for idleSec, terminate worker.
  // Typical resident 200-400MB (isolate overhead + effect/drizzle/ai-sdk modules + instance).
  // Next ensure() respawns (~2.6s cold start). MostMessage handled by worker via
  // node buffering when idle. External mode (--port) must disable this:
  // GYC_TUI_IDLE_UNLOAD_SEC tunes (0 = disable). Default 10 minutes.
  const IDLE_UNLOAD_SEC = Number(process.env.GYC_TUI_IDLE_UNLOAD_SEC ?? 600)
  let lastActiveAt = Date.now()
  let stopped = false

  const touchActive = () => {
    lastActiveAt = Date.now()
  }

  const tryResetRestartBudget = () => {
    const now = Date.now()
    if (now - lastRestartAt > RESTART_WINDOW_MS) {
      restarts = 0
      circuitOpen = false
    }
  }

  const spawnWorker = (): Worker => {
    tryResetRestartBudget()

    const worker = new Worker(opts.file, {
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      resourceLimits: workerHeapLimits(),
    })
    currentWorker = worker
    currentClient = Rpc.client<typeof rpc>(worker, { onActivity: touchActive })

    // Worker crash exit: log and auto-restart (with restart budget); TUI process survives,
    // session state restored from disk via InstanceStore.
    worker.on("exit", (code) => {
      if (code === 0 || stopped) return
      // Reject pending requests (promises in flight; dispose will fail them)
      currentClient?.dispose(new Error(`Worker process exited, code ${code}`))
      currentWorker = undefined
      currentClient = undefined

      lastRestartAt = Date.now()
      const delayMs = Math.min(2000 * 2 ** restarts, 8000)
      restarts += 1

      void mkdir(Global.Path.log, { recursive: true })
        .then(() =>
          appendFile(
            path.join(Global.Path.log, "gyccode.log"),
            `timestamp=${new Date().toISOString()} level=Error run=main worker-exit code=${code} restart=${restarts}/${MAX_WORKER_RESTARTS} delay=${delayMs}ms\n`,
          ),
        )
        .catch(() => {})

      if (restarts > MAX_WORKER_RESTARTS) {
        circuitOpen = true
        return
      }

      setTimeout(() => {
        if (stopped) return
        // ensure may have already respawned (new request arrived during restart window),
        // in which case currentWorker is already set; skip duplicate spawn.
        if (currentWorker) return
        try {
          spawnWorker()
        } catch (e) {
          // Worker restart failure must be silent; otherwise TUI main thread crashes.
          console.error(`[tui] worker restart failed: ${String(e)}`)
        }
      }, delayMs).unref?.()
    })

    return worker
  }

  const ensure = (): RpcClient | undefined => {
    if (currentWorker && currentClient) {
      successfulRuns++
      if (successfulRuns > 10 && !circuitOpen) {
        // After sustained success, gradually reset restart budget
        tryResetRestartBudget()
      }
      return currentClient
    }
    if (circuitOpen) {
      return undefined // Caller must handle this (show error to user)
    }
    spawnWorker()
    return currentClient
  }

  // Idle unload timer (runs every minute): pending=0 && idle timeout && not external -> terminate.
  // external (--port/--hostname/--mdns service) workers host HTTP server, unload would kill service.
  const idleTimer = IDLE_UNLOAD_SEC > 0
    ? setInterval(() => {
        if (stopped || !currentWorker || !currentClient) return
        if (opts.external) return
        if (currentClient.pendingCount() > 0) return
        if (Date.now() - lastActiveAt < IDLE_UNLOAD_SEC * 1000) return
        const worker = currentWorker
        currentWorker = undefined
        currentClient.dispose(new Error("worker idle unloaded"))
        currentClient = undefined
        worker.removeAllListeners("exit")
        worker.terminate()
        void appendFile(
          path.join(Global.Path.log, "gyccode.log"),
          `timestamp=${new Date().toISOString()} level=Info run=main worker-idle-unloaded\n`,
        ).catch(() => {})
      }, 60_000)
    : undefined
  idleTimer?.unref?.()

  const stop = async () => {
    if (stopped) return
    stopped = true
    if (idleTimer) clearInterval(idleTimer)
    if (currentWorker && currentClient) {
      // Graceful shutdown with timeout/fallback (process will exit anyway).
      await withTimeout(currentClient.call("shutdown", undefined), 5000).catch(() => {})
    }
    currentWorker?.terminate()
    currentWorker = undefined
    currentClient = undefined
  }

  const isCircuitOpen = (): boolean => circuitOpen

  return { ensure, touch: touchActive, stop, isCircuitOpen }
}