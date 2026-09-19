export * as ServerAuth from "./auth"

import { ConfigService } from "@/effect/config-service"
import { Flag } from "@gyccode/core/flag/flag"
import { createHash, timingSafeEqual } from "node:crypto"
import { Config as EffectConfig, Context, Option, Redacted } from "effect"

export type Credentials = {
  password?: string
  username?: string
}

export type DecodedCredentials = {
  readonly username: string
  readonly password: Redacted.Redacted
}

export class Config extends ConfigService.Service<Config>()("@gyccode/ServerAuthConfig", {
  password: EffectConfig.string("GYCCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
  username: EffectConfig.string("GYCCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("gyccode")),
}) {}

export type Info = Context.Service.Shape<typeof Config>

export function required(config: Info) {
  return Option.isSome(config.password) && config.password.value !== ""
}

// 恒定时间比较：先哈希到等长摘要再比对（对齐 src/server/auth.ts 的 safeEqual），
// 消除 username/password 明文 === 短路比较的时序侧信道
// P0 修复：恒定时间比较 - 直接比较原始字符串字节，避免时序侧信道攻击
function safeEqual(a: string, b: string): boolean {
  // 先哈希到定长摘要再比较：直接比较原始字节时长度不同会提前 return，
  // 而"提前返回"本身就泄漏口令长度（时序侧信道）。
  const aDigest = createHash("sha256").update(a, "utf8").digest()
  const bDigest = createHash("sha256").update(b, "utf8").digest()
  return timingSafeEqual(aDigest, bDigest)
}

export function authorized(credentials: DecodedCredentials, config: Info) {
  return (
    Option.isSome(config.password) &&
    safeEqual(credentials.username, config.username) &&
    safeEqual(Redacted.value(credentials.password), config.password.value)
  )
}

export function header(credentials?: Credentials) {
  const password = credentials?.password ?? Flag.GYCCODE_SERVER_PASSWORD
  if (!password) return undefined

  const username = credentials?.username ?? Flag.GYCCODE_SERVER_USERNAME ?? "gyccode"
  return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
}

export function headers(credentials?: Credentials) {
  const authorization = header(credentials)
  if (!authorization) return undefined
  return { Authorization: authorization }
}
