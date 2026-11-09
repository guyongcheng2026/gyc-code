注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：cachedWithTTL(Duration.zero) 缓存条目立即过期，形同空设 2级

## 问题1分析

文件：`src/project/instance-store.ts:186`

根因：缓存写入时传入 `Duration.zero` 作为 TTL，等于"写入即过期"。任何后续读取都会因 TTL 已过而触发未命中重算，缓存层完全退化成透传层，失去对热路径（实例元数据、runtime 句柄等）的削峰作用。在高频会话场景下，每次访问都会穿透到底层 store，造成不必要的 I/O/计算开销。

对照证据：同文件内其他缓存调用若使用合理 TTL（非 zero），则 `:186` 是孤立的误配置；若多处均为 zero，则缓存机制整体形同虚设。

### 问题1修复后的代码

```diff
-    cachedWithTTL(key, Duration.zero)
+    cachedWithTTL(key, Duration.minutes(5))
```

---

# 问题2：Effect.promise 无缺陷兜底 3级

## 问题2分析

文件：`src/project/instance-store.ts:96`

根因：`Effect.promise(...)` 包裹的 Promise 若内部抛出非 `Error` 实例（如字符串、`null`、原生异常变种），Effect 默认会将其转为 `Die`（不可恢复的 defect）而非 `Fail`（可恢复的 failure）。上层若仅用 `Effect.catchAll`（捕获 failure）而未用 `Effect.catchAllDefect`（捕获 defect），则该路径将导致整个会话/实例流崩溃且无法降级。

对照证据：`instance-runtime.ts` 的桥接层同样使用 `Effect.promise`，但其体更窄；`:96` 处的 promise 体涉及更多外部副作用（store 读取），缺陷面更大。

### 问题2修复后的代码

```diff
   Effect.promise(() => ...)
+    .pipe(
+      Effect.catchAllDefect(defect =>
+        Effect.fail(new Error(`instance store defect: ${defect}`))
+      )
+    )
```
