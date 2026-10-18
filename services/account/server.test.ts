/**
 * 账号服务集成测试：设备码 / 登录 / 积分 / 套餐 / 权限
 *
 * 启动独立子进程 + 临时数据库，不污染 services/account/gyccode-account.db
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

const PORT = 18000 + Math.floor(Math.random() * 1000)
const BASE = `http://127.0.0.1:${PORT}`
const ADMIN_PASSWORD = "test-pass-123"
const dir = mkdtempSync(join(tmpdir(), "gyc-acct-"))
const DB = join(dir, "test.db")

let proc: ReturnType<typeof Bun.spawn> | undefined

async function waitHealth(timeoutMs = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${BASE}/health`)
      if (res.ok) return
    } catch {
      // 服务未就绪，继续轮询
    }
    await Bun.sleep(150)
  }
  throw new Error("账号服务启动超时")
}

async function api(path: string, init?: RequestInit & { token?: string }) {
  const headers: Record<string, string> = { "content-type": "application/json" }
  if (init?.token) headers.authorization = `Bearer ${init.token}`
  const res = await fetch(`${BASE}${path}`, { ...init, headers: { ...headers, ...(init?.headers as Record<string, string>) } })
  const text = await res.text()
  let body: unknown = text
  try {
    body = JSON.parse(text)
  } catch {
    // 非 JSON（HTML 页面）保留原文
  }
  return { status: res.status, body: body as Record<string, unknown> }
}

beforeAll(async () => {
  proc = Bun.spawn(["bun", "services/account/server.ts"], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      GYCCODE_ACCOUNT_PORT: String(PORT),
      GYCCODE_ACCOUNT_DB: DB,
      GYCCODE_ADMIN_PASSWORD: ADMIN_PASSWORD,
    },
    stdout: "ignore",
    stderr: "pipe",
  })
  await waitHealth()
}, 30000)

afterAll(async () => {
  proc?.kill()
  // Windows 下 SQLite 文件句柄释放有延迟，等进程真正退出再删临时目录
  await proc?.exited
  for (let i = 0; i < 10; i++) {
    try {
      rmSync(dir, { recursive: true, force: true })
      break
    } catch {
      await Bun.sleep(100)
    }
  }
})

describe("账号服务", () => {
  test("健康检查", async () => {
    const res = await api("/health")
    expect(res.status).toBe(200)
    expect(res.body.ok).toBe(true)
  })

  test("管理员登录成功并返回 token", async () => {
    const res = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    expect(res.status).toBe(200)
    expect(typeof res.body.access_token).toBe("string")
    expect(typeof res.body.refresh_token).toBe("string")
  })

  test("错误密码被拒绝且留下审计", async () => {
    const res = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: "wrong-pass-1" }),
    })
    expect(res.status).toBe(401)
    expect(res.body.error).toBe("invalid_credentials")
  })

  test("注册密码强度校验", async () => {
    const weak = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ email: "u1@example.com", name: "谷总", password: "12345678" }),
    })
    expect(weak.status).toBe(400)
    expect(weak.body.error).toBe("weak_password")

    const ok = await api("/api/register", {
      method: "POST",
      body: JSON.stringify({ email: "u1@example.com", name: "谷总", password: "abc12345" }),
    })
    expect(ok.status).toBe(201)
  })

  test("套餐列表含三档且按价格升序", async () => {
    const res = await api("/api/plans")
    expect(res.status).toBe(200)
    const plans = res.body as unknown as { id: string; name: string; monthly_credits: number; price_cny: number }[]
    expect(plans.map((p) => p.id)).toEqual(["free", "pro", "max"])
    expect(plans[0]!.price_cny).toBe(0)
    expect(plans[2]!.monthly_credits).toBeGreaterThan(plans[1]!.monthly_credits)
  })

  test("未登录查询用量返回 401", async () => {
    const res = await api("/api/usage")
    expect(res.status).toBe(401)
  })

  test("新用户初始为免费版、余额 0", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "u1@example.com", password: "abc12345" }),
    })
    const token = String(login.body.access_token)
    const res = await api("/api/usage", { token })
    expect(res.status).toBe(200)
    expect(res.body.plan).toBe("free")
    expect(res.body.balance).toBe(0)
    expect(res.body.monthlyQuota).toBe(0)
  })

  test("普通用户访问管理 API 返回 403", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "u1@example.com", password: "abc12345" }),
    })
    const token = String(login.body.access_token)
    const res = await api("/api/admin/recharge", {
      method: "POST",
      token,
      body: JSON.stringify({ user_id: "u_local", amount: 100 }),
    })
    expect(res.status).toBe(403)
  })

  test("管理员充值后余额增加且流水可查", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const token = String(login.body.access_token)

    const me = await api("/api/user", { token })
    const userId = String(me.body.id)

    const recharge = await api("/api/admin/recharge", {
      method: "POST",
      token,
      body: JSON.stringify({ user_id: userId, amount: 100 }),
    })
    expect(recharge.status).toBe(200)
    expect(recharge.body.balance).toBe(100)

    const usage = await api("/api/usage", { token })
    expect(usage.body.balance).toBe(100)

    const ledger = await api(`/api/admin/ledger?user_id=${userId}`, { token })
    expect(ledger.status).toBe(200)
    const rows = ledger.body as unknown as { delta: number; reason: string }[]
    expect(rows[0]!.delta).toBe(100)
    expect(rows[0]!.reason).toBe("recharge")
  })

  test("充值非法金额被拒绝", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const token = String(login.body.access_token)
    for (const amount of [0, -5, 1_000_001]) {
      const res = await api("/api/admin/recharge", {
        method: "POST",
        token,
        body: JSON.stringify({ user_id: "u_local", amount }),
      })
      expect(res.status).toBe(400)
    }
  })

  test("用量上报扣减积分且幂等", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const token = String(login.body.access_token)

    const before = await api("/api/usage", { token })
    const balanceBefore = Number(before.body.balance)

    const payload = {
      session_id: "ses_test_1",
      step_id: "step_1",
      model_id: "deepseek-v4-flash",
      tokens_input: 1000,
      tokens_output: 500,
      cost_usd: 0.01,
    }
    const first = await api("/api/usage/report", { method: "POST", token, body: JSON.stringify(payload) })
    expect(first.status).toBe(200)
    expect(first.body.duplicate).toBe(false)
    // 0.01 USD * 7.2 = 0.07 积分
    expect(first.body.charged).toBeCloseTo(0.07, 2)
    expect(Number(first.body.balance)).toBeCloseTo(balanceBefore - 0.07, 2)

    const second = await api("/api/usage/report", { method: "POST", token, body: JSON.stringify(payload) })
    expect(second.status).toBe(200)
    expect(second.body.duplicate).toBe(true)
    expect(second.body.charged).toBe(0)
    expect(Number(second.body.balance)).toBeCloseTo(balanceBefore - 0.07, 2)
  })

  test("用量上报缺字段被拒绝", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const token = String(login.body.access_token)
    const res = await api("/api/usage/report", {
      method: "POST",
      token,
      body: JSON.stringify({ session_id: "ses_x" }),
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_report")
  })

  test("管理员变更套餐后额度生效", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const token = String(login.body.access_token)
    const me = await api("/api/user", { token })
    const userId = String(me.body.id)

    const res = await api("/api/admin/plan", {
      method: "POST",
      token,
      body: JSON.stringify({ user_id: userId, plan_id: "pro" }),
    })
    expect(res.status).toBe(200)
    expect(res.body.monthlyQuota).toBe(500)

    const usage = await api("/api/usage", { token })
    expect(usage.body.plan).toBe("pro")
    expect(usage.body.monthlyQuota).toBe(500)
  })

  test("无效套餐被拒绝", async () => {
    const login = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const token = String(login.body.access_token)
    const res = await api("/api/admin/plan", {
      method: "POST",
      token,
      body: JSON.stringify({ user_id: "u_local", plan_id: "nope" }),
    })
    expect(res.status).toBe(400)
    expect(res.body.error).toBe("invalid_plan")
  })

  test("设备码确认页要求身份验证", async () => {
    const code = await api("/auth/device/code", { method: "POST", body: JSON.stringify({ client_id: "test-cli" }) })
    expect(code.status).toBe(200)
    const userCode = String(code.body.user_code)

    // 无凭据批准：应被拒绝（修复前的实现会直接批准为种子 admin）
    const noCreds = await fetch(`${BASE}/device/confirm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ user_code: userCode, approve: "yes" }).toString(),
    })
    const noCredsText = await noCreds.text()
    expect(noCredsText).toContain("请输入邮箱和密码")

    // 错误凭据：验证失败
    const badCreds = await fetch(`${BASE}/device/confirm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        user_code: userCode,
        approve: "yes",
        email: "admin@gyccode.local",
        password: "wrong-pass-1",
      }).toString(),
    })
    expect(await badCreds.text()).toContain("身份验证失败")

    // 正确凭据：批准成功，设备码换 token 可用
    const goodCreds = await fetch(`${BASE}/device/confirm`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        user_code: userCode,
        approve: "yes",
        email: "admin@gyccode.local",
        password: ADMIN_PASSWORD,
      }).toString(),
    })
    expect(await goodCreds.text()).toContain("已批准")

    const token = await api("/auth/device/token", {
      method: "POST",
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: String(code.body.device_code),
      }),
    })
    expect(token.status).toBe(200)
    expect(typeof token.body.access_token).toBe("string")
  })

  test("审计日志仅管理员可查且记录敏感操作", async () => {
    const admin = await api("/api/login", {
      method: "POST",
      body: JSON.stringify({ email: "admin@gyccode.local", password: ADMIN_PASSWORD }),
    })
    const res = await api("/api/audit", { token: String(admin.body.access_token) })
    expect(res.status).toBe(200)
    const rows = res.body as unknown as { action: string }[]
    const actions = rows.map((r) => r.action)
    expect(actions).toContain("user.login")
    expect(actions).toContain("credit.recharge")
    expect(actions).toContain("usage.report")
  })
})
