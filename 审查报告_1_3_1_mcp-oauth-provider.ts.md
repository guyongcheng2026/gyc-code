# 问题1：全链路使用 `await Effect.runPromise()` 破坏 Effect 组合性 1级
## 问题1分析:
第 66、99、141、153、170、183、219 行等均在 `async` 方法中调用 `await Effect.runPromise(...)`。每次调用都会创建新的 Effect 运行时，导致：
- 无法复用运行时资源（层、服务、中断信号）
- 超时、重试、中断、并发控制全部失效
- 堆栈丢失，可观测性断裂
- 性能开销大（每次启动运行时）

实现 `OAuthClientProvider` 接口时，应在构造时捕获 `Runtime<McpAuth.Interface>`，后续方法用 `Effect.runPromise(runtime)(effect)` 复用同一运行时。

### 问题1修复后的代码：
```diff
 import { Effect, Runtime, Layer } from "effect"
 import { McpAuth } from "./auth"
 
 export class McpOAuthProvider implements OAuthClientProvider {
   private readonly runtime: Runtime.Runtime<McpAuth.Interface>
 
   constructor(
     protected mcpName: string,
     protected serverUrl: string,
     protected config: McpOAuthConfig,
     private callbacks: McpOAuthCallbacks,
     protected auth: McpAuth.Interface,
   ) {
-    // 无运行时捕获
+    this.runtime = Runtime.defaultRuntime // 或注入 Layer 提供的 Runtime
   }
 
-  async clientInformation(): Promise<OAuthClientInformation | undefined> {
-    const entry = await Effect.runPromise(this.auth.getForUrl(this.mcpName, this.serverUrl))
+  async clientInformation(): Promise<OAuthClientInformation | undefined> {
+    const entry = await Effect.runPromise(this.runtime)(this.auth.getForUrl(this.mcpName, this.serverUrl))
     ...
   }
 
-  async tokens(): Promise<OAuthTokens | undefined> {
-    const entry = await Effect.runPromise(this.auth.getForUrl(this.mcpName, this.serverUrl))
+  async tokens(): Promise<OAuthTokens | undefined> {
+    const entry = await Effect.runPromise(this.runtime)(this.auth.getForUrl(this.mcpName, this.serverUrl))
     ...
   }
 
-  async saveTokens(tokens: OAuthTokens): Promise<void> {
-    await Effect.runPromise(this.auth.updateTokens(...))
+  async saveTokens(tokens: OAuthTokens): Promise<void> {
+    await Effect.runPromise(this.runtime)(this.auth.updateTokens(...))
     ...
   }
   // 其余方法同理
 }
```
更佳：将接口改为返回 `Effect.Effect`，由上层统一 `runPromise`，但受限于 MCP SDK 接口定义，妥协方案是复用单一 `Runtime`。

---

# 问题2：clientSecretExpiresAt 与 expiresAt 单位混淆（秒 vs 毫秒） 1级
## 问题2分析:
第 69 行 `entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000` 与第 106-108 行 `entry.tokens.expiresAt - Date.now() / 1000`：
- `clientSecretExpiresAt` 来自 OAuth 动态注册响应 `client_secret_expires_at`，规范为 **Unix 时间戳（秒）**
- `tokens.expiresAt` 在 `saveTokens` 第 120 行存储为 `Date.now() / 1000 + tokens.expires_in`，**也是秒**
- 但 `Date.now()` 返回 **毫秒**，除以 1000 后为秒，比较单位一致（秒 vs 秒）看似正确
- **实际 Bug**：第 107 行 `Math.floor(entry.tokens.expiresAt - Date.now() / 1000)` 结果为**秒**，但 OAuth SDK 期望 `expires_in` 为**秒**——此处正确
- **真实风险**：第 69 行若 `clientSecretExpiresAt` 为 0（永不过期），`0 < now/1000` 为真，误判为过期。规范：0 表示永不过期。

### 问题2修复后的代码：
```diff
     // Check if client secret has expired
-    if (entry.clientInfo.clientSecretExpiresAt && entry.clientInfo.clientSecretExpiresAt < Date.now() / 1000) {
+    const expiresAt = entry.clientInfo.clientSecretExpiresAt
+    if (expiresAt && expiresAt > 0 && expiresAt < Date.now() / 1000) {
       return undefined
     }
```

---

# 问题3：redirectToAuthorization 缺失授权服务器验证，存在开放重定向风险 2级
## 问题3分析:
第 128-134 行 `redirectToAuthorization` 仅校验协议为 http/https，**不校验 `authorizationUrl` 是否为预期的授权服务器域名**。恶意 MCP 服务器可返回 `https://attacker.com/phish?redirect=...`，用户点击后泄露授权码。

### 问题3修复后的代码：
```diff
   async redirectToAuthorization(authorizationUrl: URL): Promise<void> {
     if (authorizationUrl.protocol !== "http:" && authorizationUrl.protocol !== "https:")
       throw new Error(`MCP 服务器 "${this.serverUrl}" 返回了 ${authorizationUrl.protocol} 协议的授权地址；只支持 http 与 https`)
+    // 验证授权地址属于同源或已知授权服务器
+    const serverUrl = new URL(this.serverUrl)
+    const allowedHosts = new Set([serverUrl.hostname, "localhost", "127.0.0.1"])
+    if (!allowedHosts.has(authorizationUrl.hostname)) {
+      throw new Error(`授权地址主机名 ${authorizationUrl.hostname} 不在允许列表中`)
+    }
     await this.callbacks.onRedirect(authorizationUrl)
   }
```

---

# 问题4：state() 生成并保存新 state 存在竞态 2级
## 问题4分析:
第 152-167 行 `state()` 若无存储 state，生成新随机值并 `await updateOAuthState` 保存。并发调用时：
- 协程 A 生成 state1，协程 B 生成 state2
- A 保存 state1，B 保存 state2 → 最终存 state2
- A 返回 state1，授权服务器收到 state1 → 校验失败（存的是 state2）

### 问题4修复后的代码：
```diff
   async state(): Promise<string> {
     const entry = await Effect.runPromise(this.runtime)(this.auth.get(this.mcpName))
     if (entry?.oauthState) {
       return entry.oauthState
     }
 
-    const newState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
-      .map((b) => b.toString(16).padStart(2, "0"))
-      .join("")
-    await Effect.runPromise(this.auth.updateOAuthState(this.mcpName, newState))
-    return newState
+    // 原子生成并保存：使用 Deferred 或锁，或直接生成并返回不落库（由调用方在 startAuth 前预存）
+    // 妥协：生成后立即返回，由 startAuth 调用 saveState 覆盖（现有流程已如此）
+    const newState = Array.from(crypto.getRandomValues(new Uint8Array(32)))
+      .map((b) => b.toString(16).padStart(2, "0"))
+      .join("")
+    return newState
   }
```
或：在 `startAuth` 前强制调用 `saveState`，`state()` 仅读取。

---

# 问题5：invalidateCredentials 读-改-写无锁，并发丢失更新 2级
## 问题5分析:
第 169-185 行 `invalidateCredentials` 先 `get` 再 `set` 修改后的 entry。并发调用时：
- 协程 A `get` 得到 entry，删除 `tokens`
- 协程 B `get` 得到同一 entry，删除 `clientInfo`
- A `set` 保存无 tokens 版本，B `set` 保存无 clientInfo 版本 → 一方更新丢失

### 问题5修复后的代码：
```diff
   async invalidateCredentials(type: "all" | "client" | "tokens"): Promise<void> {
-    const entry = await Effect.runPromise(this.auth.get(this.mcpName))
-    if (!entry) return
-    switch (type) {
-      case "all":
-        await Effect.runPromise(this.auth.remove(this.mcpName))
-        break
-      case "client":
-        delete entry.clientInfo
-        await Effect.runPromise(this.auth.set(this.mcpName, entry))
-        break
-      case "tokens":
-        delete entry.tokens
-        await Effect.runPromise(this.auth.set(this.mcpName, entry))
-        break
-    }
+    await Effect.runPromise(this.runtime)(this.auth.mutate((data) => {
+      const entry = data[this.mcpName]
+      if (!entry) return undefined
+      switch (type) {
+        case "all":
+          const next = { ...data }
+          delete next[this.mcpName]
+          return next
+        case "client":
+          return { ...data, [this.mcpName]: { ...entry, clientInfo: undefined } }
+        case "tokens":
+          return { ...data, [this.mcpName]: { ...entry, tokens: undefined } }
+      }
+    }))
   }
```
利用 `McpAuth.mutate` 的文件锁原子更新。