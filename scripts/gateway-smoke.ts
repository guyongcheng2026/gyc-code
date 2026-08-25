// 冒烟验证：TUI 同源模型 + 对话链路 + 指令路由（不启动 poll，不与守护抢消息）
import { resolveTuiModel, Replier } from "../src/gyccode/gateway/reply"

async function main() {
  const model = resolveTuiModel()
  console.log("[smoke] tui model:", model ? `${model.providerID}/${model.modelID}` : "(回落 deepseek)")

  const replier = new Replier()
  if (model) {
    const answer = await replier.reply("smoke-chat", "请只回复两个字：正常")
    console.log("[smoke] chat via tui model:", JSON.stringify(answer.slice(0, 30)))
  }

  // /status 不走 LLM，直接验证路由
  const status = await replier.reply("smoke-chat", "/status")
  console.log("[smoke] status:", status.split("\n")[0])
}

await main()
