/**
 * gateway/server.ts — 自建模型网关（企业级）
 *
 * 统一 OpenAI 兼容入口 + 额度管理 + 限流 + 模型调用审计 + 多供应商路由。
 * 替代「客户端直连各家 API」，对齐等保三级（访问控制/资源控制/安全审计）。
 *
 * 启动：bun services/gateway/server.ts        # 默认端口 8791
 * 客户端：GYCCODE_GATEWAY_URL=http://localhost:8791
 *
 * 零 npm 依赖（Bun + bun:sqlite），模式与 services/account 一致。
 */
import { Database } from "bun:sqlite"
import { createHash, randomBytes } from "node:crypto"
import { readFileSync } from "node:fs"
import { mkdirSync } from "node:fs"
import { dirname, join } from "node:path"

const PORT = Number(process.env.GYCCODE_GATEWAY_PORT ?? 8791)
const DB_PATH = process.env.GYCCODE_GATEWAY_DB ?? join(import.meta.dirname, "gyccode-gateway.db")

// 上游 API key：GYCCODE_UPSTREAM_<PROVIDER>_KEY（如 GYCCODE_UPSTREAM_DEEPSEEK_KEY）
const upstreamKey = (provider: string) =>
  process.env[`GYCCODE_UPSTREAM_${provider.toUpperCase().replace(/-/g, "_")}_KEY`] ?? ""

// 管理密钥：创建/吊销 api key、查询用量
const masterKey = process.env.GYCCODE_GATEWAY_MASTER_KEY ?? "gyc-gateway-dev-key"
if (!process.env.GYCCODE_GATEWAY_MASTER_KEY) {
  console.warn("[警告] 未设置 GYCCODE_GATEWAY_MASTER_KEY，使用默认管理密钥（仅限本地开发）")
}

mkdirSync(dirname(DB_PATH), { recursive: true })
const db = new Database(DB_PATH)
db.exec(`
  CREATE TABLE IF NOT EXISTS api_keys (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    key_hash TEXT UNIQUE NOT NULL,
    user_id TEXT NOT NULL DEFAULT '',
    quota_tokens INTEGER NOT NULL DEFAULT -1,
    rpm_limit INTEGER NOT NULL DEFAULT 60,
    used_tokens INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS usage_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    api_key_id TEXT NOT NULL,
    model TEXT NOT NULL,
    prompt_tokens INTEGER NOT NULL DEFAULT 0,
    completion_tokens INTEGER NOT NULL DEFAULT 0,
    total_tokens INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL,
    error TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`)

// ---------- 工具 ----------

const sha256 = (s: string) => createHash("sha256").update(s).digest("hex")

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  })
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

const bearerToken = (req: Request) => {
  const h = req.headers.get("authorization") ?? ""
  return h.startsWith("Bearer ") ? h.slice(7).trim() : ""
}

// ---------- 上游模型目录（models-mirror/api.json，无则内置精简） ----------

const MIRROR_FILE = join(import.meta.dirname, "..", "..", "models-mirror", "api.json")

// SDK 内置 base URL 的供应商映射（镜像 api 字段为空时使用）
const DEFAULT_BASES: Record<string, string> = {
  openai: "https://api.openai.com/v1",
  anthropic: "https://api.anthropic.com", // 暂不支持 Anthropic 消息格式，仅登记
}

function loadCatalog(): Record<string, { id: string; api?: string; models: Record<string, unknown> }> {
  try {
    return JSON.parse(readFileSync(MIRROR_FILE, "utf8")) as never
  } catch {
    return {}
  }
}

const catalog = loadCatalog()

// ---------- 限流（内存滑动窗口，每 key RPM） ----------

const windows = new Map<string, number[]>()

function rateLimit(keyId: string, rpm: number): boolean {
  if (rpm <= 0) return true
  const now = Date.now()
  const arr = (windows.get(keyId) ?? []).filter((t) => now - t < 60_000)
  if (arr.length >= rpm) {
    windows.set(keyId, arr)
    return false
  }
  arr.push(now)
  windows.set(keyId, arr)
  return true
}

// ---------- 审计与用量 ----------

function logUsage(keyId: string, model: string, usage: { prompt?: number; completion?: number; total?: number }, status: string, error = "") {
  const p = usage.prompt ?? 0
  const c = usage.completion ?? 0
  const t = usage.total ?? p + c
  db.prepare(
    "INSERT INTO usage_logs (api_key_id, model, prompt_tokens, completion_tokens, total_tokens, status, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(keyId, model, p, c, t, status, error, Date.now())
  if (status === "ok" && t > 0) {
    db.prepare("UPDATE api_keys SET used_tokens = used_tokens + ? WHERE id = ?").run(t, keyId)
  }
}

// ---------- /v1/chat/completions（OpenAI 兼容，转发上游） ----------

async function handleChat(body: Record<string, unknown>, keyId: string): Promise<Response> {
  const model = String(body.model ?? "")
  const slash = model.indexOf("/")
  const provider = slash > 0 ? model.slice(0, slash) : ""
  const modelId = slash > 0 ? model.slice(slash + 1) : model

  const prov = catalog[provider]
  if (!prov) return json(404, { error: { message: `未知供应商: ${provider}`, type: "invalid_request_error" } })
  if (!prov.models[modelId]) {
    return json(404, { error: { message: `未知模型: ${model}`, type: "invalid_request_error" } })
  }

  // 额度检查
  const key = db.prepare("SELECT * FROM api_keys WHERE id = ?").get(keyId) as
    | { quota_tokens: number; used_tokens: number; rpm_limit: number }
    | undefined
  if (!key) return json(401, { error: { message: "无效的 API key", type: "invalid_request_error" } })
  if (key.quota_tokens >= 0 && key.used_tokens >= key.quota_tokens) {
    logUsage(keyId, model, {}, "quota_exceeded", "额度已用尽")
    return json(429, { error: { message: "额度已用尽，请联系管理员", type: "insufficient_quota" } })
  }
  if (!rateLimit(keyId, key.rpm_limit)) {
    logUsage(keyId, model, {}, "rate_limited", "请求过于频繁")
    return json(429, { error: { message: "请求过于频繁，请稍后重试", type: "rate_limit_exceeded" } })
  }

  // 上游地址与 key
  const base = prov.api ?? DEFAULT_BASES[provider]
  if (!base) return json(501, { error: { message: `供应商 ${provider} 暂不支持网关转发`, type: "invalid_request_error" } })
  const keyEnv = upstreamKey(provider)
  if (!keyEnv) {
    logUsage(keyId, model, {}, "no_upstream_key", "未配置上游密钥")
    return json(500, { error: { message: `未配置上游密钥 GYCCODE_UPSTREAM_${provider.toUpperCase()}_KEY`, type: "server_error" } })
  }

  const upstreamBody = { ...body, model: modelId }
  try {
    const upstream = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${keyEnv}`,
        ...(process.env.GYCCODE_GATEWAY_USER_AGENT
          ? { "user-agent": process.env.GYCCODE_GATEWAY_USER_AGENT }
          : {}),
      },
      body: JSON.stringify(upstreamBody),
    })

    // 流式响应原样透传
    if (String(body.stream ?? "") === "true") {
      const buf = await upstream.arrayBuffer()
      logUsage(keyId, model, {}, upstream.ok ? "ok" : "upstream_error", upstream.ok ? "" : `HTTP ${upstream.status}`)
      return new Response(buf, { status: upstream.status, headers: { "content-type": upstream.headers.get("content-type") ?? "text/event-stream" } })
    }

    const text = await upstream.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = JSON.parse(text)
    } catch {
      /* 非 JSON 响应透传 */
    }
    const usage = (parsed.usage ?? {}) as { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number }
    logUsage(
      keyId,
      model,
      { prompt: usage.prompt_tokens, completion: usage.completion_tokens, total: usage.total_tokens },
      upstream.ok ? "ok" : "upstream_error",
      upstream.ok ? "" : `HTTP ${upstream.status}`,
    )
    return new Response(text, {
      status: upstream.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    })
  } catch (error) {
    logUsage(keyId, model, {}, "error", String(error))
    return json(502, { error: { message: `上游调用失败: ${String(error)}`, type: "server_error" } })
  }
}

// ---------- 管理 API（master key） ----------

function handleAdmin(req: Request, url: URL, method: string): Response | undefined {
  if (!url.pathname.startsWith("/api/")) return undefined
  if (bearerToken(req) !== masterKey) return json(401, { error: "unauthorized" })

  // POST /api/keys：创建
  if (url.pathname === "/api/keys" && method === "POST") {
    const rawKey = `gyc-${randomBytes(24).toString("hex")}`
    const body = null as never // 参数走 query 简化
    const name = url.searchParams.get("name") ?? "default"
    const quota = Number(url.searchParams.get("quota") ?? -1)
    const rpm = Number(url.searchParams.get("rpm") ?? 60)
    const id = `k_${randomBytes(6).toString("hex")}`
    db.prepare(
      "INSERT INTO api_keys (id, name, key_hash, quota_tokens, rpm_limit, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    ).run(id, name, sha256(rawKey), quota, rpm, Date.now())
    void body
    return json(201, { id, name, key: rawKey, quota_tokens: quota, rpm_limit: rpm })
  }

  // GET /api/keys：列表
  if (url.pathname === "/api/keys" && method === "GET") {
    const rows = db
      .prepare("SELECT id, name, quota_tokens, rpm_limit, used_tokens, created_at FROM api_keys ORDER BY created_at DESC")
      .all()
    return json(200, rows)
  }

  // DELETE /api/keys/:id：吊销
  if (url.pathname.startsWith("/api/keys/") && method === "DELETE") {
    const id = url.pathname.slice("/api/keys/".length)
    db.prepare("DELETE FROM api_keys WHERE id = ?").run(id)
    return json(200, { ok: true })
  }

  // GET /api/usage：用量统计
  if (url.pathname === "/api/usage" && method === "GET") {
    const rows = db
      .prepare("SELECT api_key_id, model, sum(total_tokens) as tokens, count(*) as calls, sum(case when status = 'ok' then 1 else 0 end) as ok_calls FROM usage_logs GROUP BY api_key_id, model ORDER BY tokens DESC LIMIT 50")
      .all()
    return json(200, rows)
  }

  return undefined
}

// ---------- 路由 ----------

Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const method = req.method

    if (url.pathname === "/health") return json(200, { ok: true })

    // 模型列表
    if (url.pathname === "/v1/models" && method === "GET") {
      const data = Object.entries(catalog).flatMap(([pid, p]) =>
        Object.keys(p.models).map((mid) => ({ id: `${pid}/${mid}` })),
      )
      return json(200, { object: "list", data })
    }

    // 管理 API
    const admin = handleAdmin(req, url, method)
    if (admin) return admin

    // 对话接口
    if (url.pathname === "/v1/chat/completions" && method === "POST") {
      const token = bearerToken(req)
      const row = db.prepare("SELECT id FROM api_keys WHERE key_hash = ?").get(sha256(token)) as { id: string } | undefined
      if (!row) return json(401, { error: { message: "无效的 API key", type: "authentication_error" } })
      return handleChat(await readBody(req), row.id)
    }

    return json(404, { error: { message: "not found", type: "invalid_request_error" } })
  },
})

console.log(`gyc 模型网关已启动：http://localhost:${PORT}`)
console.log(`  管理密钥：${process.env.GYCCODE_GATEWAY_MASTER_KEY ? "env 注入" : "默认 dev（警告如上）"}`)
console.log(`  模型目录：${Object.keys(catalog).length} 个供应商（models-mirror）`)
