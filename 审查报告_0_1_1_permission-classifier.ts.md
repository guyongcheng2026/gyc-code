# 问题1：内存态拒绝计数器无持久化、无 TTL、无并发保护 2级
## 问题1分析:
`DenialTracker` (第 1-21 行) 使用进程内 `Map<string, number>` 记录拒绝次数：
- 重启即丢失，攻击者可重启绕过
- 无过期机制，长期运行内存泄漏（键不清理）
- `Map` 非线程安全，虽 JS 单线程但 `await` 让出时并发修改可竞态
- `MAX_DENIALS = 3` 硬编码，不可配置
- 全局单例，未按会话/用户/IP 隔离，误伤合法用户

### 问题1修复后的代码：
```diff
-export class DenialTracker {
-  private denials = new Map<string, number>()
-  private readonly MAX_DENIALS = 3
-
-  recordDenial(key: string): void {
-    const count = (this.denials.get(key) ?? 0) + 1
-    this.denials.set(key, count)
-  }
-
-  shouldBlock(key: string): boolean {
-    return (this.denials.get(key) ?? 0) >= this.MAX_DENIALS
-  }
-
-  getDenialCount(key: string): number {
-    return this.denials.get(key) ?? 0
-  }
-
-  reset(): void {
-    this.denials.clear()
-  }
-}
+import { RateLimiter } from "@/server/rate-limiter"
+import { Effect, Layer } from "effect"
+
+export class DenialTracker {
+  constructor(private readonly limiter: RateLimiter) {}
+
+  recordDenial(key: string): Effect.Effect<void> {
+    return this.limiter.recordFailure(`denial:${key}`)
+  }
+
+  shouldBlock(key: string): Effect.Effect<boolean> {
+    return this.limiter.isBlocked(`denial:${key}`)
+  }
+
+  getDenialCount(key: string): Effect.Effect<number> {
+    return this.limiter.getFailureCount(`denial:${key}`)
+  }
+
+  reset(key?: string): Effect.Effect<void> {
+    return key ? this.limiter.reset(`denial:${key}`) : this.limiter.resetAll()
+  }
+}
+
+export const DenialTrackerLayer = Layer.effect(
+  DenialTracker,
+  Effect.gen(function* () {
+    const limiter = yield* RateLimiter
+    return new DenialTracker(limiter)
+  }),
+)
```
委托给统一 `RateLimiter`（滑动窗口、TTL、持久化、分桶），消除重复造轮子。

---

# 问题2：未集成至权限询问流程 3级
## 问题2分析:
`permission/index.ts` 中 `ask()` 与 `reply()` 均未调用 `DenialTracker`。拒绝计数仅作记录，未用于自动封禁。需在 `reply("reject")` 后 `tracker.recordDenial(sessionId)`，`ask()` 前 `tracker.shouldBlock(sessionId)` 直接拒绝。

### 问题2修复后的代码：
```diff
+import { DenialTracker } from "./classifier"
+
     const ask = Effect.fn("Permission.ask")(function* (input: PermissionV1.AskInput) {
+      const tracker = yield* DenialTracker
+      if (yield* tracker.shouldBlock(input.sessionID)) {
+        yield* Effect.logWarning("Permission denied: session blocked by denial tracker", { sessionID: input.sessionID })
+        return yield* new PermissionV1.RejectedError()
+      }
       const approved = yield* RefModule.get(state.approved)
       ...
     })
 
     const reply = Effect.fn("Permission.reply")(function* (input: PermissionV1.ReplyInput) {
       ...
       if (input.reply === "reject") {
+        const tracker = yield* DenialTracker
+        yield* tracker.recordDenial(existing.info.sessionID)
         yield* Deferred.fail(...)
         ...
       }
     })
```