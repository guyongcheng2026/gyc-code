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

const DB_PATH = process.env.GYCCODE_ACCOUNT_DB ?? "services/account/gyccode-account.db"
const db = new Database(DB_PATH)
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
  -- 套餐定义（1 积分 = 1 元人民币，内部成本按 USD 换算）
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    monthly_credits REAL NOT NULL,
    price_cny REAL NOT NULL,
    created_at INTEGER NOT NULL
  );
  -- 用户积分账户
  CREATE TABLE IF NOT EXISTS credit_accounts (
    user_id TEXT PRIMARY KEY REFERENCES users(id),
    plan_id TEXT NOT NULL DEFAULT 'free' REFERENCES plans(id),
    balance REAL NOT NULL DEFAULT 0,
    monthly_quota REAL NOT NULL DEFAULT 0,
    monthly_used REAL NOT NULL DEFAULT 0,
    monthly_reset_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  -- 积分流水（append-only，审计用）
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    delta REAL NOT NULL,
    balance_after REAL NOT NULL,
    reason TEXT NOT NULL,
    ref_id TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_credit_ledger_user_time ON credit_ledger(user_id, created_at);
  -- 用量上报（幂等去重）
  CREATE TABLE IF NOT EXISTS usage_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    session_id TEXT NOT NULL,
    step_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    tokens_input INTEGER NOT NULL DEFAULT 0,
    tokens_output INTEGER NOT NULL DEFAULT 0,
    tokens_cache_read INTEGER NOT NULL DEFAULT 0,
    tokens_cache_write INTEGER NOT NULL DEFAULT 0,
    cost_usd REAL NOT NULL DEFAULT 0,
    credits_charged REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    UNIQUE(user_id, session_id, step_id)
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

// 种子套餐：基础版（免费）/ 专业版 / 旗舰版
const now = Date.now()
const seedPlans = [
  { id: "free", name: "基础版", monthly_credits: 0, price_cny: 0 },
  { id: "pro", name: "专业版", monthly_credits: 500, price_cny: 99 },
  { id: "max", name: "旗舰版", monthly_credits: 2000, price_cny: 399 },
]
for (const p of seedPlans) {
  db.prepare("INSERT OR IGNORE INTO plans (id, name, monthly_credits, price_cny, created_at) VALUES (?, ?, ?, ?, ?)").run(
    p.id, p.name, p.monthly_credits, p.price_cny, now,
  )
}

// 积分账户：确保每个用户有对应记录（幂等）
function ensureCreditAccount(userId: string) {
  const existing = db.prepare("SELECT user_id FROM credit_accounts WHERE user_id = ?").get(userId)
  if (existing) return
  const resetAt = nextMonthReset()
  db.prepare(
    "INSERT INTO credit_accounts (user_id, plan_id, balance, monthly_quota, monthly_used, monthly_reset_at, updated_at) VALUES (?, 'free', 0, 0, 0, ?, ?)",
  ).run(userId, resetAt, now)
}
function nextMonthReset(): number {
  const d = new Date()
  d.setMonth(d.getMonth() + 1)
  d.setDate(1)
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}
ensureCreditAccount(seedUser.id)

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

// 同时支持 JSON（API）与表单（浏览器确认页 POST）
async function readBody(req: Request): Promise<Record<string, unknown>> {
  const type = req.headers.get("content-type") ?? ""
  try {
    if (type.includes("application/json")) {
      return (await req.json()) as Record<string, unknown>
    }
    const form = await req.formData()
    return Object.fromEntries(form.entries()) as Record<string, unknown>
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
<style>body{font-family:system-ui;max-width:520px;margin:80px auto;line-height:1.7}button{font-size:16px;padding:10px 24px;margin-right:12px;border-radius:8px;border:1px solid #ccc;cursor:pointer}input{font-size:14px;padding:8px;margin:4px 0;width:100%;box-sizing:border-box;border:1px solid #ccc;border-radius:6px}label{font-size:14px;color:#555}</style>
<h1>gyc-code 设备授权</h1>
<p>确认码：<strong>${esc(userCodeValue)}</strong>（状态：${esc(state)}）</p>
<p>此设备请求访问你的 gyc-code 账号（client: ${esc(row.client_id)}）。</p>
<p>请验证身份后批准或拒绝：</p>
<form method="post" action="/device/confirm">
  <input type="hidden" name="user_code" value="${esc(userCodeValue)}">
  <label>邮箱</label>
  <input type="email" name="email" required placeholder="you@example.com">
  <label>密码</label>
  <input type="password" name="password" required>
  <p style="margin-top:16px">
    <button name="approve" value="yes" style="background:#1a7f37;color:#fff;border-color:#1a7f37">批准</button>
    <button name="approve" value="no">拒绝</button>
  </p>
</form>`)
}

// 等保三级：设备授权必须验证操作者身份（修复：原实现硬编码批准为种子 admin）
async function handleConfirmPost(body: Record<string, unknown>, req: Request): Promise<Response> {
  const userCodeValue = String(body.user_code ?? "")
  const approve = String(body.approve ?? "no") === "yes"
  const now = Date.now()

  if (!approve) {
    const info = db
      .prepare("UPDATE device_codes SET status = 'rejected' WHERE user_code = ? AND status = 'pending' AND expires_at > ?")
      .run(userCodeValue, now)
    if (info.changes === 0) return html(`<meta charset="utf-8"><h1>确认码无效或已过期</h1>`)
    return html(`<meta charset="utf-8"><h1>已拒绝</h1>`)
  }

  // 批准必须验证身份：邮箱 + 密码
  const email = String(body.email ?? "").trim().toLowerCase()
  const password = String(body.password ?? "")
  if (!EMAIL_RE.test(email) || !password) {
    return html(`<meta charset="utf-8"><h1>请输入邮箱和密码</h1>`)
  }
  const user = db.prepare("SELECT * FROM users WHERE email = ?").get(email) as
    | { id: string; password_hash: string; role: string }
    | undefined
  const valid = user && (await Bun.password.verify(password, user.password_hash))
  if (!valid) {
    audit(null, "device.confirm_auth_failed", email, req)
    return html(`<meta charset="utf-8"><h1>身份验证失败，请检查邮箱和密码</h1>`)
  }
  const orgRow = db.prepare("SELECT org_id FROM org_members WHERE user_id = ? LIMIT 1").get(user.id) as
    | { org_id: string }
    | undefined
  const info = db
    .prepare("UPDATE device_codes SET status = 'approved', user_id = ?, org_id = ? WHERE user_code = ? AND status = 'pending' AND expires_at > ?")
    .run(user.id, orgRow?.org_id ?? seedOrg.id, userCodeValue, now)
  if (info.changes === 0) return html(`<meta charset="utf-8"><h1>确认码无效或已过期</h1>`)
  ensureCreditAccount(user.id)
  audit(user.id, "device.approved", userCodeValue, req)
  return html(`<meta charset="utf-8"><h1>已批准，请返回终端</h1>`)
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

// ---------- 积分体系（账户 / 流水 / 扣减） ----------

// 1 积分 = 1 元人民币；模型成本以 USD 记账，按汇率换算为积分
const USD_CNY_RATE = Number(process.env.GYCCODE_USD_CNY_RATE ?? 7.2)
const toCredits = (usd: number) => Math.round(usd * USD_CNY_RATE * 100) / 100

type CreditAccount = {
  user_id: string
  plan_id: string
  balance: number
  monthly_quota: number
  monthly_used: number
  monthly_reset_at: number
}

// 读取积分账户；跨月自动重置套餐额度（懒重置，避免定时任务）
function getCreditAccount(userId: string): CreditAccount {
  ensureCreditAccount(userId)
  const now = Date.now()
  const acc = db.prepare("SELECT * FROM credit_accounts WHERE user_id = ?").get(userId) as CreditAccount
  if (acc.monthly_reset_at <= now) {
    const plan = db.prepare("SELECT monthly_credits FROM plans WHERE id = ?").get(acc.plan_id) as
      | { monthly_credits: number }
      | undefined
    const quota = plan?.monthly_credits ?? 0
    const resetAt = nextMonthReset()
    db.prepare("UPDATE credit_accounts SET monthly_quota = ?, monthly_used = 0, monthly_reset_at = ?, updated_at = ? WHERE user_id = ?").run(
      quota, resetAt, now, userId,
    )
    return { ...acc, monthly_quota: quota, monthly_used: 0, monthly_reset_at: resetAt }
  }
  return acc
}

// 扣减积分：先消耗套餐月度额度，再消耗积分余额（可透支为负，由客户端提示）
function chargeCredits(userId: string, credits: number, refId: string): { balance: number; monthlyUsed: number } {
  const acc = getCreditAccount(userId)
  const now = Date.now()
  const remainingQuota = Math.max(0, acc.monthly_quota - acc.monthly_used)
  const fromQuota = Math.min(remainingQuota, credits)
  const fromBalance = credits - fromQuota
  const nextUsed = Math.round((acc.monthly_used + fromQuota) * 100) / 100
  const nextBalance = Math.round((acc.balance - fromBalance) * 100) / 100
  db.prepare("UPDATE credit_accounts SET monthly_used = ?, balance = ?, updated_at = ? WHERE user_id = ?").run(
    nextUsed, nextBalance, now, userId,
  )
  db.prepare(
    "INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_id, created_at) VALUES (?, ?, ?, 'usage', ?, ?)",
  ).run(userId, -credits, nextBalance, refId, now)
  return { balance: nextBalance, monthlyUsed: nextUsed }
}

// 增加积分（充值 / 套餐发放 / 管理员调整）
function addCredits(userId: string, amount: number, reason: string, refId: string): number {
  getCreditAccount(userId)
  const now = Date.now()
  db.prepare("UPDATE credit_accounts SET balance = ROUND(balance + ?, 2), updated_at = ? WHERE user_id = ?").run(
    amount, now, userId,
  )
  const acc = db.prepare("SELECT balance FROM credit_accounts WHERE user_id = ?").get(userId) as { balance: number }
  db.prepare("INSERT INTO credit_ledger (user_id, delta, balance_after, reason, ref_id, created_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    userId, amount, acc.balance, reason, refId, now,
  )
  return acc.balance
}

// 管理员鉴权（等保三级：访问控制）
function requireAdmin(token: string | undefined): { user_id: string; org_id: string } | undefined {
  const auth = resolveToken(token)
  if (!auth) return undefined
  const me = db.prepare("SELECT role FROM users WHERE id = ?").get(auth.user_id) as { role: string } | undefined
  return me?.role === "admin" ? auth : undefined
}

function handleUsage(token: string | undefined): Response {
  const auth = resolveToken(token)
  if (!auth) return json(new Response(), 401, { error: "unauthorized" })
  const acc = getCreditAccount(auth.user_id)
  const plan = db.prepare("SELECT id, name, monthly_credits, price_cny FROM plans WHERE id = ?").get(acc.plan_id) as
    | { id: string; name: string; monthly_credits: number; price_cny: number }
    | undefined
  return json(new Response(), 200, {
    balance: acc.balance,
    plan: acc.plan_id,
    planName: plan?.name ?? acc.plan_id,
    monthlyQuota: acc.monthly_quota,
    monthlyUsed: acc.monthly_used,
    resetAt: acc.monthly_reset_at,
    utilization: acc.monthly_quota > 0 ? Math.round((acc.monthly_used / acc.monthly_quota) * 10000) / 10000 : 0,
  })
}

// 用量上报：幂等（user_id + session_id + step_id 唯一），触发积分扣减
function handleUsageReport(token: string | undefined, body: Record<string, unknown>, req: Request): Response {
  const auth = resolveToken(token)
  if (!auth) return json(new Response(), 401, { error: "unauthorized" })

  const sessionId = String(body.session_id ?? "").trim()
  const stepId = String(body.step_id ?? "").trim()
  const modelId = String(body.model_id ?? "").trim()
  if (!sessionId || !stepId || !modelId) {
    return json(new Response(), 400, { error: "invalid_report", error_description: "session_id / step_id / model_id 必填" })
  }
  const num = (v: unknown) => {
    const n = Number(v ?? 0)
    return Number.isFinite(n) && n >= 0 ? n : 0
  }
  const tokensInput = Math.floor(num(body.tokens_input))
  const tokensOutput = Math.floor(num(body.tokens_output))
  const tokensCacheRead = Math.floor(num(body.tokens_cache_read))
  const tokensCacheWrite = Math.floor(num(body.tokens_cache_write))
  const costUsd = num(body.cost_usd)
  const credits = toCredits(costUsd)

  const info = db
    .prepare(
      "INSERT OR IGNORE INTO usage_reports (user_id, session_id, step_id, model_id, tokens_input, tokens_output, tokens_cache_read, tokens_cache_write, cost_usd, credits_charged, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(auth.user_id, sessionId, stepId, modelId, tokensInput, tokensOutput, tokensCacheRead, tokensCacheWrite, costUsd, credits, Date.now())

  // 重复上报：不重复扣减，返回当前账户
  if (info.changes === 0) {
    const acc = getCreditAccount(auth.user_id)
    return json(new Response(), 200, { duplicate: true, balance: acc.balance, monthlyUsed: acc.monthly_used, charged: 0 })
  }

  const charged = chargeCredits(auth.user_id, credits, `${sessionId}:${stepId}`)
  audit(auth.user_id, "usage.report", `${sessionId}:${stepId}:${modelId}:${credits}`, req)
  return json(new Response(), 200, {
    duplicate: false,
    balance: charged.balance,
    monthlyUsed: charged.monthlyUsed,
    charged: credits,
  })
}

function handlePlans(): Response {
  const rows = db.prepare("SELECT id, name, monthly_credits, price_cny FROM plans ORDER BY price_cny ASC").all()
  return json(new Response(), 200, rows)
}

// 套餐/充值说明页：自建服务无支付牌照，充值由管理员线下核销后录入，不接在线支付
function handlePlansPage(): Response {
  const rows = db.prepare("SELECT id, name, monthly_credits, price_cny FROM plans ORDER BY price_cny ASC").all() as {
    id: string
    name: string
    monthly_credits: number
    price_cny: number
  }[]
  const items = rows
    .map(
      (p) => `<tr><td>${esc(p.name)}</td><td>${p.monthly_credits} 积分/月</td><td>${p.price_cny === 0 ? "免费" : "¥" + p.price_cny + "/月"}</td></tr>`,
    )
    .join("")
  return html(`<!doctype html>
<meta charset="utf-8"><title>套餐与充值</title>
<style>body{font-family:system-ui;max-width:720px;margin:60px auto;line-height:1.8;padding:0 20px}table{border-collapse:collapse;width:100%;margin:20px 0}th,td{border:1px solid #ddd;padding:10px;text-align:left}th{background:#f6f6f6}code{background:#f2f2f2;padding:2px 6px;border-radius:4px}</style>
<h1>gyc-code 套餐与充值</h1>
<p>1 积分 = 1 元人民币。套餐月度额度用尽后，从积分余额继续扣减。</p>
<table><thead><tr><th>套餐</th><th>月度额度</th><th>价格</th></tr></thead><tbody>${items}</tbody></table>
<h2>如何充值</h2>
<p>本服务为自建私有部署，<strong>不提供在线支付</strong>（无支付牌照）。请按以下方式充值：</p>
<ol>
  <li>联系管理员说明需要充值的积分数量；</li>
  <li>管理员线下完成收款后，通过管理接口为你的账号入账：<br>
      <code>POST /api/admin/recharge {"{"}"user_id": "你的用户 ID", "amount": 充值积分数{"}"}</code></li>
  <li>入账后执行 <code>gyc account balance</code> 查看余额。</li>
</ol>
<p>如需变更套餐，管理员使用 <code>POST /api/admin/plan</code>。</p>`)
}

function handleAdminRecharge(token: string | undefined, body: Record<string, unknown>, req: Request): Response {
  const admin = requireAdmin(token)
  if (!admin) return json(new Response(), 403, { error: "forbidden" })
  const userId = String(body.user_id ?? "").trim()
  const amount = Number(body.amount ?? 0)
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1_000_000) {
    return json(new Response(), 400, { error: "invalid_amount", error_description: "充值积分必须为 0~1000000 之间的正数" })
  }
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(userId)) {
    return json(new Response(), 404, { error: "user_not_found" })
  }
  const balance = addCredits(userId, Math.round(amount * 100) / 100, "recharge", String(body.ref_id ?? ""))
  audit(admin.user_id, "credit.recharge", `${userId}:${amount}`, req)
  return json(new Response(), 200, { user_id: userId, balance })
}

function handleAdminPlan(token: string | undefined, body: Record<string, unknown>, req: Request): Response {
  const admin = requireAdmin(token)
  if (!admin) return json(new Response(), 403, { error: "forbidden" })
  const userId = String(body.user_id ?? "").trim()
  const planId = String(body.plan_id ?? "").trim()
  const plan = db.prepare("SELECT id, monthly_credits FROM plans WHERE id = ?").get(planId) as
    | { id: string; monthly_credits: number }
    | undefined
  if (!plan) return json(new Response(), 400, { error: "invalid_plan" })
  if (!db.prepare("SELECT id FROM users WHERE id = ?").get(userId)) {
    return json(new Response(), 404, { error: "user_not_found" })
  }
  getCreditAccount(userId)
  db.prepare("UPDATE credit_accounts SET plan_id = ?, monthly_quota = ?, updated_at = ? WHERE user_id = ?").run(
    planId, plan.monthly_credits, Date.now(), userId,
  )
  audit(admin.user_id, "credit.plan_change", `${userId}:${planId}`, req)
  return json(new Response(), 200, { user_id: userId, plan: planId, monthlyQuota: plan.monthly_credits })
}

function handleAdminCredits(token: string | undefined): Response {
  const admin = requireAdmin(token)
  if (!admin) return json(new Response(), 403, { error: "forbidden" })
  const rows = db
    .prepare(
      "SELECT a.user_id, u.email, a.plan_id, a.balance, a.monthly_quota, a.monthly_used, a.monthly_reset_at FROM credit_accounts a LEFT JOIN users u ON u.id = a.user_id ORDER BY a.updated_at DESC LIMIT 200",
    )
    .all()
  return json(new Response(), 200, rows)
}

function handleAdminLedger(token: string | undefined, url: URL): Response {
  const admin = requireAdmin(token)
  if (!admin) return json(new Response(), 403, { error: "forbidden" })
  const userId = url.searchParams.get("user_id")
  const rows = userId
    ? db.prepare("SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY id DESC LIMIT 200").all(userId)
    : db.prepare("SELECT * FROM credit_ledger ORDER BY id DESC LIMIT 200").all()
  return json(new Response(), 200, rows)
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
      return handleConfirmPost(body, req)
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

    // 积分体系
    if (path === "/api/usage" && req.method === "GET") return handleUsage(token)
    if (path === "/api/usage/report" && req.method === "POST") return handleUsageReport(token, await readBody(req), req)
    if (path === "/api/plans" && req.method === "GET") return handlePlans()
    if (path === "/plans" && req.method === "GET") return handlePlansPage()

    // 管理 API（admin 专属）
    if (path === "/api/admin/recharge" && req.method === "POST") return handleAdminRecharge(token, await readBody(req), req)
    if (path === "/api/admin/plan" && req.method === "POST") return handleAdminPlan(token, await readBody(req), req)
    if (path === "/api/admin/credits" && req.method === "GET") return handleAdminCredits(token)
    if (path === "/api/admin/ledger" && req.method === "GET") return handleAdminLedger(token, url)

    return json(new Response(), 404, { error: "not_found" })
  },
})

console.log(`[gyc-code 账号服务] 运行于 ${BASE}（GYCCODE_ACCOUNT_URL 指向此地址）`)
console.log(`  默认账号: ${seedUser.email} / 组织: ${seedOrg.name}`)
console.log(`  Ctrl+C 停止`)
