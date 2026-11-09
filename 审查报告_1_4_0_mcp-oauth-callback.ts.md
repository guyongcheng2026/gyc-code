# 问题1：模块级全局可变状态，不可测试、并发不安全 1级
## 问题1分析:
第 9-10、18-22 行定义模块级 `let` 变量：`currentPort`、`currentPath`、`server`、`pendingAuths`、`mcpNameToState`。导致：
- 单测无法隔离（状态跨测试泄漏）
- 多实例/多进程共享模块时状态冲突
- 无法并行运行多个 OAuth 回调流程
- 热重载/开发模式下状态残留

### 问题1修复后的代码：
```diff
-const OAUTH_CALLBACK_HOST = "127.0.0.1"
-
-let currentPort = OAUTH_CALLBACK_PORT
-let currentPath = OAUTH_CALLBACK_PATH
-
-interface PendingAuth { ... }
-
-let server: ReturnType<typeof createServer> | undefined
-const pendingAuths = new Map<string, PendingAuth>()
-const mcpNameToState = new Map<string, string>()
-
-const CALLBACK_TIMEOUT_MS = 5 * 60 * 1000
-
-function cleanupStateIndex(oauthState: string) { ... }
-
-function stopIfIdle() { ... }
-
-function handleRequest(req, res) { ... }
-
-let ensureRunningChain: Promise<void> = Promise.resolve()
-
-export async function ensureRunning(redirectUri?: string): Promise<void> { ... }
-
-async function ensureRunningSerial(redirectUri?: string): Promise<void> { ... }
-
-export function waitForCallback(oauthState: string, mcpName?: string): Promise<string> { ... }
-
-export function cancelPending(mcpName: string): void { ... }
-
-export async function isPortInUse(port: number = OAUTH_CALLBACK_PORT): Promise<boolean> { ... }
-
-export async function stop(): Promise<void> { ... }
-
-export function isRunning(): boolean { ... }
+export interface OAuthCallbackServerConfig {
+  host: string
+  port: number
+  path: string
+  timeoutMs: number
+}
+
+export class OAuthCallbackServer {
+  private server: ReturnType<typeof createServer> | undefined
+  private pendingAuths = new Map<string, PendingAuth>()
+  private mcpNameToState = new Map<string, string>()
+  private ensureRunningChain: Promise<void> = Promise.resolve()
+
+  constructor(private readonly config: OAuthCallbackServerConfig) {}
+
+  // 所有函数改为实例方法，捕获 this.config / this.pendingAuths / this.server
+  // ...
+}
+
+// 工厂函数供 DI
+export const createOAuthCallbackServer = (config?: Partial<OAuthCallbackServerConfig>) =>
+  new OAuthCallbackServer({
+    host: "127.0.0.1",
+    port: OAUTH_CALLBACK_PORT,
+    path: OAUTH_CALLBACK_PATH,
+    timeoutMs: 5 * 60 * 1000,
+    ...config,
+  })
```

---

# 问题2：ensureRunning TOCTOU 竞态（端口检查与建服务器间隙） 1级
## 问题2分析:
第 141-144 行 `isPortInUse(port)` 检查端口空闲，第 149-155 行 `createServer` + `listen`。两者间有 `await` 间隙，另一进程可在间隙内抢占端口，导致 `listen` 抛 `EADDRINUSE` 未捕获（第 154 行只监听 `error` 事件，但 `listen` 回调是同步抛出还是异步需验证）。更糟：`isPortInUse` 连接成功仅说明端口被占用，**不区分是否为本进程旧服务器**，可能误判。

### 问题2修复后的代码：
```diff
 async function ensureRunningSerial(redirectUri?: string): Promise<void> {
   const { port, path } = parseRedirectUri(redirectUri)
 
   if (server && (currentPort !== port || currentPath !== path)) {
     await stop()
   }
 
   if (server) return
 
-  const running = await isPortInUse(port)
-  if (running) {
-    return
-  }
+  // 直接尝试 listen，捕获 EADDRINUSE；避免 TOCTOU
+  currentPort = port
+  currentPath = path
+
   server = createServer(handleRequest)
   await new Promise<void>((resolve, reject) => {
     server!.listen(currentPort, OAUTH_CALLBACK_HOST, () => {
       resolve()
     })
     server!.on("error", (err) => {
+      if (err.code === "EADDRINUSE") {
+        // 端口被占用：可能是残留进程，尝试强制清理后重试一次
+        server = undefined
+        setTimeout(() => ensureRunningSerial(redirectUri).then(resolve, reject), 100)
+      } else {
+        reject(err)
+      }
     })
   })
 }
```

---

# 问题3：cleanupStateIndex O(n) 线性搜索 2级
## 问题3分析:
第 26-33 行 `cleanupStateIndex` 遍历 `mcpNameToState` 删除反向索引。`pendingAuths` 以 `oauthState` 为键，`mcpNameToState` 以 `mcpName` 为键。删除时需反向查找，复杂度 O(n)。并发高时成为瓶颈。

### 问题3修复后的代码：
```diff
-const mcpNameToState = new Map<string, string>()
+// 双向映射：oauthState <-> mcpName，均 O(1)
+const oauthStateToMcpName = new Map<string, string>()
+const mcpNameToOauthState = new Map<string, string>()
 
 function cleanupStateIndex(oauthState: string) {
-  for (const [name, state] of mcpNameToState) {
-    if (state === oauthState) {
-      mcpNameToState.delete(name)
-      break
-    }
-  }
+  const mcpName = oauthStateToMcpName.get(oauthState)
+  if (mcpName) {
+    oauthStateToMcpName.delete(oauthState)
+    mcpNameToOauthState.delete(mcpName)
+  }
 }
 
 // 使用处同步更新双向映射
-  if (mcpName) mcpNameToState.set(mcpName, oauthState)
+  if (mcpName) {
+    oauthStateToMcpName.set(oauthState, mcpName)
+    mcpNameToOauthState.set(mcpName, oauthState)
+  }
```

---

# 问题4：cancelPending 回退键逻辑错误 2级
## 问题4分析:
第 177 行 `const key = oauthState ?? mcpName`。若 `mcpNameToState` 无该 `mcpName`（如未调用 `waitForCallback` 传 mcpName），`oauthState` 为 `undefined`，回退使用 `mcpName` 作为键查找 `pendingAuths`。但 `pendingAuths` 键为 `oauthState`，**不是** `mcpName`，导致找不到待取消项。

### 问题4修复后的代码：
```diff
 export function cancelPending(mcpName: string): void {
   const oauthState = mcpNameToOauthState.get(mcpName)
-  const key = oauthState ?? mcpName
-  const pending = pendingAuths.get(key)
+  if (!oauthState) return // 无对应 state，无法取消
+  const pending = pendingAuths.get(oauthState)
   if (pending) {
     clearTimeout(pending.timeout)
     pendingAuths.delete(oauthState)
     mcpNameToOauthState.delete(mcpName)
     oauthStateToMcpName.delete(oauthState)
     pending.reject(new Error("Authorization cancelled"))
     stopIfIdle()
   }
 }
```

---

# 问题5：ensureRunningChain 错误吞噬导致后续调用静默失败 2级
## 问题5分析:
第 123-126 行 `ensureRunningChain = run.then(() => undefined, () => undefined)` 将失败转为 `undefined`，链永远 fulfilled。但返回给调用者的 `run` 仍会 reject。问题：下一个调用 `ensureRunningChain.then(...)` 会在上一个 rejected 后立即执行（因链已 fulfilled），**但上一个 `ensureRunningSerial` 可能仍在运行中**（如 `listen` 阻塞）。导致并发启动竞态。

### 问题5修复后的代码：
```diff
-let ensureRunningChain: Promise<void> = Promise.resolve()
-
-export async function ensureRunning(redirectUri?: string): Promise<void> {
-  const run = ensureRunningChain.then(() => ensureRunningSerial(redirectUri))
-  ensureRunningChain = run.then(() => undefined, () => undefined)
-  return run
-}
+// 使用 Mutex 序列化，保证同一时刻仅有一个 ensureRunningSerial 执行
+let ensureRunningMutex = Promise.resolve()
+
+export async function ensureRunning(redirectUri?: string): Promise<void> {
+  const run = ensureRunningMutex.then(() => ensureRunningSerial(redirectUri))
+  ensureRunningMutex = run.catch(() => undefined) // 失败不阻塞后续，但保证串行
+  return run
+}
```