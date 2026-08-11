// gyc-code 缓存命中率实测脚本（DeepSeek 官方 API，OpenAI 兼容端点）
//
// 用途：验证「单模型长会话」下 DeepSeek 官方 API 的 prompt-cache 命中率。
// 结论参考：综合命中率 ≈ 1 - 2/N（N 为请求轮数），达到 98.2% 需 N ≥ ~110 轮。
//
// 用法：
//   bun scripts/cache-probe.mjs                 # 默认 40 轮 deepseek-v4-flash high
//   bun scripts/cache-probe.mjs 100             # 100 轮
//   bun scripts/cache-probe.mjs 100 deepseek-v4-flash high
//
// 说明：
//   - API key 从 ~/.local/share/gyccode/auth.json 读取，不落盘、不输出。
//   - 请求结构模拟 gyc-cli：固定系统提示（日期在尾部）+ 工具定义 +
//     每轮 assistant(tool_calls) + tool(大结果) + user 追问，前缀稳定追加。
//   - usage 使用官方 prompt_cache_hit_tokens / prompt_cache_miss_tokens 口径。
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const BASE = "https://api.deepseek.com/v1"
const auth = JSON.parse(readFileSync(join(homedir(), ".local/share/gyccode/auth.json"), "utf8"))
const API_KEY = auth.deepseek?.key
if (!API_KEY) {
  console.error("未找到 deepseek API key（auth.json 的 deepseek.key）")
  process.exit(1)
}

const rounds = Number(process.argv[2] || 40)
const model = process.argv[3] || "deepseek-v4-flash"
const effort = process.argv[4] || "high"
// 每轮工具输出行数（默认 40 行 ≈ 1.5K token；小增量场景可用 15 行 ≈ 0.6K token）
const toolRows = Number(process.argv[5] || 40)

async function call(body) {
  const res = await fetch(BASE + "/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: "Bearer " + API_KEY },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error("API " + res.status + " " + (await res.text()).slice(0, 300))
  return res.json()
}

const TOOLS = [
  { type: "function", function: { name: "read", description: "Read a file from the filesystem", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "grep", description: "Search for a pattern in files", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "glob", description: "List files matching a glob pattern", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "bash", description: "Run a shell command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
  { type: "function", function: { name: "task", description: "Dispatch a task to a subagent", parameters: { type: "object", properties: { description: { type: "string" } }, required: ["description"] } } },
  { type: "function", function: { name: "edit", description: "Edit a file", parameters: { type: "object", properties: { path: { type: "string" }, content: { type: "string" } }, required: ["path", "content"] } } },
]

const SYSTEM = [
  "You are a coding agent. You help with software engineering tasks.",
  "Here is some useful information about the environment you are running in:",
  "<env>",
  "  Working directory: C:/workspace/gyc-cli",
  "  Workspace root folder: C:/workspace/gyc-cli",
  "  Is directory a git repo: yes",
  "  Platform: win32",
  "</env>",
  "Skills provide specialized instructions for specific tasks.",
  "<available_skills>",
  "  - code-review: review code changes",
  "  - debug: diagnose issues",
  "</available_skills>",
  "Today's date: " + new Date().toDateString(),
].join("\n")

// 每轮工具输出（模拟真实 read/glob 结果；行数决定增量大小）
function bigToolOutput(i, rows) {
  const lines = []
  for (let k = 0; k < rows; k++) {
    lines.push("src/core/module" + i + "_" + k + ".ts:  export function handler" + i + "_" + k + "(input: Input, ctx: Ctx) { return process(input, { mode: 'strict', depth: " + (i + k) + " }); } // L" + (k * 5 + 10) + " 校验通过")
  }
  return lines.join("\n")
}

const messages = [
  { role: "system", content: SYSTEM },
  { role: "user", content: "Scan the codebase and report structural findings. Use the read tool." },
]

let totalHit = 0
let totalMiss = 0
let firstMiss = 0
console.log("模型=" + model + " effort=" + effort + " 轮数=" + rounds + " 工具输出行数=" + toolRows + "（约 " + Math.round(toolRows * 38) + " token/轮）\n")

for (let r = 0; r < rounds; r++) {
  const body = { model, messages, tools: TOOLS, stream: false, max_tokens: 300 }
  if (effort) body.reasoning_effort = effort
  const data = await call(body)
  const u = data.usage || {}
  const hit = u.prompt_cache_hit_tokens || 0
  const miss = u.prompt_cache_miss_tokens || (u.prompt_tokens || 0)
  totalHit += hit
  totalMiss += miss
  if (r === 0) firstMiss = miss
  const rate = hit + miss > 0 ? (100 * hit / (hit + miss)).toFixed(2) : "?"
  console.log("round " + String(r + 1).padStart(2) + " prompt=" + String(u.prompt_tokens || 0).padStart(7) + " hit=" + String(hit).padStart(8) + " miss=" + String(miss).padStart(6) + " 本轮=" + rate + "%")

  if (r < rounds - 1) {
    const text = data.choices?.[0]?.message?.content || ""
    messages.push({ role: "assistant", content: text || "Checking next file.", tool_calls: [{ id: "call_" + r, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "src/core/module" + r + ".ts" }) } }] })
    messages.push({ role: "tool", tool_call_id: "call_" + r, content: bigToolOutput(r, toolRows) })
    messages.push({ role: "user", content: "Continue. Examine " + (r + 1) + " more area, then summarize progress in one short paragraph." })
  }
}

const total = totalHit + totalMiss
const overall = total > 0 ? (100 * totalHit / total).toFixed(2) : "?"
const noFirst = total - firstMiss > 0 ? (100 * totalHit / (total - firstMiss)).toFixed(2) : "?"
console.log("\n===== 汇总 =====")
console.log("累计命中=" + totalHit + " 累计未命中=" + totalMiss + " 总输入=" + total)
console.log("综合命中率=" + overall + "%")
console.log("剔除首轮后命中率=" + noFirst + "%")
console.log("理论参考：综合命中率≈1-2/N=" + (1 - 2 / rounds > 0 ? (100 * (1 - 2 / rounds)).toFixed(1) : "?") + "%（N=" + rounds + "）")
