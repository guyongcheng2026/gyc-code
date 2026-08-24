#!/usr/bin/env node
// scripts/verify-web.mjs — gyc web 版 11 维验证矩阵（功能性/稳定性/可靠性/安全性/合规性/
// 品牌化/纯自主研发/资源消耗/磁盘发热噪音/LLM 延时/缓存命中率）。
// 用法：
//   node scripts/verify-web.mjs [--base-url http://127.0.0.1:4100] [--port 4100]
//        [--soak-seconds 20] [--load-seconds 8] [--llm] [--keep-server] [--skip-server-start]
//        [--report web-verify-report.json]
// 输出：控制台中文表格 + JSON 报告；存在 FAIL 时退出码 1。
// 说明：稳定性维度默认采样 soak（可用 --soak-seconds 拉长）；24h 长跑需外部计划任务
//       周期执行本脚本并留存报告，脚本内不阻塞 24 小时。

import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, writeFileSync, readdirSync, statSync, openSync, closeSync } from "node:fs"
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

const PORT = Number(argValue("--port", "4100"))
const BASE = argValue("--base-url", `http://127.0.0.1:${PORT}`)
const SOAK_SECONDS = Number(argValue("--soak-seconds", "20"))
const LOAD_SECONDS = Number(argValue("--load-seconds", "8"))
const RUN_LLM = argFlag("--llm")
const KEEP_SERVER = argFlag("--keep-server")
const SKIP_SERVER_START = argFlag("--skip-server-start")
const REPORT_PATH = argValue("--report", join(ROOT, "web-verify-report.json"))

// 服务端启用 GYCCODE_SERVER_PASSWORD 时所有请求需 Basic 认证；
// 本脚本从环境变量读取凭据（与 server 同环境启动，天然一致）。
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

function ps(script, timeoutMs = 30000) {
  const r = spawnSync("powershell", ["-NoProfile", "-Command", script], { encoding: "utf8", timeout: timeoutMs })
  if (r.error || r.status !== 0) return null
  return r.stdout?.trim() ?? ""
}

function findListenerPid(port) {
  const out = ps(
    `(Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1).OwningProcess`,
  )
  const pid = Number(out)
  return Number.isFinite(pid) && pid > 0 ? pid : null
}

function psSnapshot(pid) {
  // 本机性能计数器 WMI 类（Win32_Perf*）不可用，改用可靠替代：
  // - CPU：Get-Process TotalProcessorTime 累计毫秒（调用方按时间差分+核心数归一）
  // - 内存：WorkingSet64
  // - 磁盘 IO：Win32_Process Read/WriteTransferCount 累计字节（调用方差分求速率）
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

async function reachable() {
  // 任意 HTTP 响应（含 4xx/5xx）都证明端口有服务存活；
  // 仅网络层异常才判定为不可达。
  for (const path of ["/provider", "/"]) {
    try {
      await fetch(BASE + path, { headers: AUTH_HEADERS, signal: AbortSignal.timeout(4000) })
      return true
    } catch {
      /* 继续尝试下一路径 */
    }
  }
  return false
}

async function ensureServer() {
  if (await reachable()) {
    serverPid = findListenerPid(PORT)
    console.log(`server 已在运行 (pid=${serverPid ?? "?"})，直接复用`)
    return true
  }
  if (SKIP_SERVER_START) {
    console.log("server 未运行且指定 --skip-server-start，跳过启动")
    return false
  }
  if (!existsSync(BIN)) {
    console.log(`未找到 ${BIN}，无法启动 server`)
    return false
  }
  console.log("server 未运行，正在启动 server ...")
  const logPath = join(ROOT, "web-verify-server.log")
  const logFile = openSync(logPath, "w")
  const child = spawn(process.execPath, [BIN, "serve", "--port", String(PORT), "--hostname", "127.0.0.1"], {
    stdio: ["ignore", logFile, logFile],
    cwd: ROOT,
  })
  child.on("error", (err) => console.log(`server 子进程错误: ${err.message}`))
  const deadline = nowMs() + 90_000
  while (nowMs() < deadline) {
    await sleep(1000)
    if (child.exitCode !== null) {
      console.log(`server 进程提前退出 code=${child.exitCode}，日志尾部：`)
      console.log(readFileSync(logPath, "utf8").split("\n").slice(-10).join("\n"))
      closeSync(logFile)
      return false
    }
    if (await reachable()) {
      startedByScript = true
      serverPid = findListenerPid(PORT) ?? child.pid
      console.log(`server 已就绪 (pid=${serverPid})，日志: ${logPath}`)
      closeSync(logFile)
      return true
    }
  }
  console.log("server 启动超时（90s），日志尾部：")
  console.log(readFileSync(logPath, "utf8").split("\n").slice(-10).join("\n"))
  return false
}

function stopServerIfOwned() {
  if (!startedByScript || KEEP_SERVER || !serverPid) return
  console.log(`停止由脚本启动的 server (pid=${serverPid})`)
  spawnSync("taskkill", ["/PID", String(serverPid), "/T", "/F"], { stdio: "ignore" })
}

// ---------- 各维检查 ----------

// 1. 功能性：页面/核心 API/会话增删查全链路
async function checkFunctional() {
  const details = []
  let ok = true

  const page = await req("GET", "/", { timeoutMs: 15000 }).catch(() => null)
  const pageOk = page?.ok === true && page.text.includes('id="root"')
  details.push(pageOk ? `页面 GET / → ${page.status}，含 #root 挂载点` : `页面 GET / 异常：${page ? page.status : "网络错误"}`)
  ok = ok && pageOk

  const providers = await req("GET", "/provider").catch(() => null)
  // 服务端响应形态兼容：{data:[...]}（v2 包装）/ {all:[...]}（location 包装）/ 裸数组
  const unwrap = (j) => j?.data ?? j?.all ?? (Array.isArray(j) ? j : null)
  const provList = providers ? unwrap(providers.json) : null
  const provOk = providers?.ok === true && Array.isArray(provList)
  details.push(
    provOk
      ? `GET /provider → ${providers.status}，${provList.length} 个供应商`
      : `GET /provider 异常：${providers ? `status=${providers.status} body=${(providers.text ?? "").slice(0, 80)}` : "网络错误"}`,
  )
  ok = ok && provOk

  const created = await req("POST", "/session", { body: {} }).catch(() => null)
  const sid = created?.json?.data?.id ?? created?.json?.id
  const createOk = created?.ok === true && typeof sid === "string"
  details.push(createOk ? `创建会话成功 id=${sid}` : `创建会话失败：${created ? created.status : "网络错误"}`)

  let getOk = false
  if (createOk) {
    const got = await req("GET", `/session/${sid}`).catch(() => null)
    getOk = (got?.json?.data?.id ?? got?.json?.id) === sid
    details.push(getOk ? "回读会话一致" : "回读会话不一致或失败")
  }

  let delOk = false
  if (createOk) {
    const del = await req("DELETE", `/session/${sid}`).catch(() => null)
    delOk = del?.ok === true
    const listed = await req("GET", "/session?limit=50").catch(() => null)
    const listArr = listed ? unwrap(listed.json) : null
    const stillThere = Array.isArray(listArr) && listArr.some((s) => s.id === sid)
    details.push(delOk && !stillThere ? "删除会话生效且列表已不含该会话" : `删除验证失败：del=${delOk} stillInList=${stillThere}`)
    ok = ok && delOk && !stillThere
  }
  ok = ok && createOk && getOk
  record("functional", "功能性（页面+API+会话增删查）", ok ? "pass" : "fail", details, {})
}

// 2. 稳定性：soak 采样 + 进程存活
async function checkStability(pid) {
  const details = []
  const latencies = []
  let failures = 0
  let requests = 0
  let crashes = 0
  const deadline = nowMs() + SOAK_SECONDS * 1000
  let lastAliveCheck = nowMs()

  while (nowMs() < deadline) {
    try {
      const r = await req("GET", "/provider", { timeoutMs: 5000 })
      requests++
      if (!r.ok) failures++
      else latencies.push(r.latency)
    } catch {
      requests++
      failures++
    }
    if (nowMs() - lastAliveCheck > 2000) {
      lastAliveCheck = nowMs()
      if (pid) {
        const cur = findListenerPid(PORT)
        if (cur !== pid) {
          crashes++
          pid = cur
        }
      }
    }
    await sleep(400)
  }

  latencies.sort((a, b) => a - b)
  const p95 = latencies.length ? latencies[Math.floor(latencies.length * 0.95)] : null
  const failRate = requests ? failures / requests : 1
  details.push(`soak ${SOAK_SECONDS}s：请求 ${requests} 次，失败 ${failures} 次（失败率 ${(failRate * 100).toFixed(1)}%）`)
  if (p95 !== null) details.push(`API p95 延迟 ${p95}ms`)
  details.push(`进程存活检查：异常重启 ${crashes} 次`)
  const status = crashes === 0 && failRate <= 0.01 ? "pass" : "fail"
  record("stability", `稳定性（${SOAK_SECONDS}s 采样，非 24h 全程）`, status, [
    ...details,
    "注：24h 连续运行需以计划任务周期执行本脚本留存报告判定，本项为短窗采样。",
  ], { requests, failures, crashCount: crashes, p95Ms: p95 })
}

// 3. 可靠性：SSE 事件流握手 + 心跳连续性
async function checkReliability() {
  const details = []
  let sseOk = false
  try {
    const ac = new AbortController()
    const res = await fetch(BASE + "/event", {
      headers: { accept: "text/event-stream", ...AUTH_HEADERS },
      signal: ac.signal,
    })
    const ct = res.headers.get("content-type") ?? ""
    sseOk = res.ok && ct.includes("text/event-stream")
    if (res.body) {
      const reader = res.body.getReader()
      await reader.read().catch(() => {})
      reader.cancel().catch(() => {})
    }
    ac.abort()
  } catch {
    sseOk = false
  }
  details.push(sseOk ? "全局事件流 GET /event 握手成功（SSE）" : "事件流握手失败（不影响 HTTP 轮询型可靠性判定）")

  const heartbeats = 5
  let hbFail = 0
  for (let i = 0; i < heartbeats; i++) {
    try {
      const r = await req("GET", "/session?limit=1", { timeoutMs: 5000 })
      if (!r.ok) hbFail++
    } catch {
      hbFail++
    }
    await sleep(300)
  }
  details.push(`心跳探测 ${heartbeats} 次，失败 ${hbFail} 次`)
  record("reliability", "可靠性（持久化链路+心跳+SSE）", hbFail === 0 ? "pass" : "fail", details, {
    heartbeatFailures: hbFail,
    sseHandshake: sseOk,
  })
}

// 4. 安全性：CSP/nosniff/referrer 头 + XSS 面扫描 + 依赖审计
async function checkSecurity() {
  const details = []
  let hardFail = false

  const page = await req("GET", "/", { timeoutMs: 15000 }).catch(() => null)
  const csp = page?.headers?.get("content-security-policy") ?? ""
  const cspOk = csp.includes("default-src 'self'")
  details.push(cspOk ? `CSP 已设置：${csp.slice(0, 80)}...` : "缺少 Content-Security-Policy 响应头")
  hardFail = hardFail || !cspOk

  const nosniff = page?.headers?.get("x-content-type-options") ?? ""
  const nosniffOk = nosniff.toLowerCase() === "nosniff"
  details.push(nosniffOk ? "X-Content-Type-Options: nosniff 已设置" : "缺少 X-Content-Type-Options: nosniff")
  hardFail = hardFail || !nosniffOk

  const referrer = page?.headers?.get("referrer-policy") ?? ""
  const referrerOk = referrer.length > 0
  details.push(referrerOk ? `Referrer-Policy: ${referrer}` : "缺少 Referrer-Policy 响应头")
  hardFail = hardFail || !referrerOk

  // 明文密钥泄漏：/provider 响应不得携带 "key":"<值>" 形态凭据（铁律·数据安全）
  const provBody = await req("GET", "/provider").catch(() => null)
  const keyLeak = provBody?.text ? /"key"\s*:\s*"[^"]+/.test(provBody.text) : false
  details.push(keyLeak ? "/provider 响应检测到明文密钥字段（数据安全违规）" : "/provider 响应未携带明文密钥 ✓")
  hardFail = hardFail || keyLeak

  // XSS 面：React 项目中直用危险 DOM API 的位置
  const srcDir = join(ROOT, "src", "webapp", "src")
  const xssRe = /dangerouslySetInnerHTML|\.innerHTML\s*=|document\.write|\beval\(/g
  const hits = []
  for (const file of walkFiles(srcDir, [".ts", ".tsx"])) {
    const lines = readFileSync(file, "utf8").split("\n")
    lines.forEach((line, idx) => {
      xssRe.lastIndex = 0
      if (xssRe.test(line)) hits.push(`${relative(ROOT, file)}:${idx + 1}: ${line.trim().slice(0, 90)}`)
    })
  }
  if (hits.length === 0) {
    details.push("前端源码未发现 dangerouslySetInnerHTML/innerHTML/document.write/eval 直用")
  } else {
    details.push(`发现 ${hits.length} 处危险 DOM API 使用（需人工确认是否经 dompurify 净化）：`)
    for (const h of hits.slice(0, 10)) details.push(`   ${h}`)
  }

  // 依赖审计：仓库使用 bun.lock，npm audit 需要 package-lock.json
  const hasNpmLock = existsSync(join(ROOT, "package-lock.json"))
  if (!hasNpmLock) {
    details.push("依赖审计：仓库为 bun.lock（npm audit 不适用），标记 SKIP——建议 CI 中以 bun 兼容审计工具补充")
  } else {
    const r = spawnSync("npm", ["audit", "--json", "--omit=dev"], { encoding: "utf8", cwd: ROOT, timeout: 120000 })
    try {
      const audit = JSON.parse(r.stdout)
      const crit = audit?.metadata?.vulnerabilities?.critical ?? 0
      const high = audit?.metadata?.vulnerabilities?.high ?? 0
      details.push(`npm audit：critical=${crit}, high=${high}`)
      hardFail = hardFail || crit + high > 0
    } catch {
      details.push("npm audit 执行失败（网络或环境原因），人工复核")
    }
  }

  record("security", "安全性（安全响应头+XSS 面+密钥泄漏+依赖审计）", hardFail ? "fail" : hits.length > 0 ? "warn" : "pass", details, {
    csp: cspOk,
    nosniff: nosniffOk,
    referrerPolicy: referrerOk,
    keyLeak,
    xssSurfaceHits: hits.length,
  })
}

// 5. 合规性：违禁品牌词扫描（自有源码 + 页面入口）
async function checkCompliance() {
  // 注："cursor" 为高频编程词汇（光标变量/CSS 属性/xterm cursorBlink），自动扫描误报率
  // 过高，不纳入违禁表，由人工审查覆盖。
  const forbidden = ["anthropic", "claude", "codex", "openai", "chatgpt", "copilot", "windsurf", "gemini", "mimo"]
  const targets = [
    ...walkFiles(join(ROOT, "src", "webapp", "src"), [".ts", ".tsx", ".css"]),
    join(ROOT, "src", "webapp", "index.html"),
    join(ROOT, "src", "webapp", "dist", "index.html"),
  ].filter((f) => existsSync(f))

  const hits = []
  for (const file of targets) {
    const content = readFileSync(file, "utf8").toLowerCase()
    for (const word of forbidden) {
      const lines = content.split("\n")
      lines.forEach((line, idx) => {
        if (line.includes(word)) hits.push(`${relative(ROOT, file)}:${idx + 1}: "${word}"`)
      })
    }
  }
  const details =
    hits.length === 0
      ? [`扫描 ${targets.length} 个自有源文件，违禁品牌词命中 0 处`]
      : [`违禁品牌词命中 ${hits.length} 处：`, ...hits.slice(0, 20).map((h) => `   ${h}`)]
  record("compliance", "合规性（违禁品牌词=0）", hits.length === 0 ? "pass" : "fail", details, { hits: hits.length })
}

// 6. 品牌化：标题/favicon
async function checkBranding() {
  const details = []
  let ok = true
  for (const f of ["src/webapp/index.html", "src/webapp/dist/index.html"]) {
    const full = join(ROOT, f)
    if (!existsSync(full)) {
      details.push(`${f} 不存在（未构建？）`)
      continue
    }
    const html = readFileSync(full, "utf8")
    const title = html.match(/<title>([^<]*)<\/title>/i)?.[1] ?? ""
    const titleOk = /gyc/i.test(title)
    details.push(`${f} title="${title}" ${titleOk ? "含 gyc 品牌 ✓" : "缺少 gyc 品牌 ✗"}`)
    ok = ok && titleOk
    if (f.endsWith("dist/index.html")) {
      const favMatch = html.match(/<link[^>]+rel=["']icon["'][^>]+href=["']([^"']+)["']/i)
      if (!favMatch) {
        details.push("dist 页面缺少 favicon link 标签 ✗")
        ok = false
      } else {
        const favPath = favMatch[1].split("?")[0]
        const favRes = await req("GET", favPath.startsWith("/") ? favPath : "/" + favPath, { timeoutMs: 8000 }).catch(() => null)
        const favOk = favRes?.ok === true && (favRes.headers.get("content-type") ?? "").startsWith("image/")
        details.push(`favicon GET ${favPath} → ${favRes ? favRes.status : "网络错误"} ${favOk ? "✓" : "✗"}`)
        ok = ok && favOk
      }
    }
  }
  record("branding", "品牌化（标题/favicon）", ok ? "pass" : "fail", details, {})
}

// 7. 纯自主研发：webapp 外部依赖许可审计
async function checkSelfDeveloped() {
  const licenseMap = {
    react: "MIT",
    "react-dom": "MIT",
    "@monaco-editor/react": "MIT",
    "monaco-editor": "MIT",
    "@xterm/xterm": "MIT",
    "@xterm/addon-fit": "MIT",
    "react-virtuoso": "MIT",
    marked: "MIT",
    "marked-shiki": "MIT",
    shiki: "MIT",
    "@shikijs/stream": "MIT",
    "@shikijs/transformers": "MIT",
    "solid-js": "MIT",
    dompurify: "Apache-2.0/MPL-2.0 双许可",
    katex: "MIT",
    vite: "MIT",
    "vite-plugin-solid": "MIT",
    "@vitejs/plugin-react": "MIT",
    vitest: "MIT",
    jsdom: "MIT",
    tailwindcss: "MIT",
    "tw-animate-css": "MIT",
    typescript: "Apache-2.0",
    "@testing-library/react": "MIT",
    "@testing-library/dom": "MIT",
    luxon: "MIT",
    "@types/luxon": "MIT",
    "@types/react": "MIT",
    "@types/react-dom": "MIT",
  }
  const externals = new Set()
  const importRe = /(?:^|[\s(])import\s+(?:[^'"]+\s+from\s+)?["']([^'"./][^'"]*)["']/g
  const typeImportRe = /export\s+type\s+\{[^}]*\}\s+from\s+["']([^'"./][^'"]*)["']/g
  for (const file of walkFiles(join(ROOT, "src", "webapp", "src"), [".ts", ".tsx"])) {
    const content = readFileSync(file, "utf8")
    for (const re of [importRe, typeImportRe]) {
      re.lastIndex = 0
      let m
      while ((m = re.exec(content))) {
        const spec = m[1]
        const pkg = spec.startsWith("@") ? spec.split("/").slice(0, 2).join("/") : spec.split("/")[0]
        externals.add(pkg)
      }
    }
  }
  const unknown = [...externals].filter((p) => !licenseMap[p] && !p.startsWith("@gyccode/"))
  const firstParty = [...externals].filter((p) => p.startsWith("@gyccode/"))
  const details = [
    `webapp 直接外部依赖 ${externals.size} 个，许可白名单覆盖 ${externals.size - unknown.length - firstParty.length} 个，自有包 ${firstParty.length} 个`,
    ...(unknown.length ? [`待人工审计（不在内置许可表）：${unknown.join(", ")}`] : ["全部第三方依赖均为 MIT/Apache 系许可 ✓"]),
  ]
  record("selfdev", "纯自主研发（第三方 UI 依赖许可审计）", unknown.length === 0 ? "pass" : "warn", details, {
    externals: externals.size,
    unknown: unknown.length,
  })
}

// 8/9. 资源消耗 + 磁盘 IO（累计值差分采样，不依赖性能计数器 WMI 类）
async function checkResources(pid) {
  const cores = os.cpus().length

  if (!pid) {
    record("resources", "资源消耗", "warn", ["无法定位 server PID，跳过采样（请手动观测：空闲 CPU<30%、峰值<80%）"], {})
    record("disknoise", "磁盘发热/噪音（I/O 速率）", "warn", ["无法定位 server PID，跳过采样"], {})
    return
  }

  async function snap() {
    const t = Date.now()
    const s = psSnapshot(pid)
    return s ? { ...s, t } : null
  }
  function rateBetween(s1, s2) {
    if (!s1 || !s2 || s1.gone || s2.gone) return { gone: true }
    const dtSec = (s2.t - s1.t) / 1000
    if (dtSec <= 0 || !Number.isFinite(s1.tp) || !Number.isFinite(s2.tp)) return null
    return {
      cpuPct: (s2.tp - s1.tp) / dtSec / (10 * cores),
      ioBps: s1.io >= 0 && s2.io >= 0 ? Math.max(0, (s2.io - s1.io) / dtSec) : -1,
      ws: s2.ws,
    }
  }
  async function samplePair(gapMs) {
    const s1 = await snap()
    await sleep(gapMs)
    const s2 = await snap()
    return rateBetween(s1, s2)
  }

  await sleep(1500) // 静默期后采空闲档
  const idle = await samplePair(2500)

  // 负载档：并发打 API 期间连续差分采样
  const loadDeadline = nowMs() + LOAD_SECONDS * 1000
  const hammer = (async () => {
    while (nowMs() < loadDeadline) {
      await req("GET", "/provider", { timeoutMs: 5000 }).catch(() => {})
    }
  })()
  let peak = null
  let lastWs = 0
  while (nowMs() < loadDeadline) {
    const r = await samplePair(900)
    if (r?.gone) break
    if (r) {
      lastWs = r.ws
      if (!peak) peak = r
      else {
        peak = {
          cpuPct: Math.max(peak.cpuPct, r.cpuPct),
          ioBps: peak.ioBps === -1 || r.ioBps === -1 ? -1 : Math.max(peak.ioBps, r.ioBps),
          ws: r.ws,
        }
      }
    }
  }
  await hammer

  if (!idle) {
    record("resources", "资源消耗", "warn", ["进程快照采样不可用（权限或平台限制），建议手动观测：空闲 CPU<30%、峰值<80%"], {})
    record("disknoise", "磁盘发热/噪音（I/O 速率）", "warn", ["进程快照采样不可用，建议以 resmon 观测持续低 I/O"], {})
    return
  }
  if (idle.gone) {
    record("resources", "资源消耗", "fail", ["server 进程在采样期间消失（异常退出）"], {})
    record("disknoise", "磁盘发热/噪音（I/O 速率）", "fail", ["server 进程在采样期间消失"], {})
    return
  }

  const idleOk = idle.cpuPct < 30
  const peakOk = peak === null || peak.cpuPct < 80
  record("resources", "资源消耗（CPU 按核心数归一 / 内存）", idleOk && peakOk ? "pass" : "fail", [
    `空闲 CPU ${idle.cpuPct.toFixed(1)}%（阈值 <30%）${idleOk ? "✓" : "✗"}`,
    `负载峰值 CPU ${peak ? peak.cpuPct.toFixed(1) : "N/A"}%（阈值 <80%）${peakOk ? "✓" : "✗"}`,
    `常驻工作集内存 ${((idle.ws ?? lastWs) / 1024 / 1024).toFixed(0)} MB`,
  ], { idleCpuPct: +idle.cpuPct.toFixed(2), loadPeakCpuPct: peak ? +peak.cpuPct.toFixed(2) : null, workingSetMB: Math.round((idle.ws ?? lastWs) / 1024 / 1024) })

  const ioThresholdBytesPerSec = 1024 * 1024 // 1 MB/s 视为低负载
  if (idle.ioBps < 0) {
    record("disknoise", "磁盘发热/噪音（I/O 速率代理指标）", "warn", [
      "本机无法读取进程累计 IO 计数器，建议以 resmon 手动确认持续低 I/O",
    ], {})
  } else {
    const ioOk = idle.ioBps < ioThresholdBytesPerSec
    record("disknoise", "磁盘发热/噪音（I/O 速率代理指标）", ioOk ? "pass" : "fail", [
      `空闲进程 I/O ${idle.ioBps.toFixed(0)} B/s（阈值 <1 MB/s）${ioOk ? "✓" : "✗"}`,
      `负载峰值 I/O ${peak && peak.ioBps >= 0 ? peak.ioBps.toFixed(0) : "N/A"} B/s`,
      "注：CPU 温度无标准读取接口，属人工项——长期运行请以硬件监控复核 <65℃。",
    ], { idleIoBps: +idle.ioBps.toFixed(0), loadPeakIoBps: peak && peak.ioBps >= 0 ? +peak.ioBps.toFixed(0) : null })
  }
}

// 10/11. LLM 延时（可选）+ 缓存命中率（近似）
async function checkLatencyAndCache() {
  // 缓存命中率：本地镜像新鲜度 + provider 接口本地供给延迟（近似指标）
  const mirrorFile = join(ROOT, "models-mirror", "api.json")
  const details = []
  let cacheStatus = "warn"
  if (existsSync(mirrorFile)) {
    const ageDays = (Date.now() - statSync(mirrorFile).mtimeMs) / 86400000
    const fresh = ageDays < 7
    const t = await req("GET", "/provider", { timeoutMs: 8000 }).catch(() => null)
    const fastLocal = t?.latency != null && t.latency < 100
    cacheStatus = fresh && fastLocal ? "pass" : "warn"
    details.push(`模型镜像 api.json 距上次同步 ${ageDays.toFixed(1)} 天（阈值 <7 天）${fresh ? "✓" : "✗"}`)
    details.push(`GET /provider 延迟 ${t?.latency ?? "N/A"}ms（<100ms 判定为本地供给）${fastLocal ? "✓" : "✗"}`)
    details.push("注：真实命中率需服务端埋点统计，此处为镜像新鲜度+本地供给近似。")
  } else {
    details.push("models-mirror/api.json 不存在，模型镜像未建立")
    cacheStatus = "fail"
  }
  record("cache", "缓存命中率（镜像新鲜度近似）", cacheStatus, details, {})

  if (!RUN_LLM) {
    record("latency", "LLM 延时（请求→首条回复）", "skip", ["未启用 --llm，跳过真实 LLM 往返（避免消耗配额）。启用后测量 prompt admit→首条 assistant 消息时延。"], {})
    return
  }

  const providers = await req("GET", "/provider").catch(() => null)
  const pj = providers?.json
  const list = Array.isArray(pj?.data) ? pj.data : Array.isArray(pj?.all) ? pj.all : Array.isArray(pj) ? pj : []
  let chosen = null
  for (const p of list) {
    const models = p.models ?? {}
    const firstModel = Object.keys(models)[0]
    if (firstModel) {
      chosen = { providerID: p.id ?? p.providerID, modelID: firstModel }
      break
    }
  }
  if (!chosen) {
    record("latency", "LLM 延时（请求→首条回复）", "skip", ["无可用供应商/模型配置，无法实测"], {})
    return
  }

  const created = await req("POST", "/session", { body: {} }).catch(() => null)
  const sid = created?.json?.data?.id
  if (!sid) {
    record("latency", "LLM 延时（请求→首条回复）", "warn", ["创建会话失败，无法实测"], {})
    return
  }
  const admitted = await req("POST", `/session/${sid}/prompt_async`, {
    body: { parts: [{ type: "text", text: "只回复两个字：pong" }], model: chosen },
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
    const j = msgs?.json
    const arr = Array.isArray(j?.data) ? j.data : Array.isArray(j?.all) ? j.all : Array.isArray(j) ? j : []
    if (arr.some((m) => (m.info?.role ?? m.role) === "assistant")) {
      firstAssistantAt = nowMs() - t0
      break
    }
  }
  await req("DELETE", `/session/${sid}`).catch(() => {})
  if (firstAssistantAt === null) {
    record("latency", "LLM 延时（请求→首条回复）", "warn", [`60s 内未见 assistant 回复（model=${chosen.providerID}/${chosen.modelID}）`], {})
    return
  }
  const withinTarget = firstAssistantAt <= 1000
  record("latency", "LLM 延时（请求→首条回复）", withinTarget ? "pass" : "warn", [
    `首条 assistant 出现于提交后 ${firstAssistantAt}ms（目标 ≤1000ms）`,
    "注：远程 LLM 含网络与排队时延，≤1s 仅对本地模型现实；超时按 WARN 呈现实测值供评估。",
  ], { firstAssistantMs: firstAssistantAt, model: `${chosen.providerID}/${chosen.modelID}` })
}

// ---------- 主流程 ----------
async function main() {
  console.log("=== gyc web 版验证矩阵 ===")
  console.log(`目标: ${BASE}  时间: ${new Date().toLocaleString("zh-CN")}`)

  const up = await ensureServer()
  try {
    if (!up) {
      for (const [, name] of MATRIX_NAMES) record("offline", name, "fail", ["server 不可达，所有维度无法验证"])
    } else {
      // 预热：/provider 首次触发 models-dev 目录懒加载，冷启动可能超时；
      // 就绪判定要求连续成功，避免把预热期失败计入稳定性采样。
      let warm = false
      for (let i = 0; i < 30 && !warm; i++) {
        const r = await req("GET", "/provider", { timeoutMs: 10000 }).catch(() => null)
        if (r?.ok) warm = true
        else await sleep(2000)
      }
      if (!warm) console.log("警告：/provider 预热未就绪（60s），相关维度将如实记录")
      await checkFunctional()
      await checkStability(findListenerPid(PORT))
      await checkReliability()
      await checkSecurity()
      await checkCompliance()
      await checkBranding()
      await checkSelfDeveloped()
      await checkResources(findListenerPid(PORT))
      await checkLatencyAndCache()
    }
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

const MATRIX_NAMES = [
  ["functional", "功能性"],
  ["stability", "稳定性"],
  ["reliability", "可靠性"],
  ["security", "安全性"],
  ["compliance", "合规性"],
  ["branding", "品牌化"],
  ["selfdev", "纯自主研发"],
  ["resources", "资源消耗"],
  ["disknoise", "磁盘发热/噪音"],
  ["latency", "LLM 延时"],
  ["cache", "缓存命中率"],
]

main().catch((err) => {
  console.error("验证脚本异常:", err)
  stopServerIfOwned()
  process.exit(1)
})
