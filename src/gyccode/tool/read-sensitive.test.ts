import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"
import {
  SENSITIVE_FILE_RULES,
  SENSITIVE_FILE_ALLOWLIST,
  evaluateSensitiveFile,
  buildSensitiveBlockedOutput,
  buildSensitiveBypassNotice,
} from "./read"

/**
 * R-3（对标指标 23 · 可靠性与安全）：`read('.env')` 之类凭据文件此前原样返回，
 * 模型看到密钥后极易把它写进日志、提交或后续对话。这里锁定屏蔽判定与文案。
 */

describe("evaluateSensitiveFile", () => {
  it("凭据文件判为敏感：.env / .env.local / server.pem / id_rsa", () => {
    expect(evaluateSensitiveFile("D:/repo/.env").blocked).toBe(true)
    expect(evaluateSensitiveFile("D:/repo/.env.local").blocked).toBe(true)
    expect(evaluateSensitiveFile("D:/repo/certs/server.pem").blocked).toBe(true)
    expect(evaluateSensitiveFile("C:/Users/x/.ssh/id_rsa").blocked).toBe(true)
  })

  it("其它密钥库/凭据文件同样判为敏感：.p12 / .key / credentials.json / .keystore", () => {
    expect(evaluateSensitiveFile("D:/repo/keystore.p12").blocked).toBe(true)
    expect(evaluateSensitiveFile("D:/repo/server.key").blocked).toBe(true)
    expect(evaluateSensitiveFile("D:/repo/credentials.json").blocked).toBe(true)
    expect(evaluateSensitiveFile("D:/repo/app.keystore").blocked).toBe(true)
  })

  it("样例模板与普通文件不敏感：.env.example / .env.sample / README.md", () => {
    expect(evaluateSensitiveFile("D:/repo/.env.example").blocked).toBe(false)
    expect(evaluateSensitiveFile("D:/repo/.env.sample").blocked).toBe(false)
    expect(evaluateSensitiveFile("D:/repo/README.md").blocked).toBe(false)
    expect(evaluateSensitiveFile("D:/repo/src/env.ts").blocked).toBe(false)
  })

  it("路径分隔符与大小写不影响判定（Windows 反斜杠同样命中）", () => {
    expect(evaluateSensitiveFile("C:\\repo\\.ENV").blocked).toBe(true)
    expect(evaluateSensitiveFile("C:\\repo\\.env.example").blocked).toBe(false)
  })

  it("公钥不是私钥：id_rsa.pub 不判为敏感", () => {
    expect(evaluateSensitiveFile("C:/Users/x/.ssh/id_rsa.pub").blocked).toBe(false)
  })

  it("敏感命中必须带出可展示的原因", () => {
    const verdict = evaluateSensitiveFile("D:/repo/.env")
    expect(verdict.blocked).toBe(true)
    expect(verdict.blocked && verdict.reason.length).toBeGreaterThan(0)
  })

  it("清单与放行名单均为导出常量，便于测试与后续扩展", () => {
    expect(SENSITIVE_FILE_RULES.length).toBeGreaterThan(0)
    expect(SENSITIVE_FILE_ALLOWLIST).toContain(".env.example")
    expect(SENSITIVE_FILE_ALLOWLIST).toContain(".env.sample")
    expect(SENSITIVE_FILE_ALLOWLIST).toContain(".env.template")
    for (const rule of SENSITIVE_FILE_RULES) expect(rule.reason.length).toBeGreaterThan(0)
  })
})

describe("buildSensitiveBlockedOutput", () => {
  const output = buildSensitiveBlockedOutput({ filepath: "D:/repo/.env", reason: "环境变量凭据文件" })

  it("包含文件路径", () => {
    expect(output).toContain("D:/repo/.env")
  })

  it("包含被屏蔽的原因", () => {
    expect(output).toContain("环境变量凭据文件")
  })

  it("包含「不要绕过、需要凭据请让用户提供」的提示", () => {
    expect(output).toContain("不要尝试绕过")
    expect(output).toContain("让用户提供")
  })

  it("提示显式放行参数存在，但不得伪装成已读内容", () => {
    expect(output).toContain("allow_sensitive")
    expect(output).not.toContain("<content>")
  })
})

describe("buildSensitiveBypassNotice", () => {
  it("显式放行时同样在输出里注明本次是显式放行", () => {
    const notice = buildSensitiveBypassNotice({ filepath: "D:/repo/.env", reason: "环境变量凭据文件" })
    expect(notice).toContain("D:/repo/.env")
    expect(notice).toContain("显式放行")
  })
})

describe("read.ts 接线（源码文本断言，非行为断言）", () => {
  const source = readFileSync(join(import.meta.dir, "read.ts"), "utf-8")

  it("Parameters 暴露 allow_sensitive 开关", () => {
    expect(source).toContain("allow_sensitive")
  })

  it("执行路径调用了纯函数判定与屏蔽文案", () => {
    expect(source).toContain("evaluateSensitiveFile(")
    expect(source).toContain("buildSensitiveBlockedOutput(")
    expect(source).toContain("buildSensitiveBypassNotice(")
  })
})