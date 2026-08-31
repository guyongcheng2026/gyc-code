// gyc gateway：微信网关常驻守护（B 案独占连接）
// 职责：长轮询收信 -> LLM 应答 -> 原路回复；启动前检查 hermes 网关与残留 gyc 守护
// 杜绝双消费竞争；Ctrl+C 优雅退出。切换手册见 docs/compose/plans/2026-08-25-gateway-weixin.md
import { readFileSync, writeFileSync, openSync, closeSync, unlinkSync, constants } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { EOL } from "node:os"
import process from "node:process"
import { Effect } from "effect"
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

/** 检查 hermes 网关是否正持有同一 bot 连接（读其状态文件并探活） */
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
      return `hermes 网关正在运行（PID ${state.pid}）`
    }
  } catch {
    return null
  }
  return null
}

/** 原子性获取独占锁文件（wx + O_EXCL），成功返回锁文件句柄，失败返回 null */
export function tryAcquireLock(): number | null {
  const lockFile = join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
  try {
    // O_EXCL | O_CREAT | O_WRONLY: 仅当文件不存在时原子创建并打开
    return openSync(lockFile, constants.O_EXCL | constants.O_CREAT | constants.O_WRONLY)
  } catch {
    return null
  }
}

/** 释放锁文件：关闭句柄并删除文件，否则残留锁将永久阻断后续启动 */
export function releaseLock(fd: number | null): void {
  const lockFile = join(homedir(), ".gyc", "data", "weixin", "gateway.lock")
  if (fd !== null) {
    try {
      closeSync(fd)
    } catch {
      // 句柄可能已关闭，失败无需处理
    }
  }
  try {
    unlinkSync(lockFile)
  } catch {
    // 锁文件可能已被删除，失败无需处理
  }
}

/**
 * 清理陈旧锁：仅当心跳表明没有存活的其他守护时才删锁。
 * 返回是否已清理。心跳由调用方在拿锁后立即写入，
 * 因此「锁存在但无心跳」即意味着上次运行未正常释放。
 */
export function recoverStaleLock(): boolean {
  const heartbeatFile = join(homedir(), ".gyc", "data", "weixin", "heartbeat.json")
  let alive = false
  try {
    const previous = JSON.parse(readFileSync(heartbeatFile, "utf-8")) as { pid?: number }
    if (typeof previous.pid === "number" && previous.pid !== process.pid && isPidAlive(previous.pid)) {
      alive = true
    }
  } catch {
    // 心跳缺失或不可读：视为无存活守护
  }
  if (alive) return false
  try {
    unlinkSync(join(homedir(), ".gyc", "data", "weixin", "gateway.lock"))
  } catch {
    return false
  }
  return true
}

export async function detectGycHeartbeat(): Promise<string | null> {
  const heartbeatFile = join(homedir(), ".gyc", "data", "weixin", "heartbeat.json")
  try {
    const previous = JSON.parse(readFileSync(heartbeatFile, "utf-8")) as { pid?: number }
    if (typeof previous.pid === "number" && previous.pid !== process.pid && isPidAlive(previous.pid)) {
      return `gyc 守护已在运行（PID ${previous.pid}）`
    }
  } catch {
    return null
  }
  return null
}

export const GatewayCommand = effectCmd({
  command: "gateway",
  describe: "run the gyc weixin gateway daemon (poll messages and auto-reply via LLM)",
  instance: false,
  builder: (yargs) =>
    yargs.option("force", {
      describe: "start even if hermes gateway or another gyc daemon is detected (risk: message splitting)",
      type: "boolean",
    }),
  handler: Effect.fn("Cli.gateway")(function* (args: GatewayArgs) {
    resolveWeixinConfig()
    if (!args.force) {
      const conflict = detectHermesGateway() ?? (yield* Effect.promise(() => detectGycHeartbeat()))
      if (conflict) {
        return yield* fail(
          `${conflict}——双方同时轮询将分流消息。请先停掉对方（切换步骤见计划文档），或加 --force 强行启动`,
        )
      }
    }

    // 原子获取独占锁：防止 check-then-act 窗口期的双实例并发。
    // 锁存在但心跳无存活守护时，视为上次异常退出残留，清理后重试一次。
    let lockFd = yield* Effect.sync(() => tryAcquireLock())
    if (lockFd === null) {
      const aliveDaemon = yield* Effect.promise(() => detectGycHeartbeat())
      const recovered = aliveDaemon ? false : yield* Effect.sync(() => recoverStaleLock())
      if (recovered) lockFd = yield* Effect.sync(() => tryAcquireLock())
    }
    if (lockFd === null) {
      return yield* fail("另一 gyc gateway 实例正在启动或运行中，已持有独占锁。请稍后重试或使用 --force")
    }

    // 拿锁后立即登记心跳（先于 connect）：让 recoverStaleLock 的「无存活守护」判定尽快成立，
    // 后续实例 detectGycHeartbeat 亦依此拦截，防多守护并存。
    // 心跳与 connect 任一抛错（Effect.promise 转 defect）都会跳过正常释放路径，
    // onError 兜底释放锁，防「一次失败永久锁死」。releaseLock 内部全吞异常，可安全重入。
    yield* Effect.promise(() => recordHeartbeat()).pipe(
      Effect.onError(() => Effect.sync(() => releaseLock(lockFd))),
    )

    const adapter = new WeixinAdapter()
    yield* Effect.promise(() => adapter.connect()).pipe(
      Effect.onError(() => Effect.sync(() => releaseLock(lockFd))),
    )
    const replier = new Replier()
    const controller = new AbortController()
    const onSignal = () => {
      process.stdout.write(`${EOL}[gyc gateway] 收到退出信号，正在断开连接${EOL}`)
      controller.abort()
      void adapter.disconnect()
    }
    process.once("SIGINT", onSignal)
    process.once("SIGTERM", onSignal)

    process.stdout.write(`[gyc gateway] 已启动，长轮询收信中（PID ${process.pid}）；Ctrl+C 退出${EOL}`)
    const outcome = yield* Effect.promise(() =>
      adapter
        .poll(async (message) => {
          process.stdout.write(`[gyc gateway] 收到来信 ${message.from.slice(0, 12)}…：${message.text.slice(0, 40)}${EOL}`)
          try {
            const answer = await replier.reply(message.from, message.text)
            await adapter.sendText(message.from, answer)
            process.stdout.write(`[gyc gateway] 已回复：${answer.slice(0, 40)}${EOL}`)
          } catch (cause) {
            // 单条消息的任何故障（LLM 抖动、发送失败、任务异常）绝不向上传播杀死守护
            process.stdout.write(`[gyc gateway] 消息处理失败：${String(cause).slice(0, 200)}${EOL}`)
            await adapter
              .sendText(message.from, `处理该消息时出错，请稍后重试。原因：${String(cause).slice(0, 120)}`)
              .catch(() => undefined)
          }
        }, controller.signal)
        .catch((cause: unknown) => ({ error: String(cause) })),
    )
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)

    // 退出前释放锁
    yield* Effect.sync(() => releaseLock(lockFd))

    const failure = (outcome as { error?: string }).error
    if (failure) {
      process.stdout.write(`[gyc gateway] 已停止：${failure}${EOL}`)
    }
    return undefined
  }),
})
