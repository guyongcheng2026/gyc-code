# 问题1：approved 数组更新后立即读取竞态 1级
## 问题1分析:
第 320-329 行 `RefModule.modify(state.approved, ...)` 添加 `always` 规则，第 331 行 `yield* RefModule.get(state.approved)` 重新读取。但在 Effect 运行时中，`Ref.modify` 返回新值，`Ref.get` 是独立操作。若并发有另一个 `reply` 也在修改 `approved`，两者可能交错：
- 协程 A `modify` 追加规则 → 协程 B `modify` 追加规则 → A `get` 读到 B 的结果（丢失 A 自己的追加）
- 导致同一 session 内多个 `always` 批次仅最后一批生效

### 问题1修复后的代码：
```diff
      if (existing.info.always.length > 0) {
-        yield* RefModule.modify(state.approved, (approved) => {
-          const newRules = existing.info.always.map((pattern) => ({
-            permission: existing.info.permission,
-            pattern,
-            action: "allow" as const,
-          }))
-          return [approved.concat(newRules), approved] as const
-        })
+        const newRules = existing.info.always.map((pattern) => ({
+          permission: existing.info.permission,
+          pattern,
+          action: "allow" as const,
+        }))
+        yield* RefModule.modify(state.approved, (approved) => [
+          approved.concat(newRules),
+          approved,
+        ] as const)
+
+        // 原子读取新值，避免并发竞态
+        const approved = yield* RefModule.get(state.approved)
        const approved = yield* RefModule.get(state.approved)
```

---

# 问题2：拒绝时级联清空同会话所有待决请求 1级
## 问题2分析:
第 298-312 行：`reply === "reject"` 时，遍历 `pending` 中**同 session** 的所有条目并全部 `Deferred.fail(RejectedError)`。这导致：
- 用户拒绝某个工具（如 `bash rm -rf /`）→ 同会话内其它正常待批工具（如 `read package.json`）被强制拒绝
- 模型失去继续执行其它安全操作的机会，必须重新发起
设计应为：仅拒绝当前 `requestID`，其它待决保持等待。

### 问题2修复后的代码：
```diff
      if (input.reply === "reject") {
        yield* Deferred.fail(
          existing.deferred,
          input.message
            ? new PermissionV1.CorrectedError({ feedback: input.message })
            : new PermissionV1.RejectedError(),
        )
-        const toReject = (yield* RefModule.get(state.pending)).entries().filter(
-          ([, item]) => item.info.sessionID === existing.info.sessionID,
-        )
-        yield* RefModule.modify(state.pending, (m) => {
-          for (const [id, item] of toReject) m.delete(id)
-          return [undefined, m] as const
-        })
-        for (const [id, item] of toReject) {
-          yield* events.publish(Event.Replied, {
-            sessionID: item.info.sessionID,
-            requestID: item.info.id,
-            reply: "reject",
-          })
-          yield* Deferred.fail(item.deferred, new PermissionV1.RejectedError())
-        }
        return
      }
```

---

# 问题3：external_directory 围栏仅在文件权限触发 2级
## 问题3分析:
第 181 行 `isFenceRelevant(request.permission)` 仅对 `["edit", "write", "read", "patch", "notebook"]` 生效。但 `bash`、`apply_patch` 等执行类权限的 pattern 也可能是路径（如 `bash cp /etc/passwd /tmp/`），未走围栏检查。攻击者可通过非文件类权限绕过工作目录限制。

### 问题3修复后的代码：
```diff
-const FENCED_PERMISSIONS = new Set(["edit", "write", "read", "patch", "notebook"])
+const FENCED_PERMISSIONS = new Set([
+  "edit", "write", "read", "patch", "notebook",
+  "bash", "apply_patch", "execute", "spawn",
+])
```

---

# 问题4：expand() 不支持 Windows 环境变量 2级
## 问题4分析:
第 373-379 行 `expand()` 仅处理 `~`、`$HOME`。Windows 下 `%USERPROFILE%`、`%HOMEPATH%`、`%HOMEDRIVE%%HOMEPATH%` 等常见变量不支持。配置文件若写 `%USERPROFILE%/Documents` 将按字面路径处理，导致权限匹配失效。

### 问题4修复后的代码：
```diff
 function expand(pattern: string): string {
   if (pattern.startsWith("~/")) return os.homedir() + pattern.slice(1)
   if (pattern === "~") return os.homedir()
   if (pattern.startsWith("$HOME/")) return os.homedir() + pattern.slice(5)
   if (pattern.startsWith("$HOME")) return os.homedir() + pattern.slice(5)
+  if (process.platform === "win32") {
+    const env = pattern.replace(/%([^%]+)%/g, (_, k) => process.env[k] ?? "")
+    if (env !== pattern) return expand(env) // 递归展开嵌套变量
+  }
   return pattern
 }
```

---

# 问题5：deniedByMode 逻辑与 ruleset deny 优先级文档不一致 2级
## 问题5分析:
第 209-211 行注释称"ruleset 的显式 deny 永远生效，bypassPermissions 也不覆盖它"，但第 211 行：
```ts
const deniedByMode = modeAction === "deny" || (isDontAsk && rule.action !== "allow")
```
- `modeAction === "deny"`：模式显式 deny（如 `plan` 模式对 write 类）→ 覆盖 ruleset allow
- `isDontAsk && rule.action !== "allow"`：`dontAsk` 模式下非显式 allow → deny
这与"用户手写规则比模式开关更硬"矛盾：`dontAsk` 模式下，ruleset `allow` 会被 `deniedByMode` 判为 false 而放行（正确），但 ruleset `ask` 会被判为 deny（正确，fail-closed）。问题在于注释说"显式 deny 永远生效"，但 `modeAction === "deny"` 会覆盖 ruleset `allow`，这是模式优先于 ruleset，与注释冲突。

### 问题5修复后的代码：
```diff
-        // 安全侧优先：ruleset 的显式 deny 永远生效，bypassPermissions 也不覆盖它。
-        // 用户手写的规则比模式开关更硬——模式放行不该推翻「我明确禁了这东西」。
-        const deniedByMode = modeAction === "deny" || (isDontAsk && rule.action !== "allow")
+        // 优先级：ruleset deny > 模式 deny/allow > ruleset allow/ask
+        // ruleset 显式 deny 永远生效；模式 deny 覆盖 ruleset allow/ask；模式 allow 覆盖 ruleset ask
+        const deniedByMode = rule.action === "deny" || modeAction === "deny" || (isDontAsk && rule.action !== "allow")
```

---

# 问题6：拒绝审计落库失败静默忽略 3级
## 问题6分析:
第 78-83 行 `recordDenialRow` 用 `Effect.catchCause` 捕获所有错误仅记 `logWarning`。数据库连接池耗尽、表不存在、磁盘满等严重错误均被吞掉，审计缺失无感知。等保三级要求审计记录不可丢失。

### 问题6修复后的代码：
```diff
       .pipe(
         Effect.catchCause((cause) =>
-          Effect.logWarning("permission denial not recorded", {
+          Effect.gen(function* () {
+            const isTransient = cause._tag === "Fail" && /ECONNREFUSED|ETIMEDOUT|pool/i.test(String(cause))
+            yield* Effect.log(
+              isTransient ? "warning" : "error",
+              "permission denial not recorded",
+              { "session.id": input.sessionID, cause, transient: isTransient }
+            )
+            if (!isTransient) yield* Metrics.increment("permission.denial.record.failed")
+          }),
         ),
       )
```
需区分瞬时/永久错误，永久错误需告警并计数。