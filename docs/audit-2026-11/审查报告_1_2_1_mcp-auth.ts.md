# 问题1：refreshAccessToken 为裸 async 函数，破坏 Effect 组合性 1级
## 问题1分析:
第 49-91 行 `refreshAccessToken` 使用 `async/await` 返回 `Promise`，而非 `Effect.Effect`。导致：
- 无法接入 Effect 超时、重试、中断、并发控制
- 错误通道为 `unknown`，非类型化 `TokenRefreshError`
- 调用方必须 `Effect.tryPromise` 包装，丢失堆栈与可观测性

### 问题1修复后的代码：
```diff
-import { Effect, Schema } from "effect"
+import { Effect, Schema, Duration, Schedule } from "effect"
 
-export async function refreshAccessToken(
-  token: OAuthTokenState,
-  tokenEndpoint: string,
-  clientId: string,
-): Promise<TokenRefreshResult> {
+export const refreshAccessToken = Effect.fn("McpAuth.refreshAccessToken")(
+  function* (token: OAuthTokenState, tokenEndpoint: string, clientId: string) {
+    if (!token.refreshToken) return yield* Effect.fail(new TokenRefreshError("No refresh token available", undefined, "no_refresh_token"))
+
+    const response = yield* Effect.tryPromise({
+      try: () => fetch(tokenEndpoint, {
+        method: "POST",
+        headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
+        body: new URLSearchParams({
+          grant_type: "refresh_token",
+          client_id: clientId,
+          refresh_token: token.refreshToken,
+        }),
+        // 10s 硬超时，防挂死
+        signal: AbortSignal.timeout(10_000),
+      }),
+      catch: (error) => new TokenRefreshError(`Token refresh network failure: ${error}`, undefined, "network_error"),
+    })
+
+    if (!response.ok) {
+      const description = yield* Effect.tryPromise({ try: () => refreshErrorDescription(response), catch: () => response.statusText })
+      if (response.status === 400 && description.includes("invalid_grant")) {
+        return yield* Effect.fail(new TokenRefreshError(`Invalid refresh token: ${description}`, response.status, "invalid_grant"))
+      }
+      return yield* Effect.fail(new TokenRefreshError(`Token refresh failed: ${description}`, response.status, "http_error"))
+    }
+
+    const body = yield* Effect.tryPromise({
+      try: () => response.json() as Promise<Record<string, unknown>>,
+      catch: () => new TokenRefreshError("Token refresh response not JSON", response.status, "invalid_response"),
+    })
+    if (typeof body.access_token !== "string") {
+      return yield* Effect.fail(new TokenRefreshError("Token refresh response missing access_token", response.status, "invalid_response"))
+    }
+    return {
+      accessToken: body.access_token,
+      refreshToken: typeof body.refresh_token === "string" ? body.refresh_token : token.refreshToken,
+      expiresIn: typeof body.expires_in === "number" ? body.expires_in : 3600,
+    }
+  },
+)
+
+// 可选：自动重试策略（指数退避，最多 3 次，仅网络错误/5xx）
+export const refreshAccessTokenWithRetry = (token: OAuthTokenState, tokenEndpoint: string, clientId: string) =>
+  refreshAccessToken(token, tokenEndpoint, clientId).pipe(
+    Effect.retry(Schedule.exponential("1s").pipe(Schedule.recurs(3), Schedule.filter((e) =>
+      e._tag === "Fail" && (e.cause._tag === "TimeoutError" || (e.cause as any).status >= 500)
+    ))),
+  )
```

---

# 问题2：token 过期/刷新缓冲硬编码 2级
## 问题2分析:
第 21-30 行 `isTokenExpired` (1min)、`shouldRefreshToken` (5min) 硬编码缓冲。不同 OAuth 提供商 token 有效期差异大（5min~24h），固定缓冲要么过早刷新（增发请求），要么过晚导致 401。应可配置或按 `expiresIn` 比例计算。

### 问题2修复后的代码：
```diff
-export function isTokenExpired(token: OAuthTokenState): boolean {
-  if (!token.expiresAt) return false
-  return Date.now() > token.expiresAt - 60_000 // 1 minute buffer
-}
-
-export function shouldRefreshToken(token: OAuthTokenState): boolean {
-  if (!token.refreshToken) return false
-  if (!token.expiresAt) return false
-  return Date.now() > token.expiresAt - 300_000 // 5 minute buffer
-}
+export function isTokenExpired(token: OAuthTokenState, bufferMs = 60_000): boolean {
+  if (!token.expiresAt) return false
+  return Date.now() > token.expiresAt - bufferMs
+}
+
+export function shouldRefreshToken(token: OAuthTokenState, bufferMs = 300_000): boolean {
+  if (!token.refreshToken) return false
+  if (!token.expiresAt) return false
+  return Date.now() > token.expiresAt - bufferMs
+}
```
调用处传入动态缓冲（如 `expiresIn * 0.1` 或配置项）。

---

# 问题3：updateField 创建条目时缺失必填字段校验 2级
## 问题3分析:
第 292 行 `const entry = data[mcpName] ?? {}` 若条目不存在则新建空对象，随后直接赋值 `entry[field] = value`。但 `Entry` schema 要求 `tokens`、`clientInfo` 等字段在特定操作时必须存在（如 `set` 需完整 entry）。直接写单字段可能产生不完整条目，后续读取解码失败。

### 问题3修复后的代码：
```diff
     const updateField = <K extends keyof Entry>(field: K, spanName: string) =>
       Effect.fn(`McpAuth.${spanName}`)(function* (mcpName: string, value: NonNullable<Entry[K]>, serverUrl?: string) {
         yield* mutate((data) => {
           const entry = data[mcpName] ?? ({} as Entry)
+          // 仅允许更新已存在条目；创建新条目走 set()
+          if (!(mcpName in data)) {
+            yield* Effect.logWarning("McpAuth.updateField: entry not found, use set() instead", { mcpName })
+            return undefined
+          }
           entry[field] = value
           if (serverUrl) entry.serverUrl = serverUrl
           return { ...data, [mcpName]: entry }
         })
       })
```

---

# 问题4：getForUrl 严格匹配 serverUrl 阻碍迁移/负载均衡 2级
## 问题4分析:
第 269-270 行 `if (!entry.serverUrl) return undefined; if (entry.serverUrl !== serverUrl) return undefined` 要求精确匹配。若 MCP 服务器迁移域名、走反向代理、DNS 轮询返回不同 IP，现有凭据将失效，强制用户重新认证。应支持前缀匹配或可配置匹配策略。

### 问题4修复后的代码：
```diff
     const getForUrl = Effect.fn("McpAuth.getForUrl")(function* (mcpName: string, serverUrl: string) {
       const entry = yield* get(mcpName)
       if (!entry) return undefined
       if (!entry.serverUrl) return undefined
-      if (entry.serverUrl !== serverUrl) return undefined
+      // 允许同源（协议+主机+端口）或配置的前缀匹配
+      const entryUrl = new URL(entry.serverUrl)
+      const targetUrl = new URL(serverUrl)
+      if (entryUrl.origin !== targetUrl.origin) {
+        // 可选：检查配置的 allowedOrigins
+        return undefined
+      }
       return entry
     })
```

---

# 问题5：文件锁键仅含路径，多实例共享数据目录时冲突 2级
## 问题5分析:
第 127 行 `const lockKey = \`mcp-auth:${filepath}\`` 仅含文件路径。若多 gyc-code 实例共享同一 `Global.Path.data`（如容器挂载同卷、多用户同机），文件锁键相同导致跨实例互斥或死锁。应包含实例 ID/进程标识。

### 问题5修复后的代码：
```diff
-const lockKey = `mcp-auth:${filepath}`
+const lockKey = `mcp-auth:${filepath}:${process.pid}:${Global.instanceId ?? "unknown"}`
```
需在 `Global` 暴露 `instanceId`（启动时生成 UUID）。