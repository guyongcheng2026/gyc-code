// gyc-code P0 改进效果对照实测
// 布局A（改进前）：日期在 env 中段 + memories 随轮变化
// 布局B（改进后）：日期在系统提示尾部 + memories 固定
// 场景：同日 15 轮 -> 模拟跨天+记忆变化 -> 第 16 轮，对比命中率
// 用法：bun scripts/cache-compare.mjs
import { readFileSync } from "node:fs"
import { homedir } from "node:os"
import { join } from "node:path"

const BASE = "https://api.deepseek.com/v1"
const auth = JSON.parse(readFileSync(join(homedir(), ".local/share/gyccode/auth.json"), "utf8"))
const API_KEY = auth.deepseek?.key
if (!API_KEY) { console.error("未找到 deepseek API key"); process.exit(1) }

const MODEL = "deepseek-v4-flash"
const EFFORT = "high"
const NORMAL_ROUNDS = 15 // 同日正常轮数

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
  { type: "function", function: { name: "read", description: "Read a file", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } },
  { type: "function", function: { name: "grep", description: "Search files", parameters: { type: "object", properties: { pattern: { type: "string" } }, required: ["pattern"] } } },
  { type: "function", function: { name: "bash", description: "Run a command", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
]

function envBlock(day) {
  return [
    "<env>",
    "  Working directory: C:/workspace/gyc-cli",
    "  Workspace root folder: C:/workspace/gyc-cli",
    "  Is directory a git repo: yes",
    "  Platform: win32",
  ].join("\n")
}
const skillsBlock = [
  "Skills provide specialized instructions for specific tasks.",
  "<available_skills>",
  "  - code-review: review code changes",
  "  - debug: diagnose issues",
  "</available_skills>",
].join("\n")

// 布局A：日期在 env 中段，memories 每轮变化
function systemA(day, memory) {
  return [
    "You are a coding agent.",
    "Here is some useful information about the environment you are running in:",
    envBlock(day),
    "  Today's date: " + day,
    "</env>",
    skillsBlock,
    memory,
  ].join("\n")
}
// 布局B：日期在尾部，memories 固定
function systemB(day, memory) {
  return [
    "You are a coding agent.",
    "Here is some useful information about the environment you are running in:",
    envBlock(day),
    "</env>",
    skillsBlock,
    memory,
    "Today's date: " + day,
  ].join("\n")
}

function toolOutput(i) {
  const lines = []
  for (let k = 0; k < 30; k++) lines.push("src/core/module" + i + "_" + k + ".ts: export function handler" + i + "_" + k + "(x) { return process(x); } // L" + (k * 4 + 8))
  return lines.join("\n")
}

async function runLayout(name, systemFn, dayForRound) {
  const messages = []
  let totalHit = 0, totalMiss = 0
  const perRound = []
  for (let r = 0; r <= NORMAL_ROUNDS; r++) {
    // 跨天模拟：第 16 轮（r===15）日期 +1 天；改进前 memories 也变化
    const day = r === NORMAL_ROUNDS ? "Sat Aug 12 2026" : "Fri Aug 11 2026"
    const memory = systemFn === systemA
      ? "<memories>\n- relevant memory from session turn " + r + ": cache stability check at depth " + r + "\n</memories>"
      : "<memories>\n- relevant memory: cache stability check across turns\n</memories>"
    messages[0] = { role: "system", content: systemFn(day, memory) }
    if (r === 0) {
      messages.push({ role: "user", content: "Scan the codebase. Use the read tool." })
    } else {
      messages.push({ role: "assistant", content: "Continuing scan.", tool_calls: [{ id: "call_" + r, type: "function", function: { name: "read", arguments: JSON.stringify({ path: "src/core/module" + r + ".ts" }) } }] })
      messages.push({ role: "tool", tool_call_id: "call_" + r, content: toolOutput(r) })
      messages.push({ role: "user", content: "Continue examining area " + r + ". Reply briefly." })
    }
    const body = { model: MODEL, messages, tools: TOOLS, stream: false, max_tokens: 200 }
    if (EFFORT) body.reasoning_effort = EFFORT
    const data = await call(body)
    const u = data.usage || {}
    const hit = u.prompt_cache_hit_tokens || 0
    const miss = u.prompt_cache_miss_tokens || (u.prompt_tokens || 0)
    totalHit += hit; totalMiss += miss
    const rate = hit + miss > 0 ? (100 * hit / (hit + miss)).toFixed(1) : "?"
    perRound.push({ r: r + 1, hit, miss, rate, day: day === "Fri Aug 11 2026" ? "D1" : "D2" })
    const text = data.choices?.[0]?.message?.content || ""
    messages.push({ role: "assistant", content: text || "ok" })
  }
  console.log("\n===== 布局 " + name + " =====")
  for (const p of perRound) console.log("round " + String(p.r).padStart(2) + " [" + p.day + "] hit=" + String(p.hit).padStart(7) + " miss=" + String(p.miss).padStart(6) + " 本轮=" + p.rate + "%")
  const total = totalHit + totalMiss
  console.log("同日轮（1-" + NORMAL_ROUNDS + "）综合命中率: " + (100 * (totalHit - perRound[NORMAL_ROUNDS].hit) / (total - perRound[NORMAL_ROUNDS].hit - perRound[NORMAL_ROUNDS].miss)).toFixed(1) + "%")
  console.log("跨天轮（第 " + (NORMAL_ROUNDS + 1) + " 轮）命中率: " + perRound[NORMAL_ROUNDS].rate + "%")
  return perRound
}

const a = await runLayout("A（改进前：日期中段+记忆变化）", systemA)
const b = await runLayout("B（改进后：日期尾部+记忆固定）", systemB)
console.log("\n===== 效果对比（跨天轮命中率）=====")
console.log("改进前 A: " + a[NORMAL_ROUNDS].rate + "%")
console.log("改进后 B: " + b[NORMAL_ROUNDS].rate + "%")
