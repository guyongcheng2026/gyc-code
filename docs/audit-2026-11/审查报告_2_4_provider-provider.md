注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：插件/认证凭据被直接写入 process.env，扩散到全部子进程 <2>级
## 问题1分析:
provider.ts:366-374（amazon-bedrock）与 provider.ts:631-639（sap-ai-core）把 `auth.key`（存储的 API 凭据）赋值给 `process.env.AWS_BEARER_TOKEN_BEDROCK` / `process.env.AICORE_SERVICE_KEY`，两处注释均自认是绕过 `Env.set` 浅拷贝的 TODO。后果：
1. 凭据从专用凭据存储（Auth 服务）提升为进程级全局环境变量，进程内任意代码与**所有被 spawn 的子进程**（编码 CLI 的 shell 工具调用会继承 env）均可直接读取；
2. 一旦写入永不回收（无对应的 delete/restore），凭据在进程存活期内持续驻留；
3. 若同进程后续还有其他 provider 初始化（366 行优先读 `process.env.AWS_BEARER_TOKEN_BEDROCK`），会把上一个 provider 写入的值当作"环境变量配置"复用，产生跨 provider 的凭据串用。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/provider.ts
+++ b/src/gyccode/provider/provider.ts
@@ -364,11 +364,14 @@
       // TODO: Using process.env directly because Env.set only updates a process.env shallow copy,
       // until the scope of the Env API is clarified (test only or runtime?)
       const awsBearerToken = iife(() => {
-        const envToken = process.env.AWS_BEARER_TOKEN_BEDROCK
+        // 不读取/写入 process.env：避免凭据扩散到子进程，也避免跨 provider 串用。
+        // 若需沿用 env 配置，应经 Env 服务读取，而非直读 process.env。
+        const envToken = env["AWS_BEARER_TOKEN_BEDROCK"]
         if (envToken) return envToken
         if (auth?.type === "api") {
-          process.env.AWS_BEARER_TOKEN_BEDROCK = auth.key
           return auth.key
         }
         return undefined
       })
```
（sap-ai-core 的 provider.ts:631-639 同理：删除 `process.env.AICORE_SERVICE_KEY = auth.key` 写入，仅返回 `auth.key`。）

---
# 问题2：healthCheck 把 4xx/重定向等失败状态判为健康 <3>级
## 问题2分析:
provider.ts:2209-2210 对 `baseURL` 发 HEAD 后仅用 `res.status < 500` 判定成功，且 `fetch` 默认跟随重定向。401（凭据失效）、404（baseURL 配错）、403 均返回 `{ok: true}`，健康检查形同虚设——凭据过期或端点配错时 UI 仍显示"可达"，误导排障。同时 3xx 最终落到 200 也掩盖了端点重定向配置问题。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/provider.ts
+++ b/src/gyccode/provider/provider.ts
@@ -2206,8 +2206,9 @@
           const ctl = new AbortController()
           const timer = setTimeout(() => ctl.abort(), timeoutMs)
           try {
             const res = await fetch(baseURL, { method: "HEAD", signal: ctl.signal })
-            return res.status < 500
+            // 仅 2xx/3xx 视为健康：401/404 说明端点或凭据配置错误，必须暴露。
+            return res.status < 400
           } finally {
             clearTimeout(timer)
           }
```

---
# 问题3：gitlab discoverModels 空 catch 静默吞错 <3>级
## 问题3分析:
provider.ts:780-782 的 `catch (e) { return {} }` 捕获插件 `discoverWorkflowModels` 的全部异常后既不记录也不区分错误类型（网络失败、401 凭据失效、插件内部错误一律变成"没有模型"），排障时完全无痕迹，与全仓"空 catch 清零"的约定相悖。

### 问题3修复后的代码：
```diff
--- a/src/gyccode/provider/provider.ts
+++ b/src/gyccode/provider/provider.ts
@@ -777,8 +777,10 @@
             }
 
             return models
           } catch (e) {
+            logError("provider.client", e, { provider: "gitlab", stage: "discoverWorkflowModels" })
             return {}
           }
         },
```

---
# 问题4：google-vertex 自定义 fetch 每请求新建 GoogleAuth 并取新 token <3>级
## 问题4分析:
provider.ts:589-599 在**每次模型请求**的 fetch 回调里 `new GoogleAuth(...)` → `auth.getClient()` → `client.getAccessToken()`。GoogleAuth 实例不复用意味着 ADC/元数据服务器探测、token 获取在每个请求上重复执行，增加首字节延迟（SSE 场景叠加 header timeout 计时）；且 `token.token` 可能为 null 时会发出 `Authorization: Bearer null`，请求失败且错误信息无从定位。

### 问题4修复后的代码：
```diff
--- a/src/gyccode/provider/provider.ts
+++ b/src/gyccode/provider/provider.ts
@@ -586,14 +586,20 @@
         options: {
           project,
           location,
           fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
-            const { GoogleAuth } = await import("google-auth-library")
-            const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] })
-            const client = await auth.getClient()
-            const token = await client.getAccessToken()
+            const token = await cachedVertexToken()
+            if (!token) throw new Error("google-vertex: failed to obtain access token")
 
             const headers = new Headers(init?.headers)
-            headers.set("Authorization", `Bearer ${token.token}`)
+            headers.set("Authorization", `Bearer ${token}`)
 
             return fetch(input, { ...init, headers })
           },
         },
```
（配套在 loader 外层用模块级 Promise 缓存 token，过期时重新获取，避免每请求重建 auth client。）

---
# 问题5：baseURL 的 `${VAR}` 占位符替换失败时保留字面量并继续发请求 <3>级
## 问题5分析:
provider.ts:1541（apiTargets）与 provider.ts:1913-1916（resolveSDK）对 `baseURL` 做 `${VAR}` 环境变量插值时，环境变量缺失即 `val ?? item` 原样保留 `${VAR}`，随后 provider.ts:1920 直接 `options["baseURL"] = baseURL` 发起请求。结果是请求发往含 `{`/`$` 的畸形 URL，报出的错误与真实原因（缺环境变量）完全无关，排障成本高；1541 处还会把畸形 URL 送进 ApiModels 的 `/models` 同步循环反复重试。

### 问题5修复后的代码：
```diff
--- a/src/gyccode/provider/provider.ts
+++ b/src/gyccode/provider/provider.ts
@@ -1910,9 +1910,13 @@
             }
           }
 
-          url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
+          const unresolved: string[] = []
+          url = url.replace(/\$\{([^}]+)\}/g, (item, key) => {
             const val = envs[String(key)]
+            if (val === undefined) unresolved.push(key)
             return val ?? item
           })
+          // 占位符无法解析时快速失败，避免带着畸形 URL 反复发请求。
+          if (unresolved.length > 0)
+            throw new InitError({ providerID: model.providerID, cause: new Error(`Unresolved env placeholders in baseURL: ${unresolved.join(", ")}`) })
           return url
         })
```
（1541 处同样处理：缺环境变量时跳过该 target 并 `logError`，不进入 `apiModels.track`。）
