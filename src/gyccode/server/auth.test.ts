// server/auth.ts 回归测试（等保三级 · 身份鉴别）
// 本模块是 HTTP 层的身份鉴别底座：required 决定是否启用鉴权，
// authorized 做恒定时间口令比对，header 生成凭据。
// 此前 0 测试，任何改动都可能静默放开鉴权。
import { describe, expect, test } from "bun:test"
import { Effect, Option, Redacted } from "effect"
import { ServerAuth } from "./auth"

/** 构造 Config.Info：password 为 Some/None，username 有默认值。 */
function config(options: { password?: string; username?: string }): ServerAuth.Info {
  return {
    password: options.password === undefined ? Option.none() : Option.some(options.password),
    username: options.username ?? "gyccode",
  }
}

function credentials(username: string, password: string) {
  return { username, password: Redacted.make(password) }
}

describe("ServerAuth.required", () => {
  test("未设置口令时不要求鉴权", () => {
    expect(ServerAuth.required(config({}))).toBe(false)
  })

  test("口令为空字符串等同未设置", () => {
    // 空口令若被当成有效，任何人可用空口令登录
    expect(ServerAuth.required(config({ password: "" }))).toBe(false)
  })

  test("设置了非空口令则要求鉴权", () => {
    expect(ServerAuth.required(config({ password: "s3cret" }))).toBe(true)
  })
})

describe("ServerAuth.authorized", () => {
  const withPassword = config({ password: "correct-horse" })

  test("用户名与口令都正确时放行", () => {
    expect(ServerAuth.authorized(credentials("gyccode", "correct-horse"), withPassword)).toBe(true)
  })

  test("自定义用户名下放行", () => {
    const cfg = config({ password: "pw", username: "alice" })
    expect(ServerAuth.authorized(credentials("alice", "pw"), cfg)).toBe(true)
  })

  test("口令错误时拒绝", () => {
    expect(ServerAuth.authorized(credentials("gyccode", "wrong"), withPassword)).toBe(false)
  })

  test("用户名错误时拒绝", () => {
    expect(ServerAuth.authorized(credentials("mallory", "correct-horse"), withPassword)).toBe(false)
  })

  test("大小写敏感：口令大小写不同即拒绝", () => {
    expect(ServerAuth.authorized(credentials("gyccode", "CORRECT-HORSE"), withPassword)).toBe(false)
  })

  test("未配置口令时一律拒绝（fail-closed）", () => {
    // 即使凭据非空也不能放行，否则 required=false 时会形成鉴权空洞
    expect(ServerAuth.authorized(credentials("gyccode", "anything"), config({}))).toBe(false)
  })

  test("空口令配置下一律拒绝", () => {
    expect(ServerAuth.authorized(credentials("gyccode", ""), config({ password: "" }))).toBe(false)
  })

  test("口令前缀/后缀不匹配均拒绝", () => {
    expect(ServerAuth.authorized(credentials("gyccode", "correct"), withPassword)).toBe(false)
    expect(ServerAuth.authorized(credentials("gyccode", "correct-horse-extra"), withPassword)).toBe(false)
  })

  test("口令超长不因长度不同而绕过（恒定时间比较的语义）", () => {
    expect(ServerAuth.authorized(credentials("gyccode", "x".repeat(100_000)), withPassword)).toBe(false)
  })
})

describe("ServerAuth.header", () => {
  /** header() 在无密码时返回 undefined，测试中先断言非空再取用。 */
  function headerOf(credentials: { username?: string; password?: string }) {
    const value = ServerAuth.header(credentials)
    if (value === undefined) throw new Error("expected a Basic header, got undefined")
    return value
  }

  test("用给定凭据生成 Basic 头", () => {
    const header = headerOf({ username: "alice", password: "pw" })
    expect(typeof header).toBe("string")
    expect(header.startsWith("Basic ")).toBe(true)
  })

  test("可被 authorized 正确回验（往返一致）", () => {
    const header = headerOf({ username: "alice", password: "pw" })
    const raw = header.slice("Basic ".length)
    const decoded = Buffer.from(raw, "base64").toString("utf8")
    const sep = decoded.indexOf(":")
    const cfg = config({ password: "pw", username: "alice" })
    expect(ServerAuth.authorized(credentials(decoded.slice(0, sep), decoded.slice(sep + 1)), cfg)).toBe(true)
  })

  test("口令含冒号时按首个冒号切分仍能回验", () => {
    // ":" 是 Basic 格式的分隔符，口令内含冒号是合法输入
    const header = headerOf({ username: "alice", password: "pa:ss:word" })
    const decoded = Buffer.from(header.slice("Basic ".length), "base64").toString("utf8")
    const sep = decoded.indexOf(":")
    const cfg = config({ password: "pa:ss:word", username: "alice" })
    expect(ServerAuth.authorized(credentials(decoded.slice(0, sep), decoded.slice(sep + 1)), cfg)).toBe(true)
  })
})

describe("恒定时间比较不引入副作用", () => {
  test("authorized 是纯函数（多次调用结果一致）", () => {
    const cfg = config({ password: "pw" })
    const results = Array.from({ length: 5 }, () => ServerAuth.authorized(credentials("gyccode", "pw"), cfg))
    expect(results.every((r) => r === results[0])).toBe(true)
    expect(results[0]).toBe(true)
  })
})
