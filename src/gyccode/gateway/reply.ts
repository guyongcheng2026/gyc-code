// gyc 消息网关：微信收信的 LLM 应答器（B 案独占连接时的回复链路）
// 设计取舍：不拉起整套 agent/session 体系，直接经 AI SDK 的 OpenAI 兼容端点生成回复，
// 按会话保留最近若干轮上下文；模型与凭据全部可由环境变量覆盖。
import { generateText } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import process from "node:process"

const DEFAULT_BASE_URL = "https://api.deepseek.com/v1"
const DEFAULT_MODEL = "deepseek-chat"
const MAX_HISTORY_TURNS = 20

interface ReplyConfig {
  baseUrl: string
  model: string
  apiKey: string
}

function resolveReplyConfig(): ReplyConfig {
  const apiKey = process.env.GYC_WEIXIN_REPLY_API_KEY ?? process.env.DEEPSEEK_API_KEY ?? ""
  if (!apiKey) throw new Error("缺少应答模型凭据：请在 ~/.gyc/.env 配置 GYC_WEIXIN_REPLY_API_KEY 或 DEEPSEEK_API_KEY")
  return {
    apiKey,
    baseUrl: (process.env.GYC_WEIXIN_REPLY_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, ""),
    model: process.env.GYC_WEIXIN_REPLY_MODEL || DEFAULT_MODEL,
  }
}

const SYSTEM_PROMPT =
  "你是谷总的微信助手，通过微信机器人与谷总对话。用简体中文回复，措辞规范简洁、专业严谨。" +
  "回复务必短小精悍：日常问题两三句话即可；除非对方明确要求，不要罗列长清单或展开长篇论述。"

interface Turn {
  role: "user" | "assistant"
  content: string
}

/** 每个发送者一份内存会话历史；进程重启即清空（极简取舍，持久化留待后续）。 */
export class Replier {
  private readonly history = new Map<string, Turn[]>()

  async reply(chatId: string, incoming: string): Promise<string> {
    const config = resolveReplyConfig()
    const turns = this.history.get(chatId) ?? []
    turns.push({ role: "user", content: incoming })
    while (turns.length > MAX_HISTORY_TURNS) turns.shift()

    const provider = createOpenAICompatible({ name: "gyc-gateway", baseURL: config.baseUrl, apiKey: config.apiKey })
    const completion = await generateText({
      model: provider.chatModel(config.model),
      system: SYSTEM_PROMPT,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
    })
    const text = completion.text.trim()
    if (!text) throw new Error("应答模型返回空文本")
    turns.push({ role: "assistant", content: text })
    while (turns.length > MAX_HISTORY_TURNS) turns.shift()
    this.history.set(chatId, turns)
    return text
  }
}
