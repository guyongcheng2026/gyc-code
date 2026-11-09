# 问题1：两套授权中间件实现重复且不一致 1级
## 问题1分析:
文件存在两套并行的授权实现：
- `authorizationRouterMiddleware` (114-129行)：用于 `HttpRouter.middleware()`，调用 `validateRawCredential` 直接返回 `HttpServerResponse.empty` (105-110行)
- `authorizationLayer` (131-145行)：用于 `HttpApiMiddleware`，调用 `validateCredential` 通过 `HttpEffect.appendPreResponseHandler` 设置头 (48-50行)

两者逻辑重复，错误处理不一致：前者短路返回 Response 对象，后者抛出 `HttpApiError.Unauthorized`。维护成本高，易引入差异 Bug。

### 问题1修复后的代码：
```diff
-function validateRawCredential<A, E, R>(
-  effect: Effect.Effect<A, E, R>,
-  credential: ServerAuth.DecodedCredentials,
-  config: ServerAuth.Info,
-) {
-  if (!ServerAuth.required(config)) return effect
-  if (!ServerAuth.authorized(credential, config))
-    return Effect.succeed(
-      HttpServerResponse.empty({
-        status: UNAUTHORIZED,
-        headers: { "www-authenticate": WWW_AUTHENTICATE },
-      }),
-    )
-  return effect
-}
-
 export const authorizationRouterMiddleware = HttpRouter.middleware()(
   Effect.gen(function* () {
     const config = yield* ServerAuth.Config
     if (!ServerAuth.required(config)) return (effect) => effect
 
     return (effect) =>
       Effect.gen(function* () {
         const request = yield* HttpServerRequest.HttpServerRequest
         const url = new URL(request.url, "http://localhost")
         if (isPublicUIPath(request.method, url.pathname)) return yield* effect
         return yield* credentialFromURL(url, request).pipe(
-          Effect.flatMap((credential) => validateRawCredential(effect, credential, config)),
+          Effect.flatMap((credential) => validateCredential(effect, credential, config)),
         )
       })
   }),
 )
```

---

# 问题2：PTY 连接票据绕过授权无有效期校验 2级
## 问题2分析:
第 156 行 `hasPtyConnectTicketURL(url)` 若为真直接放行 (`return yield* effect`)，完全跳过凭证校验。若票据 URL 可被泄露（日志、Referer、浏览器历史），攻击者可无需凭证建立 PTY 连接。需验证票据：
- 单次使用（用后即焚）
- 短期有效期（如 30 秒）
- 绑定目标实例/会话

### 问题2修复后的代码：
```diff
 export const ptyConnectAuthorizationLayer = Layer.effect(
   PtyConnectAuthorization,
   Effect.gen(function* () {
     const config = yield* ServerAuth.Config
     if (!ServerAuth.required(config)) return PtyConnectAuthorization.of((effect) => effect)
     return PtyConnectAuthorization.of((effect) =>
       Effect.gen(function* () {
         const request = yield* HttpServerRequest.HttpServerRequest
         const url = new URL(request.url, "http://localhost")
-        if (hasPtyConnectTicketURL(url)) return yield* effect
+        if (hasPtyConnectTicketURL(url)) {
+          const valid = yield* PtyTicketService.validateAndConsume(url)
+          if (valid) return yield* effect
+        }
         return yield* credentialFromURL(url, request).pipe(
           Effect.flatMap((credential) => validateCredential(effect, credential, config)),
         )
       }),
     )
   }),
 )
```

---

# 问题3：硬编码基础 URL 导致路径解析异常 2级
## 问题3分析:
第 74、122、155 行均使用 `new URL(request.url, "http://localhost")`。`request.url` 可能为绝对路径（如 `/api/session`）或相对路径，`http://localhost` 作为 base 仅在路径以 `/` 开头时正确。若反向代理重写 Host/路径前缀，解析出的 `pathname`、`searchParams` 可能错误，导致：
- 公共路径判断失效 (`isPublicUIPath`)
- `auth_token` 提取失败
- PTY 票据匹配失败

### 问题3修复后的代码：
```diff
-function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
-  return credentialFromURL(new URL(request.url, "http://localhost"), request)
-}
-
-function credentialFromURL(url: URL, request: HttpServerRequest.HttpServerRequest) {
+function parseRequestURL(request: HttpServerRequest.HttpServerRequest): URL {
+  const base = `http://${request.headers.host ?? "localhost"}`
+  return new URL(request.url, base)
+}
+
+function credentialFromRequest(request: HttpServerRequest.HttpServerRequest) {
+  return credentialFromURL(parseRequestURL(request), request)
+}
+
+function credentialFromURL(url: URL, request: HttpServerRequest.HttpServerRequest) {
```

---

# 问题4：Base64 解码失败静默返回空凭证 2级
## 问题4分析:
第 59-60 行 `decodeCredential` 中 `onFailure: emptyCredential`，Base64 解码失败（恶意构造、截断、非标准编码）直接返回空凭证，随后 `authorized` 因空密码拒绝。但：
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
         return {
           username: header.slice(0, separator),
           password: Redacted.make(header.slice(separator + 1)),
         }
       },
     }),
   )
 }
```

---

# 问题5：缺乏对 Authorization 头大小写变体的防御 3级
## 问题5分析:
第 83 行 `/^Basic\s+(.+)$/i` 仅匹配 `Basic` 大小写不敏感，但 RFC 7235 允许认证方案为 token（如 `basic`、`BEARER` 等）。若客户端发送 `basic xxx`（小写），正则仍匹配；但若发送 `Basicxxx`（无空格）或多空格，可能解析异常。建议更严格解析。

### 问题5修复后的代码：
```diff
-const match = /^Basic\s+(.+)$/i.exec(request.headers.authorization ?? "")
+const authHeader = request.headers.authorization ?? ""
+const match = authHeader.match(/^Basic\s+(\S+)$/i)
 const encoded = match?.[1]
```
使用 `\S+` 避免尾部空格污染，且显式检查空格分隔。