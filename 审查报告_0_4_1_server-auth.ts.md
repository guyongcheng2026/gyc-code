# 问题1：用户名使用恒定时间比较非必要且泄露用户存在性 2级
## 问题1分析:
第 47 行 `safeEqual(credentials.username, config.username)` 对用户名也使用恒定时间比较。用户名非机密，攻击者可遍历用户名列表，通过时序差异判断用户是否存在（用户枚举）。且用户名比较短路无安全损失，恒定时间反而增加 CPU 开销。

### 问题1修复后的代码：
```diff
 export function authorized(credentials: DecodedCredentials, config: Info) {
   return (
     Option.isSome(config.password) &&
     config.password.value !== "" &&
-    safeEqual(credentials.username, config.username) &&
+    credentials.username === config.username &&
     safeEqual(Redacted.value(credentials.password), config.password.value)
   )
 }
```

---

# 问题2：配置中密码以明文 Redacted 外存储 2级
## 问题2分析:
第 19-20 行 `Config` 从环境变量读取密码，`config.password.value` 为明文 `string`（非 `Redacted`）。第 48 行 `config.password.value` 直接参与 `safeEqual`，内存中长期驻留明文口令。若进程转储/日志误打印配置对象，口令泄露。

### 问题2修复后的代码：
```diff
 export type Info = Context.Service.Shape<typeof Config>
 
+type RedactedPassword = Redacted.Redacted
+
 export function authorized(credentials: DecodedCredentials, config: Info) {
   return (
     Option.isSome(config.password) &&
     config.password.value !== "" &&
     credentials.username === config.username &&
-    safeEqual(Redacted.value(credentials.password), config.password.value)
+    safeEqual(Redacted.value(credentials.password), Redacted.value(config.password as unknown as RedactedPassword))
   )
 }
```
需同步修改 `Config` 定义将 `password` 类型改为 `Redacted`，或在 `authorized` 内部 `Redacted.make(config.password.value)` 后立即清零原字符串（需 `Buffer` 操作，JS 无法保证）。

---

# 问题3：缺乏认证频率限制与账户锁定 2级
## 问题3分析:
`authorized` 无任何频率限制、失败计数、账户锁定、IP 封禁机制。暴力破解可无限重试。等保三级要求登录失败处理（锁定/延迟/告警）。

### 问题3修复后的代码：
```diff
+import { RateLimiter } from "@/server/rate-limiter"
+
 export function authorized(credentials: DecodedCredentials, config: Info) {
+  const limiter = yield* RateLimiter
+  const key = `auth:${credentials.username}:${hashIp(requestIp)}`
+  if (yield* limiter.isBlocked(key)) {
+    yield* Effect.logWarning("Auth rate limited", { username: credentials.username })
+    return false
+  }
   const ok = (
     Option.isSome(config.password) &&
     config.password.value !== "" &&
     credentials.username === config.username &&
     safeEqual(Redacted.value(credentials.password), config.password.value)
   )
+  if (!ok) yield* limiter.recordFailure(key)
+  else yield* limiter.reset(key)
   return ok
 }
```
需引入 `RateLimiter` 服务（滑动窗口/令牌桶），并在 HTTP 中间件层获取客户端 IP。

---

# 问题4：Basic Auth 头构造回退到 Flag 常量 3级
## 问题4分析:
第 53、56 行 `header` 函数回退使用 `Flag.GYCCODE_SERVER_PASSWORD` / `Flag.GYCCODE_SERVER_USERNAME`。若调用方未显式传入凭据，可能误用全局默认值，导致非预期的认证头泄露或认证绕过。

### 问题4修复后的代码：
```diff
 export function header(credentials?: Credentials) {
-  const password = credentials?.password ?? Flag.GYCCODE_SERVER_PASSWORD
+  const password = credentials?.password
   if (!password) return undefined
 
-  const username = credentials?.username ?? Flag.GYCCODE_SERVER_USERNAME ?? "gyccode"
+  const username = credentials?.username ?? "gyccode"
   return `Basic ${Buffer.from(`${username}:${password}`).toString("base64")}`
 }
```
移除 Flag 回退，强制调用方显式传递，避免隐式依赖。

---

# 问题5：用户名默认值 "gyccode" 弱口令风险 3级
## 问题5分析:
第 20 行 `username: EffectConfig.string("GYCCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("gyccode"))` 默认用户名为 "gyccode"。配合弱密码或空密码（未设置 `GYCCODE_SERVER_PASSWORD` 时 `required()` 返回 false 但 `authorized` 仍可能被调用），扩大攻击面。

### 问题5修复后的代码：
```diff
 export class Config extends ConfigService.Service<Config>()("@gyccode/ServerAuthConfig", {
   password: EffectConfig.string("GYCCODE_SERVER_PASSWORD").pipe(EffectConfig.option),
-  username: EffectConfig.string("GYCCODE_SERVER_USERNAME").pipe(EffectConfig.withDefault("gyccode")),
+  username: EffectConfig.string("GYCCODE_SERVER_USERNAME").pipe(EffectConfig.option),
 }) {}
```
改为可选，无配置时 `authorized` 直接返回 false（fail-closed）。