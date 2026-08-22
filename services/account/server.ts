/**
 * gyc-code 自建账号服务（替代第三方控制台 OAuth）
 *
 * - 技术栈：Bun + bun:sqlite，零 npm 依赖
 * - 端口：8787（可用 GYCCODE_ACCOUNT_PORT 覆盖）
 * - 协议：与 gyccode provider / account 模块对齐（设备码 OAuth RFC 8628）
 *
 * 启动：bun services/account/server.ts
 * 客户端：export GYCCODE_ACCOUNT_URL=http://localhost:8787
 */
import { Database } from "bun:sqlite"
import { randomBytes, randomUUID } from "node:crypto"

const PORT = Number(process.env.GYCCODE_ACCOUNT_PORT ?? 8787)
const BASE = `http://localhost:${PORT}`

const db = new Database("services/account/gyccode-account.db")
db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    email TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'user', -- user | admin
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS orgs (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS org_members (
    org_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    PRIMARY KEY (org_id, user_id)
  );
  CREATE TABLE IF NOT EXISTS device_codes (
    device_code TEXT PRIMARY KEY,
    user_code TEXT UNIQUE NOT NULL,
    client_id TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending', -- pending | approved | rejected | expired
    user_id TEXT,
    org_id TEXT,
    expires_at INTEGER NOT NULL,
    interval_sec INTEGER NOT NULL DEFAULT 5
  );
  CREATE TABLE IF NOT EXISTS tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    org_id TEXT NOT NULL,
    type TEXT NOT NULL, -- access | refresh
    expires_at INTEGER NOT NULL,
    created_at INTEGER NOT NULL
  );
  -- 等保三级：安全审计（登录/注册/登出/设备授权/权限变更等敏感操作留痕）
  CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT,
    action TEXT NOT NULL,
    detail TEXT NOT NULL DEFAULT '',
    ip TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL
  );
`)

// 迁移：老库 users 表补充 password_hash / role 列（幂等）
const userCols = db.prepare("PRAGMA table_info(users)").all().map((c) => c.name)
if (!userCols.includes("password_hash")) db.exec("ALTER TABLE users ADD COLUMN password_hash TEXT NOT NULL DEFAULT ''")
if (!userCols.includes("role")) db.exec("ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'")

// 种子数据：默认账号（admin） + 本地组织
// 密码：GYCCODE_ADMIN_PASSWORD 覆盖，默认 admin123 仅限本地开发（生产必须 env 注入）
const adminPassword = process.env.GYCCODE_ADMIN_PASSWORD ?? "admin123"
if (!process.env.GYCCODE_ADMIN_PASSWORD) {
  console.warn("[警告] 未设置 GYCCODE_ADMIN_PASSWORD，种子管理员使用默认密码（仅限本地开发）")
}
const seedUser = { id: "u_local", email: "admin@gyccode.local", name: "本地管理员" }
const seedOrg = { id: "org_local", name: "gyc-local" }
const seedPasswordHash = await Bun.password.hash(adminPassword, { algorithm: "argon2id" })
db.prepare(
  "INSERT OR IGNORE INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'admin', ?)",
).run(seedUser.id, seedUser.email, seedUser.name, seedPasswordHash, Date.now())
db.prepare("INSERT OR IGNORE INTO orgs (id, name, created_at) VALUES (?, ?, ?)").run(
  seedOrg.id, seedOrg.name, Date.now(),
)
db.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id) VALUES (?, ?)").run(seedOrg.id, seedUser.id)

const rand = (bytes: number) => randomBytes(bytes).toString("hex")
const userCode = () => {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
  return Array.from({ length: 8 }, () => alphabet[Math.floor(Math.random() * alphabet.length)]).join("")
}

function json(res: Response, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function bearerToken(req: Request): string | undefined {
  const auth = req.headers.get("authorization")
  if (!auth?.startsWith("Bearer ")) return undefined
  return auth.slice(7)
}

function orgId(req: Request): string | undefined {
  return req.headers.get("x-org-id") ?? undefined
}

// ---------- 审计日志（等保三级：安全审计） ----------

function audit(userId: string | null, action: string, detail: string, req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? ""
  db.prepare("INSERT INTO audit_logs (user_id, action, detail, ip, created_at) VALUES (?, ?, ?, ?, ?)").run(
    userId, action, detail, ip, Date.now(),
  )
}

function html(res: string, status = 200): Response {
  return new Response(res, { status, headers: { "content-type": "text/html; charset=utf-8" } })
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

// ---------- 设备码 OAuth ----------

function handleDeviceCode(body: Record<string, unknown>): Response {
  const deviceCode = rand(24)
  const code = userCode()
  const now = Date.now()
  db.prepare(
    "INSERT INTO device_codes (device_code, user_code, client_id, status, expires_at, interval_sec) VALUES (?, ?, ?, 'pending', ?, 5)",
  ).run(deviceCode, code, String(body.client_id ?? "gyccode-cli"), now + 30 * 60 * 1000)

  return json(
    new Response(),
    200,
    {
      device_code: deviceCode,
      user_code: code,
      verification_uri_complete: `${BASE}/device/confirm?user_code=${code}`,
      expires_in: 1800,
      interval: 5,
    },
  )
}

function issueTokens(userId: string, orgIdValue: string): { access_token: string; refresh_token: string; expires_in: number } {
  const access = rand(32)
  const refresh = rand(32)
  const now = Date.now()
  db.prepare("INSERT INTO tokens (token, user_id, org_id, type, expires_at, created_at) VALUES (?, ?, ?, 'access', ?, ?)").run(
    access, userId, orgIdValue, now + 7 * 24 * 3600 * 1000, now,
  )
  db.prepare("INSERT INTO tokens (token, user_id, org_id, type, expires_at, created_at) VALUES (?, ?, ?, 'refresh', ?, ?)").run(
    refresh, userId, orgIdValue, now + 30 * 24 * 3600 * 1000, now,
  )
  return { access_token: access, refresh_token: refresh, expires_in: 7 * 24 * 3600 }
}

function handleDeviceToken(body: Record<string, unknown>, req: Request): Response {
  const grantType = String(body.grant_type ?? "")

  if (grantType === "urn:ietf:params:oauth:grant-type:device_code") {
    const row = db
      .prepare("SELECT * FROM device_codes WHERE device_code = ?")
      .get(String(body.device_code ?? "")) as
      | { status: string; user_id: string | null; org_id: string | null; expires_at: number; interval_sec: number }
      | undefined
    if (!row || Date.now() > row.expires_at) {
      return json(new Response(), 400, { error: "expired_token", error_description: "Device code expired" })
    }
    if (row.status === "pending") return json(new Response(), 400, { error: "authorization_pending" })
    if (row.status === "rejected") return json(new Response(), 400, { error: "access_denied" })
    if (row.status !== "approved" || !row.user_id || !row.org_id) {
      return json(new Response(), 400, { error: "authorization_pending" })
    }
    return json(new Response(), 200, issueTokens(row.user_id, row.org_id))
  }

  if (grantType === "refresh_token") {
    const row = db
      .prepare("SELECT * FROM tokens WHERE token = ? AND type = 'refresh'")
      .get(String(body.refresh_token ?? "")) as
      | { user_id: string; org_id: string; expires_at: number }
      | undefined
    if (!row || Date.now() > row.expires_at) return json(new Response(), 400, { error: "invalid_grant" })
    db.prepare("DELETE FROM tokens WHERE token = ?").run(String(body.refresh_token))
    const next = issueTokens(row.user_id, row.org_id)
    audit(row.user_id, "token.refresh", "", req)
    return json(new Response(), 200, next)
  }

  return json(new Response(), 400, { error: "unsupported_grant_type" })
}

// ---------- 确认页（浏览器） ----------

function handleConfirmPage(userCodeValue: string): Response {
  const row = db.prepare("SELECT * FROM device_codes WHERE user_code = ?").get(userCodeValue) as
    | { device_code: string; status: string; client_id: string }
    | undefined
  if (!row) {
    return html(`<!doctype html><meta charset="utf-8"><title>无效代码</title><h1>无效的确认码</h1>`)
  }
  const state = row.status === "pending" ? "等待确认" : row.status === "approved" ? "已批准" : "已拒绝"
  return html(`<!doctype html>
<meta charset="utf-8"><title>授权确认</title>
<style>body{font-family:system-ui;max-width:520px;margin:80px auto;line-height:1.7}button{font-size:16px;padding:10px 24px;margin-right:12px;border-radius:8px;border:1px solid #ccc;cursor:pointer}</style>
<h1>gyc-code 设备授权</h1>
<p>确认码：<strong>${esc(userCodeValue)}</strong>（状态：${esc(state)}）</p>
<p>此设备请求访问你的 gyc-code 账号（client: ${esc(row.client_id)}）。</p>
<form method="post" action="/device/confirm">
  <input type="hidden" name="user_code" value="${esc(userCodeValue)}">
  <button name="approve" value="yes" style="background:#1a7f37;color:#fff;border-color:#1a7f37">批准</button>
  <button name="approve" value="no">拒绝</button>
</form>`)
}

function handleConfirmPost(body: Record<string, unknown>): Response {
  const userCodeValue = String(body.user_code ?? "")
  const approve = String(body.approve ?? "no") === "yes"
  const now = Date.now()
  const info = db
    .prepare("UPDATE device_codes SET status = ?, user_id = ?, org_id = ? WHERE user_code = ? AND status = 'pending' AND expires_at > ?")
    .run(approve ? "approved" : "rejected", seedUser.id, seedOrg.id, userCodeValue, now)
  if (info.changes === 0) return html(`<meta charset="utf-8"><h1>确认码无效或已过期</h1>`)
  return html(`<meta charset="utf-8"><h1>${approve ? "已批准，请返回终端" : "已拒绝"}</h1>`)
}

// ---------- 用户体系（身份鉴别 + 访问控制） ----------

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

async function handleRegister(body: Record<string, unknown>, req: Request): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase()
  const name = String(body.name ?? "").trim()
  const password = String(body.password ?? "")

  // 输入校验 + 密码强度（等保三级：口令复杂度）
  if (!EMAIL_RE.test(email)) return json(new Response(), 400, { error: "invalid_email" })
  if (!name || name.length > 32) return json(new Response(), 400, { error: "invalid_name" })
  if (password.length < 8 || !/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    return json(new Response(), 400, { error: "weak_password", error_description: "密码至少 8 位且包含字母和数字" })
  }
  if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
    return json(new Response(), 409, { error: "email_taken" })
  }

  const id = `u_${rand(12)}`
  const hash = await Bun.password.hash(password, { algorithm: "argon2id" })
  db.prepare("INSERT INTO users (id, email, name, password_hash, role, created_at) VALUES (?, ?, ?, ?, 'user', ?)").run(
    id, email, name, hash, Date.now(),
  )
  // 新用户默认加入本地组织（最小授权）
  db.prepare("INSERT OR IGNORE INTO org_members (org_id, user_id) VALUES (?, ?)").run(seedOrg.id, id)
  audit(id, "user.register", email, req)
  return json(new Response(), 201, { id, email, name })
}

async function handleLogin(body: Record<string, unknown>, req: Request): Promise<Response> {
  const email = String(body.email ?? "").trim().toLowerCase()
  const password = String(body.password ?? "")
  const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | { id: string; password_hash: string; role: string }
    | undefined

  const valid = row && (await Bun.password.verify(password, row.password_hash))
  if (!valid) {
    audit(null, "user.login_failed", email, req)
    return json(new Response(), 401, { error: "invalid_credentials" })
  }

  const orgRow = db.prepare("SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1").get(row.id) as
    | { org_id: string }
    | undefined
  const tokens = issueTokens(row.id, orgRow?.org_id ?? seedOrg.id)
  audit(row.id, "user.login", email, req)
  return json(new Response(), 200, { ...tokens, user: { id: row.id, email, role: row.role } })
}

function handleLogout(token: string | undefined, req: Request): Response {
  if (!token) return json(new Response(), 401, { error: "unauthorized" })
  const row = db.prepare("SELECT user_id FROM tokens WHERE token = ? AND type = 'access'").get(token) as
    | { user_id: string }
    | undefined
  db.prepare("DELETE FROM tokens WHERE token = ?").run(token)
  audit(row?.user_id ?? null, "user.logout", "", req)
  return json(new Response(), 200, { ok: true })
}

function handleAudit(token: string | undefined, req: Request): Response {
  const auth = resolveToken(token)
  if (!auth) return json(new Response(), 401, { error: "unauthorized" })
  const me = db.prepare("SELECT role FROM users WHERE id = ?").get(auth.user_id) as { role: string } | undefined
  if (me?.role !== "admin") return json(new Response(), 403, { error: "forbidden" })
  const rows = db
    .prepare("SELECT user_id, action, detail, ip, created_at FROM audit_logs ORDER BY id DESC LIMIT 100")
    .all()
  return json(new Response(), 200, rows)
}

// ---------- 认证 API ----------

function resolveToken(token: string | undefined): { user_id: string; org_id: string } | undefined {
  if (!token) return undefined
  const row = db.prepare("SELECT * FROM tokens WHERE token = ? AND type = 'access' AND expires_at > ?").get(token, Date.now()) as
    | { user_id: string; org_id: string }
    | undefined
  return row ? { user_id: row.user_id, org_id: row.org_id } : undefined
}

function handleUser(token: string | undefined): Response {
  const auth = resolveToken(token)
  if (!auth) return json(new Response(), 401, { error: "unauthorized" })
  const user = db.prepare("SELECT id, email, name FROM users WHERE id = ?").get(auth.user_id) as
    | { id: string; email: string; name: string }
    | undefined
  if (!user) return json(new Response(), 404, { error: "not_found" })
  return json(new Response(), 200, { id: user.id, email: user.email })
}

function handleOrgs(token: string | undefined): Response {
  const auth = resolveToken(token)
  if (!auth) return json(new Response(), 401, { error: "unauthorized" })
  const orgs = db
    .prepare("SELECT o.id, o.name FROM orgs o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = ?")
    .all(auth.user_id) as { id: string; name: string }[]
  return json(new Response(), 200, orgs)
}

function handleConfig(token: string | undefined, orgIdHeader: string | undefined): Response {
  const auth = resolveToken(token)
  if (!auth) return json(new Response(), 401, { error: "unauthorized" })
  const org = orgIdHeader ?? auth.org_id
  // 自建服务返回空 provider 配置：模型数据源由客户端 models-dev 提供，用户自行配置模型供应商。
  // 如需统一网关，可在此按 org 返回 provider 映射（见 README）。
  return json(new Response(), 200, { config: { provider: {} } })
}

// ---------- 路由 ----------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === "/health") return json(new Response(), 200, { ok: true })

    // 设备码 OAuth
    if (path === "/auth/device/code" && req.method === "POST") {
      const res = handleDeviceCode(await readBody(req))
      audit(null, "device.code_issued", "", req)
      return res
    }
    if (path === "/auth/device/token" && req.method === "POST") return handleDeviceToken(await readBody(req), req)

    // 浏览器确认页
    if (path === "/device/confirm" && req.method === "GET") return handleConfirmPage(url.searchParams.get("user_code") ?? "")
    if (path === "/device/confirm" && req.method === "POST") {
      const body = await readBody(req)
      const res = handleConfirmPost(body)
      audit(seedUser.id, `device.${String(body.approve) === "yes" ? "approved" : "rejected"}`, String(body.user_code ?? ""), req)
      return res
    }

    // 用户体系
    if (path === "/api/register" && req.method === "POST") return handleRegister(await readBody(req), req)
    if (path === "/api/login" && req.method === "POST") return handleLogin(await readBody(req), req)
    if (path === "/api/logout" && req.method === "POST") return handleLogout(bearerToken(req), req)

    // 认证 API
    const token = bearerToken(req)
    if (path === "/api/user" && req.method === "GET") return handleUser(token)
    if (path === "/api/orgs" && req.method === "GET") return handleOrgs(token)
    if (path === "/api/config" && req.method === "GET") return handleConfig(token, orgId(req))
    if (path === "/api/audit" && req.method === "GET") return handleAudit(token, req)

    return json(new Response(), 404, { error: "not_found" })
  },
})

console.log(`[gyc-code 账号服务] 运行于 ${BASE}（GYCCODE_ACCOUNT_URL 指向此地址）`)
console.log(`  默认账号: ${seedUser.email} / 组织: ${seedOrg.name}`)
console.log(`  Ctrl+C 停止`)
