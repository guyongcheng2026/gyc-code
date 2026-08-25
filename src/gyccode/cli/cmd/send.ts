// gyc send：经消息网关向外部平台投递文本（脚本、Cron、TUI 共用的出口命令）
import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd, fail } from "../effect-cmd"
import type { GatewaySendResult } from "@/gateway/adapter"
import { GatewayError } from "@/gateway/errors"
import { resolveWeixinConfig, WeixinAdapter } from "@/gateway/weixin"

interface SendArgs {
  message?: string
  to?: string
  json?: boolean
}

/** 目标格式：`weixin`＝home 频道；`weixin:<chatId>`＝指定会话。 */
function parseTarget(raw: string | undefined): { platform: string; chatId?: string } {
  const value = raw?.trim() || "weixin"
  const separator = value.indexOf(":")
  if (separator < 0) return { platform: value }
  return { platform: value.slice(0, separator), chatId: value.slice(separator + 1) }
}

async function readStdin(): Promise<string> {
  const chunks: string[] = []
  for await (const chunk of process.stdin) chunks.push(String(chunk))
  return chunks.join("")
}

async function deliver(platform: string, chatId: string, text: string): Promise<GatewaySendResult> {
  if (platform !== "weixin") return { ok: false, error: `暂不支持平台 ${platform}（当前已实现 weixin）`, kind: "unknown" }
  try {
    const adapter = new WeixinAdapter()
    await adapter.connect()
    resolveWeixinConfig()
    return await adapter.sendText(chatId, text)
  } catch (cause) {
    if (cause instanceof GatewayError) return { ok: false, error: cause.message, kind: cause.kind }
    return { ok: false, error: String(cause), kind: "unknown" }
  }
}

export const SendCommand = effectCmd({
  command: "send [message]",
  describe: "send a text message via the gyc gateway (platforms: weixin)",
  instance: false,
  builder: (yargs) =>
    yargs
      .positional("message", {
        describe: "message text; omit to read from stdin",
        type: "string",
      })
      .option("to", {
        describe: 'delivery target: "weixin" (home channel) or "weixin:<chat_id>"',
        type: "string",
      })
      .option("json", {
        describe: "emit machine-readable JSON result",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.send")(function* (args: SendArgs) {
    const piped = yield* Effect.promise(() => readStdin())
    const text = args.message ?? piped
    if (!text.trim()) return yield* fail("消息内容为空：请传入文本或经 stdin 管道输入")

    const target = parseTarget(args.to)
    const config = resolveWeixinConfig()
    const chatId = target.chatId ?? config.homeChannel ?? ""
    if (!chatId) return yield* fail("未指定目标会话：请使用 --to weixin:<chat_id> 或配置 GYC_WEIXIN_HOME_CHANNEL")

    const result = yield* Effect.promise(() => deliver(target.platform, chatId, text))
    if (args.json) {
      process.stdout.write(JSON.stringify({ success: result.ok, ...result }, null, 2) + EOL)
    }
    if (!result.ok) return yield* fail(result.error ?? "发送失败")
    if (!args.json) {
      process.stdout.write(`已送达 ${target.platform}:${chatId}` + EOL)
    }
    return undefined
  }),
})
