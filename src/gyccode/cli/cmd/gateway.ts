// gyc gateway：微信网关常驻守护（B 案独占连接）
// 职责：长轮询收信 → LLM 应答 → 原路回复；启动前检测 hermes 网关与残留 gyc 守护，
// 杜绝双消费竞争；Ctrl+C 优雅退出。切换手册见 docs/compose/plans/2026-08-25-gateway-weixin.md。
import { readFileSync } from "node:fs"
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

/** 检测 hermes 网关是否正持有同一 bot 连接（读其状态文件并探活）。 */
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

    const adapter = new WeixinAdapter()
    yield* Effect.promise(() => adapter.connect())
    // 启动即登记心跳：后续实例的 detectGycHeartbeat 依此拦截，防多守护并存
    yield* Effect.promise(() => recordHeartbeat())
    const replier = new Replier()
    const controller = new AbortController()
    const onSignal = () => {
      process.stdout.write(`${EOL}[gyc gateway] 收到退出信号，正在断开连接…${EOL}`)
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
          const answer = await replier.reply(message.from, message.text)
          await adapter.sendText(message.from, answer)
          process.stdout.write(`[gyc gateway] 已回复 ${answer.slice(0, 40)}${EOL}`)
        }, controller.signal)
        .catch((cause: unknown) => ({ error: String(cause) })),
    )
    process.removeListener("SIGINT", onSignal)
    process.removeListener("SIGTERM", onSignal)
    const failure = (outcome as { error?: string }).error
    if (failure) {
      process.stdout.write(`[gyc gateway] 已停止：${failure}${EOL}`)
    }
    return undefined
  }),
})
