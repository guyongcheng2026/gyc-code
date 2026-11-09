注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：Effect.promise 直接包装插件 authorize/callback，reject 会变成 defect 而非类型化 Error <2>级
## 问题1分析:
auth.ts:182 `const result = yield* Effect.promise(() => method.authorize(input.inputs))` 与 auth.ts:201-203 `Effect.promise(() => match.method === "code" ? match.callback(input.code!) : match.callback())` 把插件回调包进 `Effect.promise`：
- `Effect.promise` 的约定是"永不失败"，回调 reject 会以 **defect（die）** 形式打穿 fiber，而不是进入 `Effect<Authorization | undefined, Error>` 声明的错误通道（auth.ts:96-97）；
- 接口已定义 `ValidationFailed` / `OauthCallbackFailed` 等 TaggedError（auth.ts:76-84），调用方按 `Error` 联合类型做的 `catchTag`/`match` 对插件抛错完全失效——OAuth 授权中途插件抛异常（网络错误、插件内部 bug）会直接终止整个授权流程且错误无法被协议层结构化返回给客户端；
- 同文件其他插件调用（provider.ts:1713、provider.ts:1760）都包了 try/logError 或 catch，此处是唯一裸 `Effect.promise` 的插件边界。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/auth.ts
+++ b/src/gyccode/provider/auth.ts
@@ -179,7 +179,13 @@
         }
       }
 
-      const result = yield* Effect.promise(() => method.authorize(input.inputs))
+      // 插件回调可能 reject：转为类型化 OauthCallbackFailed，避免 defect 打穿 fiber。
+      const result = yield* Effect.tryPromise({
+        try: () => method.authorize(input.inputs),
+        catch: (cause) => new OauthCallbackFailed({}),
+      })
       pending.set(input.providerID, result)
       return {
         url: result.url,
@@ -198,10 +204,13 @@
         return yield* new OauthCodeMissing({ providerID: input.providerID })
       }
 
-      const result = yield* Effect.promise(() =>
-        match.method === "code" ? match.callback(input.code!) : match.callback(),
-      )
+      const result = yield* Effect.tryPromise({
+        try: () => (match.method === "code" ? match.callback(input.code!) : match.callback()),
+        catch: (cause) => new OauthCallbackFailed({}),
+      })
       if (!result || result.type !== "success") return yield* new OauthCallbackFailed({})
```

---
# 问题2：OAuth pending 状态成功后不清理、无过期，可被重复回调复用 <3>级
## 问题2分析:
auth.ts:183 `pending.set(input.providerID, result)` 写入的待回调状态，在 auth.ts:191-224 的 `callback` 全流程中**没有任何 `pending.delete(...)`**：
1. 回调成功（auth.ts:206-223 写入凭据）后条目仍留在 Map，同一 `providerID` 的后续 `callback` 调用会拿到旧 pending 再次执行 `match.callback`，插件侧若无幂等保护会重复换 token；
2. 授权中途放弃（用户关掉浏览器、不回调）的条目永驻内存，长时间运行的 TUI 实例里 Map 只增不减；
3. 条目无 TTL/nonce，`authorize` 再次被调用会覆盖（auth.ts:183），但覆盖前的旧 code 若被迟到的回调送来，仍能匹配到**新** pending，缺少 OAuth state 一次性绑定。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/auth.ts
+++ b/src/gyccode/provider/auth.ts
@@ -180,6 +180,10 @@
       }
 
        const result = yield* Effect.promise(() => method.authorize(input.inputs))
+      // 先删后写：迟到的旧回调不会匹配到被覆盖前的条目语义之外的新 pending。
+      pending.delete(input.providerID)
        pending.set(input.providerID, result)
       return {
         url: result.url,
@@ -220,6 +224,9 @@
           expires,
           ...extra,
         })
       }
+      // 一次性使用：成功消费后立即清理，避免重复回调复用同一 pending。
+      pending.delete(input.providerID)
     })
```
（配套：`InstanceState` 初始化处给 pending 条目加时间戳，`callback` 入口对超过 TTL（如 10 分钟）的条目先 `delete` 再报 `OauthMissing`。）
