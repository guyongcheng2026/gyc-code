# 问题1：disposeInstance 用 Promise.allSettled 静默吞掉 disposer 失败，清理失败不可观测 2级

## 问题1分析:
`instance-registry.ts:11-12` 的 `disposeInstance` 对所有 disposer 使用 `Promise.allSettled`，其返回的 Promise **永远不会 reject**，失败原因被丢弃，函数仍以成功 resolve。而注册进来的 disposer 并非都永不失败：

- `server/routes/instance/httpapi/handlers/pty.ts:47-48` 注册的 disposer 返回 `Effect.runPromise(locations.invalidate(...))`，该 Promise 可 reject（fiber 中断或 invalidate 失败）；
- `effect/instance-state.ts:54` 同样注册了 `Effect.runPromise(ScopedCache.invalidate(cache, directory))`，可 reject。

消费方 `project/instance-store.ts:96`（及 `:139` reload 路径）以 `Effect.promise(() => disposeInstance(ctx.directory))` 调用，**依赖 disposeInstance 的 reject 才能把清理失败暴露到 Effect 错误通道**；`server/global-lifecycle.ts:10` 的 `clearDisposers` 也直接 await 它。由于 allSettled 吞错，PTY 位置缓存（`locations`）或 `ScopedCache` invalidate 失败时：实例已被标记 disposed（`instance-store.ts:104` 执行 `cache.delete`），但底层资源残留，且**无任何日志、无错误冒泡**——典型的静默资源泄漏（2 级：健壮性缺陷）。

`session-cwd.ts:42`、`goal.ts:63` 的 disposer 确实返回 `Promise.resolve()` 永不失败，但 pty/instance-state 两条路径可失败，allSettled 对全部 disposer 一刀切容错是错误粒度。

### 问题1修复后的代码：
```diff
 export async function disposeInstance(directory: string) {
-  await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
+  const results = await Promise.allSettled([...disposers].map((disposer) => disposer(directory)))
+  const failures = results.flatMap((result) =>
+    result.status === "rejected" ? [result.reason as unknown] : [],
+  )
+  if (failures.length > 0) {
+    throw new AggregateError(failures, `disposeInstance failed for ${directory}`)
+  }
 }
```
修复后失败经 `instance-store.ts:96` 的 `Effect.promise` 冒泡为 Effect 缺陷，可被既有 `global-lifecycle.ts:27-28` 的 `swallowErrors`/`logWarning` 路径观测；成功路径（`session.goal`/`session-cwd` 等永不失败的 disposer）行为不变。
