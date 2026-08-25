// 冒烟验证：B 案三要素——守卫检测、LLM 应答、配置解析（不启动 poll，不与 hermes 抢消息）
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import { detectGycHeartbeat, detectHermesGateway } from "../src/gyccode/cli/cmd/gateway"
import { resolveWeixinConfig } from "../src/gyccode/gateway/weixin"
import { Replier } from "../src/gyccode/gateway/reply"

// 与 src/gyccode/index.ts 同款 .env 预加载（脱离 CLI 入口运行时需手动注入）
for (const line of readFileSync(join(homedir(), ".gyc", ".env"), "utf-8").split(/\r?\n/)) {
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
  if (match && process.env[match[1]] === undefined) process.env[match[1]] = match[2].trim()
}

async function main() {
  // 1. 配置解析
  const config = resolveWeixinConfig()
  console.log("[smoke] weixin config: OK, account =", config.accountId.slice(0, 8) + "…")

  // 2. hermes 冲突检测（当前 hermes 在跑，应报冲突）
  const hermes = detectHermesGateway()
  console.log("[smoke] hermes guard:", hermes ?? "(未检出)")

  // 3. gyc 心跳检测
  const heartbeat = await detectGycHeartbeat()
  console.log("[smoke] gyc heartbeat guard:", heartbeat ?? "(无残留)")

  // 4. LLM 应答链路冒烟
  const replier = new Replier()
  const answer = await replier.reply("smoke-chat", "请只回复两个字：正常")
  console.log("[smoke] LLM reply:", JSON.stringify(answer))
}

await main()
