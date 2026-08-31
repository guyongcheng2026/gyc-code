// TUI worker 池：worker 生命周期管理（自 cli/cmd/tui.ts 抽出，2026-08-31 P2-1）。
// 职责：spawn / 崩溃自动重启（指数退避 + 重启预算）/ 空闲卸载（极致省内存）/
// 堆预算（resourceLimits 根治双 isolate FatalOOM）/ 优雅关闭。
// RPC 桥接（fetch/EventSource 适配）仍在 cmd/tui.ts——它们是传输层职责。
import { Worker } from "node:worker_threads"
import path from "node:path"
import os from "node:os"
import { appendFile, mkdir } from "node:fs/promises"
import { Global } from "@gyccode/core/global"
import { Rpc } from "@/util/rpc"
import { withTimeout } from "@/util/timeout"
import type { rpc } from "./worker"

type RpcClient = ReturnType<typeof Rpc.client<typeof rpc>>

// resourceLimits（根治 FatalOOM 崩溃）：worker isolate 无限制时继承主进程
// --max-old-space-size，双 isolate 各自可涨到该值，加上 OpenTUI 原生内存，
// 在 ~4GB 机器上 V8 C++ 层（TurboFan 编译器/地址空间分配）先于 JS 堆守
// 护耗尽内存，触发不可捕获的 FatalOOM abort（运行几分钟即崩）。设置
// resourceLimits 后 worker 堆超限在 worker 内抛可捕获的 RangeError，
// worker.ts 检测后主动退出，池自动重启自愈。
export function workerHeapLimits(): { maxOldGenerationSizeMb: number; maxYoungGenerationSizeMb: number } {
  const explicit = Number(process.env.GYC_WORKER_OLD_SPACE)
  if (Number.isFinite(explicit) && explicit > 0) {
    return { maxOldGenerationSizeMb: Math.round(explicit), maxYoungGenerationSizeMb: 64 }
  }
  const totalMb = Math.floor(os.totalmem() / 1024 / 1024)
  // 2026-08-27 实测修正：4GB 机主进程常驻 ~800MB + worker 1024MB 预算，
  // 与系统合计超订物理内存 → Windows 页面交换 → 磁盘持续读写（发热/
  // 噪音主因）。worker 下调到 768MB：主+worker ≈1.6GB，为系统留出
  // ~2.4GB 余量；超限时走既有的 OOM exit(12) 自动重启链路自愈。
  const oldMb = totalMb <= 4096 ? 768 : totalMb <= 8192 ? 1536 : 2048
  return { maxOldGenerationSizeMb: oldMb, maxYoungGenerationSizeMb: 64 }
}

export type WorkerPool = {
  /** worker 存活时直接返回 client；空闲卸载后（或崩溃重启窗口）按需重生。 */
  ensure: () => RpcClient
  /** 通知池有活动（重置空闲计时）。 */
  touch: () => void
  /** 优雅关闭：shutdown RPC（5s 超时兜底）后 terminate。 */
  stop: () => Promise<void>
}

export function createWorkerPool(opts: { file: URL | string; external: boolean }): WorkerPool {
  let currentWorker: Worker | undefined
  let currentClient: RpcClient | undefined
  let restarts = 0
  const MAX_WORKER_RESTARTS = 3
  // 空闲卸载（极致省内存）：无 RPC 活动持续 idleSec 后 terminate worker，
  // 常驻省 200-400MB（isolate 底噪 + effect/drizzle/ai-sdk 模块图 + instance
  // 状态）。下次请求经 ensure 冷启（模块求值 ~2.6s，postMessage 在
  // worker 未就绪时由 node 缓冲，请求不丢失）。会话进行中流式 RPC 频繁，
  // 不会误卸。external 模式（--port 对外服务）禁用。
  // GYC_TUI_IDLE_UNLOAD_SEC 可调，0 = 禁用。默认 10 分钟。
  const IDLE_UNLOAD_SEC = Number(process.env.GYC_TUI_IDLE_UNLOAD_SEC ?? 600)
  let lastActiveAt = Date.now()
  let stopped = false

  const touchActive = () => {
    lastActiveAt = Date.now()
  }

  const spawnWorker = () => {
    const worker = new Worker(opts.file, {
      env: Object.fromEntries(
        Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
      ),
      resourceLimits: workerHeapLimits(),
    })
    currentWorker = worker
    currentClient = Rpc.client<typeof rpc>(worker, { onActivity: touchActive })
    // worker 异常退出：记录日志并自动重启（指数退避），TUI 主进程保持存活。
    // 此前仅记录不重启，worker 阵亡后所有 RPC 永久失败，TUI 功能瘫痪。
    worker.on("exit", (code) => {
      if (code === 0 || stopped) return
      // 先 reject 挂起请求（Promise 挂在主进程，不 dispose 会永久悬挂），
      // 再置空引用：确保 ensure 在重启延迟窗口内被调用时立即重生
      // worker（而非返回已死 client 的 postMessage 抛错）
      currentClient?.dispose(new Error(`worker exited with code ${code}`))
      currentWorker = undefined
      currentClient = undefined
      const delayMs = Math.min(2000 * 2 ** restarts, 8000)
      restarts += 1
      void mkdir(Global.Path.log, { recursive: true })
        .then(() =>
          appendFile(
            path.join(Global.Path.log, "gyccode.log"),
            `timestamp=${new Date().toISOString()} level=Error run=main worker-exit code=${code} restart=${restarts}/${MAX_WORKER_RESTARTS} delay=${delayMs}ms\n`,
          ),
        )
        // 写日志本身失败不能再抛，否则会掩盖 worker 退出原因
        .catch(() => {})
      if (restarts > MAX_WORKER_RESTARTS) return
      setTimeout(() => {
        if (stopped) return
        // ensure 可能在延迟窗口内已抢先重生（有请求到达时立即重启
        // 优于定时重启），此时跳过，避免双 worker
        if (currentWorker) return
        try {
          spawnWorker()
        } catch (e) {
          // worker 重启失败必须留痕，否则 TUI 静默无响应且无任何线索
          console.error(`[tui] worker 重启失败：${String(e)}`)
        }
      }, delayMs).unref?.()
    })
    return worker
  }

  const ensure = (): RpcClient => {
    if (currentWorker && currentClient) return currentClient
    spawnWorker()
    return currentClient!
  }

  // 空闲卸载巡检（每分钟）：pending 归零且超时才卸。摘除 exit 监听后
  // terminate——exit 走"正常退出"路径（code!==0 但无监听），不触发重启链。
  // external（--port/--hostname/--mdns 对外服务）模式下 worker 承载真实
  // HTTP server，卸载即断服，禁用。
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
        )
          // 写日志本身失败不能再抛，忽略
          .catch(() => {})
      }, 60_000)
    : undefined
  idleTimer?.unref?.()

  const stop = async () => {
    if (stopped) return
    stopped = true
    if (idleTimer) clearInterval(idleTimer)
    if (currentWorker && currentClient) {
      // 优雅关闭超时/失败属预期（进程即将退出），忽略
      await withTimeout(currentClient.call("shutdown", undefined), 5000).catch(() => {})
    }
    currentWorker?.terminate()
  }

  return { ensure, touch: touchActive, stop }
}