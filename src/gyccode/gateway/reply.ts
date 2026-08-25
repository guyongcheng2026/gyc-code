// gyc 消息网关：应答路由器
// 两条链路：
// 1) 对话——LLM 模型与 gyc tui 同源：读 TUI 偏好文件 model.json 的 recent[0]，
//    经 OpenAI 兼容端点调用（openrouter/deepseek/nvidia 已映射），未识别回落 DeepSeek。
// 2) 任务——`/run <任务>` 或「任务：」前缀：spawn gyc run 非交互子进程真实执行，
//    完成后把输出截断回传微信；互斥锁防并发；/status 报告网关状态。
import { generateText } from "ai"
import { createOpenAICompatible } from "@ai-sdk/openai-compatible"
import { spawn } from "node:child_process"
import { readFileSync, existsSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"
import process from "node:process"

const MAX_HISTORY_TURNS = 20
const TASK_TIMEOUT_MS = 10 * 60_000
const REPLY_MAX_CHARS = 1800

interface ProviderEndpoint {
  baseURL: string
  apiKeyEnv: string
}

/** OpenAI 兼容端点映射表：与 gyc llm 层 providers 目录的端点保持一致。 */
const PROVIDER_ENDPOINTS: Record<string, ProviderEndpoint> = {
  openrouter: { baseURL: "https://openrouter.ai/api/v1", apiKeyEnv: "OPENROUTER_API_KEY" },
  deepseek: { baseURL: "https://api.deepseek.com/v1", apiKeyEnv: "DEEPSEEK_API_KEY" },
  nvidia: { baseURL: "https://integrate.api.nvidia.com/v1", apiKeyEnv: "NVIDIA_API_KEY" },
  opencode: { baseURL: "https://opencode.ai/zen/v1", apiKeyEnv: "OPENCODE_API_KEY" },
}

interface ModelChoice {
  providerID: string
  modelID: string
  baseURL: string
  apiKey: string
}

function loadDotEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  try {
    for (const line of readFileSync(join(homedir(), ".gyc", ".env"), "utf-8").split(/\r?\n/)) {
      const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
      if (match) env[match[1]] = match[2].trim()
    }
  } catch {
    // 文件缺失时仅依赖 process.env
  }
  return env
}

const DOT_ENV = loadDotEnv()
const pickKey = (key: string) => DOT_ENV[key] ?? process.env[key] ?? ""

/** 与 gyc tui 同源取模：TUI 偏好文件 recent[0] 即当前会话模型。 */
export function resolveTuiModel(): ModelChoice | undefined {
  try {
    const stateDir = join(process.env.XDG_STATE_HOME || join(homedir(), ".local", "state"), "gyccode")
    const prefFile = join(stateDir, "model.json")
    if (!existsSync(prefFile)) return undefined
    const pref = JSON.parse(readFileSync(prefFile, "utf-8")) as {
      recent?: Array<{ providerID?: string; modelID?: string }>
    }
    const first = pref.recent?.[0]
    if (!first?.providerID || !first?.modelID) return undefined
    const endpoint = PROVIDER_ENDPOINTS[first.providerID]
    if (!endpoint) return undefined
    const apiKey = pickKey(endpoint.apiKeyEnv)
    if (!apiKey) return undefined
    return { providerID: first.providerID, modelID: first.modelID, baseURL: endpoint.baseURL, apiKey }
  } catch {
    return undefined
  }
}

function fallbackModel(): ModelChoice {
  return {
    providerID: "deepseek",
    modelID: "deepseek-chat",
    baseURL: PROVIDER_ENDPOINTS.deepseek.baseURL,
    apiKey: pickKey("DEEPSEEK_API_KEY"),
  }
}

const SYSTEM_PROMPT =
  "你是谷总的微信助手，通过微信机器人与谷总对话。用简体中文回复，措辞规范简洁、专业严谨。" +
  "回复务必短小精悍：日常问题两三句话即可；除非对方明确要求，不要罗列长清单或展开长篇论述。" +
  "如需执行真实编码任务，提示对方发送「/run 任务描述」。"

interface Turn {
  role: "user" | "assistant"
  content: string
}

function truncate(text: string, limit = REPLY_MAX_CHARS): string {
  if (text.length <= limit) return text
  return text.slice(0, limit) + `\n…（内容过长已截断，共 ${text.length} 字符）`
}

/** 互斥任务执行：同一时刻仅允许一个 gyc run 子进程。 */
let taskRunning = false

async function runTask(description: string): Promise<string> {
  if (taskRunning) return "当前已有任务在执行中，请稍后再试。完成后将自动回报结果。"
  taskRunning = true
  const started = Date.now()
  try {
    const output = await new Promise<string>((resolve, reject) => {
      // stdin 必须置为 ignore：gyc run 会读 stdin，默认 pipe 永不闭合将致其永久阻塞
      const child = spawn(
        process.execPath,
        [
          "--preload",
          "./scripts/bun-solid-preload.ts",
          "--conditions=browser",
          "./src/gyccode/index.ts",
          "run",
          description,
          "--yolo",
        ],
        {
          cwd: process.cwd() || "C:\\gyc-code",
          windowsHide: true,
          timeout: TASK_TIMEOUT_MS,
          stdio: ["ignore", "pipe", "pipe"],
        },
      )
      let stdout = ""
      let stderr = ""
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf-8")))
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf-8")))
      child.on("error", reject)
      child.on("close", (code) => {
        const tail = stdout.trim() || stderr.trim() || "(无输出)"
        resolve(`任务退出码 ${code}，耗时 ${Math.round((Date.now() - started) / 1000)}s：\n${tail}`)
      })
    })
    return truncate(output)
  } finally {
    taskRunning = false
  }
}

function gatewayStatus(model: ModelChoice): string {
  const uptimeMin = Math.round(process.uptime() / 60)
  return [
    `网关状态：运行中（PID ${process.pid}，已运行 ${uptimeMin} 分钟）`,
    `对话模型：${model.providerID}/${model.modelID}（与 gyc tui 同源）`,
    `任务通道：/run <描述> 触发真实执行；当前${taskRunning ? "有任务执行中" : "空闲"}`,
  ].join("\n")
}

export class Replier {
  private readonly history = new Map<string, Turn[]>()

  private async chat(model: ModelChoice, turns: Turn[]): Promise<string> {
    const provider = createOpenAICompatible({ name: `gyc-gateway-${model.providerID}`, baseURL: model.baseURL, apiKey: model.apiKey })
    const completion = await generateText({
      model: provider.chatModel(model.modelID),
      system: SYSTEM_PROMPT,
      messages: turns.map((turn) => ({ role: turn.role, content: turn.content })),
    })
    const text = completion.text.trim()
    if (!text) throw new Error("应答模型返回空文本")
    return text
  }

  private remember(chatId: string, turns: Turn[]): void {
    while (turns.length > MAX_HISTORY_TURNS) turns.shift()
    this.history.set(chatId, turns)
  }

  async reply(chatId: string, incoming: string): Promise<string> {
    const text = incoming.trim()

    // 指令路由：任务执行 / 状态查询
    const runMatch = /^\/run\s+([\s\S]+)$/i.exec(text) ?? /^任务[:：]\s*([\s\S]+)$/.exec(text)
    if (runMatch) return runTask(runMatch[1].trim())

    let model = resolveTuiModel() ?? fallbackModel()
    if (!model.apiKey) model = fallbackModel()

    if (/^\/status$/i.test(text)) return gatewayStatus(model)

    // 对话链路：保留每会话最近若干轮上下文
    const turns = this.history.get(chatId) ?? []
    turns.push({ role: "user", content: text })
    this.remember(chatId, turns)

    const answer = await this.chat(model, turns.slice())
    turns.push({ role: "assistant", content: answer })
    this.remember(chatId, turns)
    return truncate(answer)
  }
}
