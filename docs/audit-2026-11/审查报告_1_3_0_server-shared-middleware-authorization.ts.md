# 问题1：与实例级授权中间件重复实现 1级
## 问题1分析:
`src/gyccode/server/shared/middleware/authorization.ts` 与 `src/gyccode/server/routes/instance/httpapi/middleware/authorization.ts` 实现近乎相同的授权逻辑（凭证提取、Basic 解码、PTY 票据绕过、授权校验）。两文件仅在错误类型（`UnauthorizedError` vs `HttpApiError.Unauthorized`）与导出方式上不同。维护两套同构代码极易导致安全修复遗漏、行为不一致。

### 问题1修复后的代码：
```diff
-// 删除此文件，统一使用 @gyccode/server/routes/instance/httpapi/middleware/authorization
-// 或提取公共核心至 @gyccode/server/auth/middleware.ts
+// 保留此文件仅作薄导出层：
+export { authorizationLayer, ptyConnectAuthorizationLayer } from "@/server/routes/instance/httpapi/middleware/authorization"
+export { Authorization as ServerAuthorization, authorizationLayer as serverAuthorizationLayer } from "@/server/routes/instance/httpapi/middleware/authorization"
```
将共享层降级为纯再导出，核心逻辑单一来源。

---

# 问题2：硬编码基础 URL 导致路径解析异常 2级
## 问题2分析:
第 30、55 行 `new URL(request.url, "http://localhost")` 同前文问题。反向代理/负载均衡重写 Host、路径前缀时，`pathname`/`searchParams` 解析错误，导致：
- PTY 票据匹配失败 (`hasPtyConnectTicketURL`)
- WebSocket `auth_token` 提取失败
- 公共路径判断失效（若复用 `isPublicUIPath`）

### 问题2修复后的代码：
```diff
-function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
-  const url = new URL(request.url, "http://localhost")
+function parseRequestURL(request: HttpServerRequest.HttpServerRequest): URL {
+  const base = `http://${request.headers.host ?? "localhost"}`
+  return new URL(request.url, base)
+}
+
+function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
+  const url = parseRequestURL(request)
```

---

# 问题3：PTY 连接票据绕过授权无有效期/一次性校验 2级
## 问题3分析:
第 55 行 `hasPtyConnectTicketURL(...)` 为真直接放行 (`return yield* effect`)，完全跳过凭证校验。票据若泄露（日志、Referer、历史记录），攻击者可无凭证建立 PTY 连接。需验证：
- 单次使用（消费后失效）
- 短期有效期（如 30 秒）
- 绑定目标实例/会话/用户

### 问题3修复后的代码：
```diff
-        if (hasPtyConnectTicketURL(new URL(request.url, "http://localhost"))) return yield* effect
+        const url = parseRequestURL(request)
+        if (hasPtyConnectTicketURL(url)) {
+          const valid = yield* PtyTicketService.validateAndConsume(url)
+          if (valid) return yield* effect
+        }
```

---

# 问题4：Base64 解码失败静默返回空凭证 2级
## 问题4分析:
第 19 行 `onFailure: emptyCredential`，解码失败（恶意构造、截断、非标准编码）直接返回空凭证，随后 `authorized` 拒绝。但：
- 未记录解码失败日志，无法检测探测/攻击
- 空凭证与"无凭证"语义相同，审计无法区分

### 问题4修复后的代码：
```diff
 function decodeCredential(input: string) {
   return Effect.fromResult(Encoding.decodeBase64String(input)).pipe(
     Effect.match({
-      onFailure: emptyCredential,
+      onFailure: (cause) =>
+        Effect.gen(function* () {
+          yield* Effect.logWarning("Auth credential base64 decode failed", { cause })
+          return emptyCredential()
+        }),
       onSuccess: (header) => {
         const separator = header.indexOf(":")
         if (separator === -1) return emptyCredential()
         return { username: header.slice(0, separator), password: Redacted.make(header.slice(separator + 1)) }
       },
     }),
   )
 }
```

---

# 问题5：缺乏认证频率限制 2级
## 问题5分析:
`authorizationLayer` 无任何频率限制、失败计数、账户锁定、IP 封禁机制。暴力破解可无限重试。等保三级要求登录失败处理（锁定/延迟/告警）。

### 问题5修复后的代码：
```diff
 export const authorizationLayer = Layer.effect(
   Authorization,
   Effect.gen(function* () {
     const config = yield* ServerAuth.Config
+    const limiter = yield* RateLimiter
     if (!ServerAuth.required(config)) return Authorization.of((effect) => effect)
     return Authorization.of((effect) =>
       Effect.gen(function* () {
         const request = yield* HttpServerRequest.HttpServerRequest
+        const clientIp = request.headers["x-forwarded-for"] ?? request.headers["x-real-ip"] ?? "unknown"
+        const authKey = `auth:${clientIp}`
         if (hasPtyConnectTicketURL(new URL(request.url, "http://localhost"))) return yield* effect
         const credential = yield* credentialFromRequest(request)
-        if (ServerAuth.authorized(credential, config)) return yield* effect
+        if (yield* limiter.isBlocked(authKey)) return yield* new UnauthorizedError({ message: "Too many attempts" })
+        const ok = ServerAuth.authorized(credential, config)
+        if (ok) { yield* limiter.reset(authKey); return yield* effect }
+        yield* limiter.recordFailure(authKey)
         yield* HttpEffect.appendPreResponseHandler((_request, response) =>
           Effect.succeed(HttpServerResponse.setHeader(response, "www-authenticate", WWW_AUTHENTICATE)),
         )
         return yield* new UnauthorizedError({ message: "Authentication required" })
       }),
     )
   }),
 )
```
需引入 `RateLimiter` 服务（滑动窗口/令牌桶）。