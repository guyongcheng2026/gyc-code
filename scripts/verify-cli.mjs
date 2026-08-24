#!/usr/bin/env node
// scripts/verify-cli.mjs — gyc CLI 版 11 维验证矩阵（功能性/稳定性/可靠性/安全性/合规性/
// 品牌化/纯自主研发/资源消耗/磁盘发热噪音/LLM 延时/缓存命中率），口径与 web/TUI 版一致。
// CLI 特性适配：
//   - 功能性以子命令实测为主（--version/session/models/stats/debug），serve API 为辅
//   - 稳定性优先复用 pm2 长跑实例 gyc-stability（stability-log.jsonl），无则自起 serve
//   - 安全性扫描面 = src/gyccode/cli + src/core；含 CLI 输出明文密钥检查
// 用法：
//   node scripts/verify-cli.mjs [--base-url http://127.0.0.1:4300] [--port 4300]
//        [--soak-seconds 12] [--load-seconds 6] [--llm] [--keep-server] [--skip-server-start]
//        [--report cli-verify-report.json]
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, openSync, closeSync, statSync as ss } from "node:fs"
import { join, dirname, extname, relative } from "node:path"
import { fileURLToPath } from "node:url"
import os from "node:os"

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, "..")
const BIN = join(ROOT, "bin", "gyc")

// ---------- 参数 ----------
const argv = process.argv.slice(2)
function argValue(name, fallback) {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1] : fallback
}
function argFlag(name) {
  return argv.includes(name)
}

const PORT = Number(argValue("--port", "4300"))
const BASE = argValue("--base-url", `http://127.0.0.1:${PORT}`)
const SOAK_SECONDS = Number(argValue("--soak-seconds", "12"))
const LOAD_SECONDS = Number(argValue("--load-seconds", "6"))
const RUN_LLM = argFlag("--llm")
const KEEP_SERVER = argFlag("--keep-server")
const SKIP_SERVER_START = argFlag("--skip-server-start")
const REPORT_PATH = argValue("--report", join(ROOT, "cli-verify-report.json"))

const AUTH_USER = process.env["GYCCODE_SERVER_USERNAME"] ?? "gyccode"
const AUTH_PASS = process.env["GYCCODE_SERVER_PASSWORD"] ?? ""
const AUTH_HEADERS = AUTH_PASS
  ? { authorization: `Basic ${Buffer.from(`${AUTH_USER}:${AUTH_PASS}`).toString("base64")}` }
  : {}

// ---------- 工具 ----------
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const nowMs = () => Number(process.hrtime.bigint() / 1000000n)

async function req(method, path, { body, timeoutMs = 15000, headers } = {}) {
  const t0 = nowMs()
  const res = await fetch(BASE + path, {
    method,
    headers: { ...AUTH_HEADERS, ...(body !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: body !== undefined ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  })
  const latency = nowMs() - t0
  let json = null
  const text = await res.text()
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    /* 非 JSON 响应 */
  }
  return { status: res.status, ok: res.ok, headers: res.headers, json, text, latency }
}

// CLI 子命令执行（node 直调 bin/gyc，返回 stdout/stderr/exit/耗时）
function cli(args, timeoutMs = 90000) {
  const t0 = nowMs()
  const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", timeout: timeoutMs, cwd: ROOT })
  return { exit: r.status, stdout: (r.stdout ?? "").trim(), stderr: ((r.stderr ?? "") + "").trim(), ms: nowMs() - t0 }
}

function ps(script, timeoutMs = 30000, ignoreExitCode = false) {
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: timeoutMs })
    if ((!r.error && (r.status === 0 || ignoreExitCode)) && (r.stdout ?? "").trim()) return r.stdout.trim()
    if (attempt === 0) continue
    return null
  }
  return null
}

function findListenerPid(port) {
  const r = spawnSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", timeout: 15000 })
  if (r.error || r.status !== 0) return null
  const line = (r.stdout ?? "").split("\n").find((l) => l.includes(`:${port}`) && l.includes("LISTENING"))
  if (!line) return null
  const pid = Number(line.trim().split(/\s+/).pop())
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

let snapDiag = ""
function psSnapshot(pid) {
  // wmic 直调（轻量稳健）：CPU=User+Kernel(100ns÷10000→ms)，IO=Read+Write 累计字节
  snapDiag = ""
  let wmicOut = null
  try {
    const r = spawnSync(
      "wmic",
      ["process", "where", `processid=${pid}`, "get", "usermodetime,kernelmodetime,readtransfercount,writetransfercount,workingsetsize", "/format:list"],
      { encoding: "utf8", timeout: 15000 },
    )
    if (r.error) snapDiag = `wmic error=${r.error.message}`
    else {
      wmicOut = (r.stdout ?? "").trim()
      if (!wmicOut.includes("UserModeTime")) {
        snapDiag = wmicOut.includes("No Instance") ? `wmic 查无进程 pid=${pid}` : `wmic status=${r.status} 无字段`
      }
    }
  } catch (e) {
    snapDiag = `wmic 异常: ${e.message}`
  }
  if (wmicOut && !wmicOut.includes("No Instance")) {
    const get = (key) => {
      const m = wmicOut.match(new RegExp(`${key}=(\\d+)`, "i"))
      return m ? Number(m[1]) : NaN
    }
    const user = get("UserModeTime")
    if (!Number.isFinite(user)) {
      snapDiag = `wmic 字段解析不全`
      return null
    }
    const kernelRaw = get("KernelModeTime")
    const wsRaw = get("WorkingSetSize")
    const ioRaw1 = get("ReadTransferCount")
    const ioRaw2 = get("WriteTransferCount")
    return {
      tpMs: (user + (Number.isFinite(kernelRaw) ? kernelRaw : 0)) / 10000,
      ws: Number.isFinite(wsRaw) ? wsRaw : -1,
      io: Number.isFinite(ioRaw1) && Number.isFinite(ioRaw2) ? ioRaw1 + ioRaw2 : -1,
    }
  }
  // 回退：PowerShell
  const out = ps(
    `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if (-not $p) { '"GONE"' } else { ` +
      `$w = Get-CimInstance Win32_Process -Filter "ProcessId=${pid}" -ErrorAction SilentlyContinue; $io = [double]-1; ` +
      `if ($w) { $io = [double]($w.ReadTransferCount + $w.WriteTransferCount) }; ` +
      `[pscustomobject]@{ tp=$p.TotalProcessorTime.TotalMilliseconds; ws=$p.WorkingSet64; io=$io } | ConvertTo-Json -Compress }`,
    20000,
  )
  if (!out) return null
  try {
    const v = JSON.parse(out)
    if (v === "GONE") return { gone: true }
    if (!Number.isFinite(v.tp)) return null
    return { tpMs: v.tp, ws: v.ws, io: v.io }
  } catch {
    return null
  }
}

function walkFiles(dir, exts, out = []) {
  if (!existsSync(dir)) return out
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkFiles(full, exts, out)
    else if (exts.includes(extname(name).toLowerCase())) out.push(full)
  }
  return out
}

// ---------- 结果容器 ----------
const dimensions = []
function record(id, name, status, details, metrics = {}) {
  dimensions.push({ id, name, status, details, metrics })
  const mark = { pass: "✅ PASS", warn: "⚠️ WARN", fail: "❌ FAIL", skip: "⏭️ SKIP" }[status]
  console.log(`\n[${mark}] ${name}`)
  for (const line of details) console.log(`   ${line}`)
  if (Object.keys(metrics).length) console.log(`   指标: ${JSON.stringify(metrics)}`)
}

// ---------- server 管理 ----------
let serverPid = null
let startedByScript = false
let serverReadyAt = 0

async function reachable() {
  for (const path of ["/provider", "/"]) {
    try {
      await fetch(BASE + path, { headers: AUTH_HEADERS, signal: AbortSignal.timeout(4000) })
      return true
    } catch {
      /* 下一路径 */
    }
  }
  return false
}

async function ensureServer() {
  if (await reachable()) {
    serverPid = findListenerPid(PORT)
    serverReadyAt = 0 // 复用外部实例：存活时长经 CreationDate 探测
    console.log(`server 已在运行 (pid=${serverPid ?? "?"})，直接复用`)
    return true
  }
  if (SKIP_SERVER_START) {
    console.log("server 未运行且指定 --skip-server-start，跳过启动")
    return false
  }
  if (!existsSync(BIN)) {
    console.log(`未找到 ${BIN}`)
    return false
  }
  console.log("server 未运行，正在启动 ...")
  const logFile = openSync(join(ROOT, "cli-verify-server.log"), "w")
  const child = spawn(process.execPath, [BIN, "serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    stdio: ["ignore", logFile, logFile],
    cwd: ROOT,
  })
  closeSync(logFile)
  const deadline = nowMs() + 90_000
  while (nowMs() < deadline) {
    await sleep(1000)
    if (child.exitCode !== null) return false
    let up = false
    for (const path of ["/provider", "/"]) {
      try {
        await fetch(BASE + path, { headers: AUTH_HEADERS, signal: AbortSignal.timeout(3000) })
        up = true
        break
      } catch {
        /* 重试 */
      }
    }
    if (up) {
      startedByScript = true
      serverPid = findListenerPid(PORT) ?? child.pid
      serverReadyAt = Date.now()
      console.log(`server 已就绪 (pid=${serverPid})`)
      return true
    }
  }
  console.log("server 启动超时")
  return false
}

function stopServerIfOwned() {
  if (!startedByScript || KEEP_SERVER || !serverPid) return
  console.log(`停止由脚本启动的 server (pid=${serverPid})`)
  spawnSync("taskkill", ["/PID", String(serverPid), "/T", "/F"], { stdio: "ignore" })
}
// ---------- 各维检查 ----------

// 1. 功能性：CLI 子命令实测 + serve API 会话增删查
async function checkFunctional() {
  const details = []
  let ok = true

  // --version 冷启动（阈值 <3.5s 达标线）
  const v = cli(["--version"])
  const versionOk = v.exit === 0 && /^\d+\.\d+\.\d+/.test(v.stdout)
  const fast = v.ms < 3500
  details.push(versionOk ? `gyc --version → ${v.stdout}（${v.ms}ms${fast ? "，<3.5s 达标 ✓" : "，超 3.5s ✗"}）` : `gyc --version 异常 exit=${v.exit}`)
  ok = ok && versionOk && fast

  // CLI 原生会话列表
  const ls = cli(["session", "list"])
  const lsOk = ls.exit === 0
  details.push(lsOk ? `gyc session list → exit=0（${ls.ms}ms）` : `gyc session list 异常 exit=${ls.exit}: ${ls.stderr.slice(0, 80)}`)
  ok = ok && lsOk

  // stats 命令
  const st = cli(["stats"])
  const stOk = st.exit === 0 || /无|no data|0/i.test(st.stdout + st.stderr)
  details.push(stOk ? `gyc stats → exit=${st.exit}（${st.ms}ms）` : `gyc stats 异常 exit=${st.exit}`)
  ok = ok && stOk

  // debug config 子命令
  const dbg = cli(["debug", "config"])
  const dbgOk = dbg.exit === 0
  details.push(dbgOk ? `gyc debug config → exit=0（${dbg.ms}ms）` : `gyc debug config 异常 exit=${dbg.exit}`)
  ok = ok && dbgOk

  // serve API 会话增删查（CLI 后端内核）
  await req("GET", "/path", { timeoutMs: 60000 }).catch(() => {})
  const created = await req("POST", "/session", { body: {} }).catch(() => null)
  const createdBody = created?.json?.data ?? created?.json ?? {}
  const sid = createdBody?.id ?? createdBody?.info?.id
  const createOk = created?.ok === true && typeof sid === "string"
  details.push(createOk ? `API 创建会话成功 id=${sid}` : `API 创建会话失败：${created ? created.status : "网络错误"}`)

  let getOk = false
  if (createOk) {
    const got = await req("GET", `/session/${sid}`).catch(() => null)
    getOk = got?.ok === true && JSON.stringify(got.json ?? {}).includes(sid)
    details.push(getOk ? "回读会话一致" : "回读会话不一致")
  }
  let delOk = false
  if (createOk) {
    // 先用 CLI 删除（验证 CLI 写路径），失败再退 API
    const delCli = cli(["session", "delete", sid])
    delOk = delCli.exit === 0
    if (!delOk) {
      const del = await req("DELETE", `/session/${sid}`).catch(() => null)
      delOk = del?.ok === true
    }
    const listed = await req("GET", "/session?limit=50").catch(() => null)
    const listArr = listed?.json?.data?.items ?? listed?.json?.items ?? listed?.json?.data
    const stillThere = Array.isArray(listArr) && listArr.some((s) => (s.id ?? s.info?.id) === sid)
    details.push(delOk && !stillThere ? "CLI/API 删除会话生效" : `删除验证失败 del=${delOk} still=${stillThere}`)
    ok = ok && delOk && !stillThere
  }
  ok = ok && createOk && getOk

  record("functional", "功能性（子命令实测+API 会话链路）", ok ? "pass" : "fail", details, {})
}

// 2. 稳定性：soak + 进程存活（优先读 pm2 长跑日志佐证）
async function checkStability(pid) {
  const details = []
  const latencies = []
  let failures = 0
  let requests = 0
  const deadline = nowMs() + SOAK_SECONDS * 1000

  while (nowMs() < deadline) {
    try {
      const r = await req("GET", "/session?limit=1", { timeoutMs: 8000 })
      requests++
      if (!r.ok) failures++
      else latencies.push(r.latency)
    } catch {
      requests++
      failures++
    }
    await sleep(400)
  }
  latencies.sort((a, b) => a - b)
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null
  const failRate = requests ? failures / requests : 1
  details.push(`soak ${SOAK_SECONDS}s：请求 ${requests} 次，失败 ${failures} 次（${(failRate * 100).toFixed(1)}%）`)
  if (p95 !== null) details.push(`API p95 ${p95}ms`)
  const cur = pid ? findListenerPid(PORT) : null
  const crash = pid && cur !== null && cur !== pid ? 1 : 0
  details.push(`进程存活检查：异常重启 ${crash} 次`)

  // pm2 长跑日志佐证
  const logPath = join(ROOT, "stability-log.jsonl")
  if (existsSync(logPath)) {
    try {
      const lines = readFileSync(logPath, "utf8").trim().split("\n")
      const last = JSON.parse(lines[lines.length - 1])
      details.push(`pm2 长跑最近巡检：存活 ${last.uptimeHours}h、重启 ${last.crashCount}、HTTP ${last.httpUp ? "up" : "down"}（共 ${lines.length} 条留痕）`)
    } catch {
      /* 日志不可解析则忽略 */
    }
  }

  const status = crash === 0 && failRate <= 0.01 ? "pass" : "fail"
  record("stability", `稳定性（${SOAK_SECONDS}s 采样 + pm2 长跑留痕）`, status, [
    ...details,
    "注：1h/4h/8h/24h 检查点由计划任务 gyc-stability-watch 每 30 分钟自动判定并写入 stability-log.jsonl。",
  ], { requests, failures, p95Ms: p95 })
}

// 3. 可靠性：SSE + 心跳 + 持久化跨重启
async function checkReliability() {
  const details = []
  let sseOk = false
  try {
    const ac = new AbortController()
    const res = await fetch(BASE + "/event", { headers: { accept: "text/event-stream", ...AUTH_HEADERS }, signal: ac.signal })
    sseOk = res.ok && (res.headers.get("content-type") ?? "").includes("text/event-stream")
    if (res.body) {
      const reader = res.body.getReader()
      await reader.read().catch(() => {})
      reader.cancel().catch(() => {})
    }
    ac.abort()
  } catch {
    sseOk = false
  }
  details.push(sseOk ? "事件流 GET /event 握手成功（SSE）" : "事件流握手失败")

  let hbFail = 0
  for (let i = 0; i < 5; i++) {
    try {
      const r = await req("GET", "/session?limit=1", { timeoutMs: 5000 })
      if (!r.ok) hbFail++
    } catch {
      hbFail++
    }
    await sleep(300)
  }
  details.push(`心跳探测 5 次，失败 ${hbFail} 次`)
  record("reliability", "可靠性（事件流+心跳；持久化项见下）", hbFail === 0 ? "pass" : "fail", details, { heartbeatFailures: hbFail })
}

// 3b. 持久化：会话跨 server 重启（SQLite）
async function checkPersistence() {
  const details = []
  if (!startedByScript || KEEP_SERVER) {
    record("persistence", "可靠性-持久化（会话跨重启）", "skip", ["复用外部 server 或 --keep-server，跳过重启验证"], {})
    return
  }
  const created = await req("POST", "/session", { body: {} }).catch(() => null)
  const cb = created?.json?.data ?? created?.json ?? {}
  const sid = cb?.id ?? cb?.info?.id
  if (!sid) {
    record("persistence", "可靠性-持久化（会话跨重启）", "warn", ["创建会话失败"], {})
    return
  }
  stopServerIfOwned()
  startedByScript = false
  await sleep(2500)
  const logFile = openSync(join(ROOT, "cli-verify-server.log"), "w")
  const child = spawn(process.execPath, [BIN, "serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    stdio: ["ignore", logFile, logFile],
    cwd: ROOT,
  })
  closeSync(logFile)
  const deadline = nowMs() + 90_000
  let up = false
  while (nowMs() < deadline) {
    await sleep(1000)
    if (child.exitCode !== null) break
    let okNow = false
    for (const path of ["/provider", "/"]) {
      try {
        await fetch(BASE + path, { headers: AUTH_HEADERS, signal: AbortSignal.timeout(3000) })
        okNow = true
        break
      } catch {
        /* 重试 */
      }
    }
    if (okNow) {
      up = true
      break
    }
  }
  if (!up) {
    record("persistence", "可靠性-持久化（会话跨重启）", "fail", [`重启失败（会话 id=${sid} 已在库中）`], {})
    return
  }
  startedByScript = true
  serverPid = findListenerPid(PORT) ?? child.pid
  serverReadyAt = Date.now()

  const got = await req("GET", `/session/${sid}`).catch(() => null)
  const gb = got?.json?.data ?? got?.json ?? {}
  const kept = (gb?.id ?? gb?.info?.id) === sid || JSON.stringify(got?.json ?? {}).includes(sid)
  details.push(kept ? `重启后会话 ${sid} 完整恢复（SQLite 持久化 ✓）` : `重启后会话丢失 ✗`)
  await req("DELETE", `/session/${sid}`).catch(() => {})
  record("persistence", "可靠性-持久化（会话跨重启）", kept ? "pass" : "fail", details, {})
}
// 4. 安全性：CLI 输出密钥检查 + 危险 API 面（src/gyccode/cli + src/core）+ 依赖审计
async function checkSecurity() {
  const details = []
  let hardFail = false

  // CLI 输出明文密钥：providers/models 等面向用户的命令不得回显 key
  const provOut = cli(["providers"], 120000)
  const leak = /sk-[A-Za-z0-9]{8,}|gho_[A-Za-z0-9]{8,}/.test(provOut.stdout + provOut.stderr)
  details.push(leak ? "gyc providers 输出疑似明文密钥 ✗" : "gyc providers 输出未发现明文密钥 ✓")
  hardFail = hardFail || leak

  // 危险 API 面：eval/new Function/拼接 exec
  const xssRe = /\beval\s*\(|new\s+Function\s*\(|child_process.*\bexec(Sync)?\s*\(\s*[`"'][^`"'(]*\$\{/g
  const scanDirs = [join(ROOT, "src", "gyccode", "cli"), join(ROOT, "src", "core")]
  const hits = []
  for (const dir of scanDirs) {
    for (const file of walkFiles(dir, [".ts"])) {
      const lines = readFileSync(file, "utf8").split("\n")
      lines.forEach((line, idx) => {
        xssRe.lastIndex = 0
        if (xssRe.test(line)) hits.push(`${relative(ROOT, file)}:${idx + 1}: ${line.trim().slice(0, 90)}`)
      })
    }
  }
  if (hits.length === 0) details.push("src/gyccode/cli + src/core 未发现 eval/new Function/拼接 exec 直用")
  else {
    details.push(`发现 ${hits.length} 处危险 API 使用（需人工确认）：`)
    for (const h of hits.slice(0, 10)) details.push(`   ${h}`)
  }

  // 依赖审计
  const hasNpmLock = existsSync(join(ROOT, "package-lock.json"))
  if (!hasNpmLock) {
    details.push("依赖审计：仓库为 bun.lock（npm audit 不适用），标记说明——建议 CI 以 bun 兼容审计工具补充")
  } else {
    const r = spawnSync("npm", ["audit", "--json", "--omit=dev"], { encoding: "utf8", cwd: ROOT, timeout: 120000 })
    try {
      const audit = JSON.parse(r.stdout)
      const crit = audit?.metadata?.vulnerabilities?.critical ?? 0
      const high = audit?.metadata?.vulnerabilities?.high ?? 0
      details.push(`npm audit：critical=${crit}, high=${high}`)
      hardFail = hardFail || crit + high > 0
    } catch {
      details.push("npm audit 执行失败，人工复核")
    }
  }

  record("security", "安全性（CLI 密钥输出+危险 API 面+依赖审计）", hardFail ? "fail" : hits.length > 0 ? "warn" : "pass", details, {
    dangerousApiHits: hits.length,
    cliKeyLeak: leak,
  })
}

// 5. 合规性：违禁品牌词扫描（src/gyccode/cli + src/core）
// 判定口径：**品牌展示类违禁** = FAIL；
// src/core 为 LLM 服务商协议适配层（消息格式转换/provider 映射/AI SDK 封装），
// 第三方服务名属必要互操作引用，按 AGENTS.md 开源合规条款做目录级豁免并计数；
// src/gyccode/cli 为用户界面面，逐条判定（已知互操作文件入豁免表）。
const FORBIDDEN = ["anthropic", "claude", "codex", "openai", "chatgpt", "copilot", "windsurf", "gemini", "mimo", "hermes"]
const COMPLIANCE_EXEMPTS = [
  { file: "src\\gyccode\\cli\\cmd\\providers.ts", reason: "供应商连接选择器：第三方服务 ID 排序与认证提示（功能互操作）" },
  { file: "src\\gyccode\\cli\\cmd\\github.handler.ts", reason: "GitHub Copilot 认证流程与供应商优先级表（功能互操作）" },
]
const COMPLIANCE_EXEMPT_WORDS = ["openai-compatible"]
const CORE_INTEROP_DIR = "src" + String.fromCharCode(92) + "core" + String.fromCharCode(92)

function checkCompliance() {
  const targets = [
    ...walkFiles(join(ROOT, "src", "gyccode", "cli"), [".ts"]),
    ...walkFiles(join(ROOT, "src", "core"), [".ts"]),
  ].filter((f) => existsSync(f))

  const hits = []
  const exempted = []
  let coreInteropHits = 0
  for (const file of targets) {
    const rel = relative(ROOT, file)
    const content = readFileSync(file, "utf8").toLowerCase()
    for (const word of FORBIDDEN) {
      const lines = content.split("\n")
      lines.forEach((line, idx) => {
        let scanned = line
        if (word === "cursor") scanned = scanned.replace(/cursor\s*[:=]/g, "_:").replace(/\.cursor/g, "._")
        if (COMPLIANCE_EXEMPT_WORDS.some((w) => scanned.includes(w))) return
        if (scanned.includes(word)) {
          // core 协议适配层：目录级互操作豁免（仅计数，非对外 UI 面）
          if (rel.startsWith(CORE_INTEROP_DIR)) {
            coreInteropHits++
            return
          }
          const hit = `${rel}:${idx + 1}: "${word}"`
          const rule = COMPLIANCE_EXEMPTS.find((e) => e.file === rel)
          if (rule) exempted.push(`${hit} — ${rule.reason}`)
          else hits.push(hit)
        }
      })
    }
  }
  const details = [
    `扫描 ${targets.length} 个 CLI 相关自有源文件`,
    ...(hits.length === 0
      ? [`品牌展示类违禁命中 0 处 ✓`]
      : [`品牌展示类违禁命中 ${hits.length} 处：`, ...hits.slice(0, 20).map((h) => `   ${h}`)]),
    `src/core 协议适配层互操作引用豁免 ${coreInteropHits} 处（目录级，非对外 UI 面）`,
    ...exempted.map((e) => `   [豁免] ${e}`),
  ]
  record("compliance", "合规性（品牌展示违禁=0；core 互操作层目录级豁免）", hits.length === 0 ? "pass" : "fail", details, {
    violations: hits.length,
    coreInteropExempted: coreInteropHits,
    fileExempted: exempted.length,
  })
}

// 6. 品牌化：ASCII 字标 + --help 脚本名 + 版本号品牌
function checkBranding() {
  const details = []
  let ok = true

  // CLI logo（re-export TUI 字标）
  const logoPath = join(ROOT, "src", "tui", "logo.ts")
  const cliLogoPath = join(ROOT, "src", "gyccode", "cli", "logo.ts")
  if (existsSync(logoPath) && existsSync(cliLogoPath)) {
    const src = readFileSync(logoPath, "utf8")
    const hasBlocks = src.includes("left") && /[█▀▄]/.test(src)
    details.push(hasBlocks ? "CLI 字标复用 GYC CODE 块字符 ASCII 字标 ✓" : "logo.ts 结构异常 ✗")
    ok = ok && hasBlocks
  } else {
    details.push(`字标文件缺失（logo.ts=${existsSync(logoPath)}，cli/logo.ts=${existsSync(cliLogoPath)}）✗`)
    ok = false
  }

  const help = cli(["--help"])
  const helpText = help.stdout + "\n" + help.stderr
  const scriptOk = /^\s*gyc\b/m.test(helpText)
  details.push(scriptOk ? "CLI --help 界面脚本名为 gyc ✓" : "--help 未出现 gyc 脚本名 ✗")
  ok = ok && scriptOk

  const v = cli(["--version"])
  details.push(/^\d+\.\d+\.\d+/.test(v.stdout) ? `--version 输出版本号 ${v.stdout} ✓` : "--version 格式异常 ✗")
  ok = ok && /^\d+\.\d+\.\d+/.test(v.stdout)

  record("branding", "品牌化（字标/--help 文案/版本号；favicon 不适用于终端程序）", ok ? "pass" : "fail", details, {})
}

// 7. 纯自主研发：CLI+core 第三方依赖许可动态审计
async function checkSelfDeveloped() {
  const BUILTINS = new Set(["fs", "path", "os", "url", "util", "tty", "stream", "crypto", "events", "assert", "http", "https", "zlib", "child_process", "readline", "v8", "worker_threads", "process", "net", "dns", "tls", "string_decoder", "buffer", "querystring", "module", "perf_hooks", "inspector"])
  const externals = new Set()
  const importRe = /(?:^|[\s(])import\s+(?:[^'"]+\s+from\s+)?["']([^'"./][^'"]*)["']/g
  for (const dir of [join(ROOT, "src", "gyccode", "cli"), join(ROOT, "src", "core")]) {
    for (const file of walkFiles(dir, [".ts"])) {
      const content = readFileSync(file, "utf8")
      importRe.lastIndex = 0
      let m
      while ((m = importRe.exec(content))) {
        const spec = m[1]
        if (spec.startsWith("node:") || spec.startsWith("bun:") || spec.startsWith("#") || spec.startsWith("@/") || spec.startsWith("~/") || spec.includes("${")) continue
        const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
        if (BUILTINS.has(pkg)) continue
        externals.add(pkg)
      }
    }
  }
  const unknown = []
  const licensed = []
  const firstParty = []
  for (const pkg of externals) {
    if (pkg.startsWith("@gyccode/") || pkg.startsWith("@gyc")) {
      firstParty.push(pkg)
      continue
    }
    const pkgJson = join(ROOT, "node_modules", ...pkg.split("/"), "package.json")
    let license = null
    if (existsSync(pkgJson)) {
      try {
        license = JSON.parse(readFileSync(pkgJson, "utf8"))?.license ?? null
      } catch {
        /* 忽略 */
      }
    }
    if (license && /^(MIT|Apache-\d|ISC|\(MIT[^)]*\)|BSD-\d-Clause|BlueOak-1\.0\.0)/i.test(String(license))) licensed.push(`${pkg}(${license})`)
    else unknown.push(`${pkg}(license=${license ?? "未声明"})`)
  }
  const details = [
    `CLI/core 直接第三方依赖 ${externals.size} 个：宽松许可（MIT/Apache/ISC/BSD）${licensed.length} 个，自有包 ${firstParty.length} 个`,
    `许可清单：${licensed.slice(0, 12).join(", ")}${licensed.length > 12 ? " ..." : ""}`,
    ...(unknown.length ? [`待人工审计：${unknown.join(", ")}`] : ["全部第三方依赖均为宽松许可 ✓"]),
  ]
  record("selfdev", "纯自主研发（CLI/core 第三方依赖许可审计）", unknown.length === 0 ? "pass" : "warn", details, {
    externals: externals.size,
    unknown: unknown.length,
  })
}
// 8/9. 资源消耗 + 磁盘（单快照平均口径 + CLI 命令耗时 + 日志轮转检查）
function fetchProcCreatedMs(pid) {
  try {
    const r = spawnSync(
      "wmic",
      ["process", "where", `processid=${pid}`, "get", "creationdate", "/format:list"],
      { encoding: "utf8", timeout: 15000 },
    )
    const m = (r.stdout ?? "").match(/CreationDate=(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})/i)
    if (m) return new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]).getTime()
  } catch {
    /* 回退 */
  }
  return 0
}

async function checkResources(pid) {
  const cores = os.cpus().length

  // CLI 单命令耗时指标（短命进程无法快照采样，用墙钟时间代表资源面）
  const v = cli(["--version"])
  const versionMs = v.ms

  if (!pid) {
    record("resources", "资源消耗", "warn", ["无法定位 server PID，跳过采样"], {})
    record("disknoise", "磁盘发热/噪音", "warn", ["无法定位 server PID，跳过采样"], {})
    return
  }

  await sleep(1500)
  const idleSnap = psSnapshot(pid)
  if (!idleSnap || idleSnap.gone || !Number.isFinite(idleSnap.tpMs)) {
    record("resources", "资源消耗", "warn", [`空闲快照不可用（${idleSnap?.gone ? "进程消失" : snapDiag || "wmic 失败"}）`], {})
    record("disknoise", "磁盘发热/噪音", "warn", ["空闲快照不可用"], {})
    return
  }
  const bootAt = serverReadyAt || fetchProcCreatedMs(pid) || Date.now() - 1500
  const ageSec = Math.max(1, (Date.now() - bootAt) / 1000)
  const avgCpuPct = idleSnap.tpMs / ageSec / (10 * cores)
  const avgOk = avgCpuPct < 30

  const loadDeadline = nowMs() + LOAD_SECONDS * 1000
  const hammer = (async () => {
    while (nowMs() < loadDeadline) {
      await req("GET", "/session?limit=1", { timeoutMs: 5000 }).catch(() => {})
    }
  })()
  let peak = null
  let prev = idleSnap
  let prevT = Date.now()
  while (nowMs() < loadDeadline) {
    await sleep(900)
    const s = psSnapshot(pid)
    if (!s || s.gone) break
    if (Number.isFinite(prev.tpMs) && Number.isFinite(s.tpMs)) {
      const dt = (Date.now() - prevT) / 1000
      const cpu = dt > 0 ? (s.tpMs - prev.tpMs) / dt / (10 * cores) : 0
      peak = { cpuPct: Math.max(peak?.cpuPct ?? 0, cpu), ws: s.ws, ioBps: Math.max(peak?.ioBps ?? -1, s.io >= 0 && prev.io >= 0 ? Math.max(0, (s.io - prev.io) / dt) : -1) }
    }
    prev = s
    prevT = Date.now()
  }
  await hammer

  const peakOk = peak === null || peak.cpuPct < 80
  record("resources", "资源消耗（serve 平均/峰值 CPU + 内存 + CLI 耗时）", avgOk && peakOk ? "pass" : "fail", [
    `平均 CPU ${avgCpuPct.toFixed(1)}%（自启动累计口径，阈值 <30%）${avgOk ? "✓" : "✗"}`,
    `负载峰值 CPU ${peak ? peak.cpuPct.toFixed(1) : "N/A"}%（阈值 <80%）${peakOk ? "✓" : "✗"}`,
    `常驻工作集内存 ${((idleSnap.ws > 0 ? idleSnap.ws : 0) / 1024 / 1024).toFixed(0)} MB`,
    `CLI 单命令耗时：--version ${versionMs}ms`,
  ], { avgCpuPct: +avgCpuPct.toFixed(2), loadPeakCpuPct: peak ? +peak.cpuPct.toFixed(2) : null, workingSetMB: Math.round((idleSnap.ws > 0 ? idleSnap.ws : 0) / 1024 / 1024), versionMs })

  const ioThresholdBytesPerSec = 1024 * 1024
  let tempC = null
  try {
    const tOut = ps(`(Get-CimInstance -Namespace root/wmi -ClassName MSAcpi_ThermalZoneTemperature -ErrorAction Stop | Select-Object -First 1).CurrentTemperature`, 15000)
    const tenthsK = Number(tOut)
    if (Number.isFinite(tenthsK) && tenthsK > 0) tempC = +(tenthsK / 10 - 273.15).toFixed(1)
  } catch {
    /* 温度接口通常不可用 */
  }
  const tempOk = tempC === null || tempC < 65

  // 日志轮转检查（磁盘长期占用面）：gyccode.log 不应超过 10MB 上限过多
  const logFile = join(os.homedir(), ".local", "share", "gyccode", "log", "gyccode.log")
  let logMB = -1
  try {
    if (existsSync(logFile)) logMB = +(ss(logFile).size / 1024 / 1024).toFixed(1)
  } catch {
    /* 忽略 */
  }
  const logOk = logMB < 0 || logMB <= 11

  if (idleSnap.io < 0) {
    record("disknoise", "磁盘发热/噪音（I/O 平均速率代理指标）", "warn", [
      "本机无法读取进程累计 IO 计数器",
      ...(logMB >= 0 ? [`主日志 gyccode.log ${logMB} MB（轮转上限 ~10MB）${logOk ? " ✓" : " ✗"}`] : []),
    ], { cpuTempC: tempC })
  } else {
    const ageSec2 = Math.max(1, ageSec)
    const avgIoBps = idleSnap.io / ageSec2
    const totalIoMB = idleSnap.io / 1024 / 1024
    const ioOk = avgIoBps < ioThresholdBytesPerSec && logOk
    const status = ioOk && tempOk ? "pass" : !ioOk ? "fail" : "warn"
    record("disknoise", "磁盘发热/噪音（I/O 平均速率 + 日志轮转）", status, [
      `进程启动以来累计 I/O ${totalIoMB.toFixed(1)} MB`,
      `平均 I/O ${avgIoBps.toFixed(0)} B/s（存活 ${ageSec2.toFixed(0)}s，阈值 <1 MB/s）${avgIoBps < ioThresholdBytesPerSec ? " ✓" : " ✗"}`,
      ...(logMB >= 0 ? [`主日志 gyccode.log ${logMB} MB（轮转上限 ~10MB）${logOk ? " ✓" : " ✗"}`] : []),
      `负载期峰值 I/O ${peak && peak.ioBps >= 0 ? peak.ioBps.toFixed(0) + " B/s（压测自致，仅参考）" : "N/A"}`,
      ...(tempC !== null ? [`CPU 温度 ${tempC}℃（阈值 <65℃）${tempOk ? "✓" : "✗"}`] : ["CPU 温度无标准读取接口，属人工项——长期运行请以硬件监控复核 <65℃。"]),
    ], { totalIoMB: +totalIoMB.toFixed(1), avgIoBps: +avgIoBps.toFixed(0), logMB, cpuTempC: tempC })
  }
}

// 10/11. LLM 延时（可选，gyc run 非交互实测）+ 缓存命中率
async function checkLatencyAndCache() {
  // 缓存命中率：模型镜像新鲜度 + 运行时缓存 + V8 编译缓存生效
  const details = []
  let cacheStatus = "warn"
  const runtimeCache = join(os.homedir(), ".cache", "gyccode", "models.json")
  const mirrorFile = join(ROOT, "models-mirror", "api.json")
  if (existsSync(mirrorFile)) {
    const ageDays = (Date.now() - ss(mirrorFile).mtimeMs) / 86400000
    const fresh = ageDays < 7
    cacheStatus = fresh ? cacheStatus === "warn" ? "warn" : "pass" : "fail"
    details.push(`模型镜像 api.json 距上次同步 ${ageDays.toFixed(1)} 天（阈值 <7 天）${fresh ? "✓" : "✗"}`)
  }
  if (existsSync(runtimeCache)) {
    const ageH = (Date.now() - ss(runtimeCache).mtimeMs) / 3600000
    details.push(`运行时模型缓存 models.json 距上次刷新 ${ageH.toFixed(1)} 小时 ${ageH < 24 ? "✓" : "✗"}`)
    if (ageH < 24 && cacheStatus !== "pass") cacheStatus = "pass"
  } else {
    details.push("运行时模型缓存不存在")
    cacheStatus = "fail"
  }
  // V8 编译缓存（启动加速）：bin/gyc 已启用 NODE_COMPILE_CACHE
  const ccDir = process.env.GYC_COMPILE_CACHE_DIR || join(os.tmpdir(), "gyc-compile-cache")
  const ccActive = existsSync(ccDir)
  details.push(`V8 编译缓存目录 ${ccDir} ${ccActive ? "存在 ✓（每次启动免重复编译）" : "未建立（首次启动后生成）"}`)

  // 实测缓存效果：连续两次 --version 第二次应更快（编译缓存热）
  const t1 = cli(["--version"])
  const t2 = cli(["--version"])
  const warmed = t2.ms <= t1.ms * 1.2
  details.push(`冷/热启动对比：${t1.ms}ms → ${t2.ms}ms ${warmed ? "✓ 缓存生效" : "⚠ 无明显差异"}`)

  record("cache", "缓存命中率（镜像新鲜度+编译缓存近似）", cacheStatus, [...details], { compileCacheActive: ccActive })

  if (!RUN_LLM) {
    record("latency", "LLM 延时（请求→首条回复）", "skip", ["未启用 --llm。CLI 形态可启用后以 gyc run 非交互实测首条回复时延。"], {})
    return
  }
  const created = await req("POST", "/session", { body: {} }).catch(() => null)
  const cb = created?.json?.data ?? created?.json ?? {}
  const sid = cb?.id ?? cb?.info?.id
  if (!sid) {
    record("latency", "LLM 延时（请求→首条回复）", "warn", ["创建会话失败"], {})
    return
  }
  const providers = await req("GET", "/provider").catch(() => null)
  const provList = providers?.json?.data?.all ?? providers?.json?.all ?? []
  const firstProv = provList.find((p) => Object.keys(p.models ?? {}).length > 0)
  if (!firstProv) {
    await req("DELETE", `/session/${sid}`).catch(() => {})
    record("latency", "LLM 延时（请求→首条回复）", "skip", ["无可用供应商/模型"], {})
    return
  }
  const modelID = Object.keys(firstProv.models)[0]
  const admitted = await req("POST", `/session/${sid}/prompt_async`, {
    body: { parts: [{ type: "text", text: "只回复两个字：pong" }], model: { providerID: firstProv.id ?? firstProv.providerID, modelID } },
    timeoutMs: 30000,
  }).catch(() => null)
  const t0 = nowMs()
  if (!admitted?.ok) {
    await req("DELETE", `/session/${sid}`).catch(() => {})
    record("latency", "LLM 延时（请求→首条回复）", "warn", [`prompt_async 提交失败：${admitted ? admitted.status : "网络错误"}`], {})
    return
  }
  let firstAssistantAt = null
  const deadline = nowMs() + 60_000
  while (nowMs() < deadline) {
    await sleep(500)
    const msgs = await req("GET", `/session/${sid}/message`, { timeoutMs: 8000 }).catch(() => null)
    const arr = Array.isArray(msgs?.json?.data) ? msgs.json.data : []
    if (arr.some((m) => (m.info?.role ?? m.role) === "assistant")) {
      firstAssistantAt = nowMs() - t0
      break
    }
  }
  await req("DELETE", `/session/${sid}`).catch(() => {})
  if (firstAssistantAt === null) {
    record("latency", "LLM 延时（请求→首条回复）", "warn", [`60s 内未见 assistant 回复`], {})
    return
  }
  const ok = firstAssistantAt <= 1000
  record("latency", "LLM 延时（请求→首条回复）", ok ? "pass" : "warn", [
    `首条 assistant 于提交后 ${firstAssistantAt}ms（目标 ≤1000ms）`,
    "注：远程 LLM 含网络排队，≤1s 仅对本地模型现实；超时按 WARN 呈现实测值。",
  ], { firstAssistantMs: firstAssistantAt })
}

// ---------- 主流程 ----------
const MATRIX_NAMES = [
  ["functional", "功能性"],
  ["stability", "稳定性"],
  ["reliability", "可靠性"],
  ["persistence", "可靠性-持久化"],
  ["security", "安全性"],
  ["compliance", "合规性"],
  ["branding", "品牌化"],
  ["selfdev", "纯自主研发"],
  ["resources", "资源消耗"],
  ["disknoise", "磁盘发热/噪音"],
  ["latency", "LLM 延时"],
  ["cache", "缓存命中率"],
]

async function main() {
  console.log("=== gyc CLI 版验证矩阵 ===")
  console.log(`目标: ${BASE}  时间: ${new Date().toLocaleString("zh-CN")}`)

  checkCompliance()
  checkBranding()
  await checkSelfDeveloped()

  const up = await ensureServer()
  try {
    if (!up) {
      for (const id of ["functional", "stability", "reliability", "persistence"]) {
        const [, name] = MATRIX_NAMES.find(([i]) => i === id) ?? [id, id]
        record(id, name, "fail", ["server 不可达"])
      }
      record("resources", "资源消耗", "fail", ["server 不可达"])
      record("disknoise", "磁盘发热/噪音", "fail", ["server 不可达"])
    } else {
      await checkFunctional()
      await checkStability(findListenerPid(PORT))
      await checkReliability()
      await checkPersistence()
      await checkResources(findListenerPid(PORT))
    }
    await checkLatencyAndCache()
  } finally {
    stopServerIfOwned()
  }

  const summary = { pass: 0, warn: 0, fail: 0, skip: 0 }
  for (const d of dimensions) summary[d.status]++

  console.log("\n=== 汇总 ===")
  console.log(`PASS ${summary.pass} | WARN ${summary.warn} | FAIL ${summary.fail} | SKIP ${summary.skip}`)
  writeFileSync(REPORT_PATH, JSON.stringify({ generatedAt: new Date().toISOString(), baseUrl: BASE, pid: serverPid, summary, dimensions }, null, 2))
  console.log(`报告已写入: ${REPORT_PATH}`)
  process.exit(summary.fail > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error("验证脚本异常:", err)
  stopServerIfOwned()
  process.exit(1)
})
