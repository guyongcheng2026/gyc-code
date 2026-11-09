# 问题1：硬编码虚拟密钥常量泄露风险 2级
## 问题1分析:
文件 `src/gyccode/auth/index.ts` 第 10 行定义 `OAUTH_DUMMY_KEY = "gyccode-oauth-dummy-key"`。该常量在代码库中若被误用作真实密钥（如测试未隔离、配置回退），会导致认证绕过或凭据混淆。虽为"dummy"标识，但字符串常量在构建产物中明文可见，违最小权限与密钥管理规范。

### 问题1修复后的代码：
```diff
-export const OAUTH_DUMMY_KEY = "gyccode-oauth-dummy-key"
+// 内部占位标记，仅用于类型区分，不应出现在持久化/网络层
+export const OAUTH_DUMMY_KEY = Symbol.for("gyccode.oauth.dummy")
```

---

# 问题2：并发写入竞态导致凭据丢失 1级
## 问题2分析:
`set` (81-100行) 与 `remove` (102-112行) 均在操作前调用 `all()` 读取全量数据，随后直接 `writeJson` 覆写文件。无锁、无版本号、无 CAS 机制。并发场景下：
- 两个 `set` 并发：后写入者覆盖前者，丢失一条凭据
- `set` 与 `remove` 并发：同理
- `all()` 内部 `readJson` + `writeJson` 非原子，中间态可被其它进程读到不一致数据

### 问题2修复后的代码：
```diff
     const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
       const norm = key.replace(/\/+$/, "")
-      const data = yield* all()
+      // 原子读改写：单次事务内完成，避免竞态
+      yield* fsys.atomicWriteJson(file, (current: Record<string, unknown>) => {
+        const data = Record.filterMap(current, (v) => Result.fromOption(decode(v), () => undefined))
+        if (norm !== key) delete data[key]
+        delete data[norm + "/"]
+        return { ...data, [norm]: info }
+      }, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
       if (info.type === "api") {
         yield* credentials.create({
           integrationID: Integration.ID.make(norm),
           value: Credential.Key.make({
             type: "key",
             key: info.key,
             ...(info.metadata ? { metadata: info.metadata } : {}),
           }),
           label: "default",
         })
       }
     })
 
     const remove = Effect.fn("Auth.remove")(function* (key: string) {
       const norm = key.replace(/\/+$/, "")
-      const data = yield* all()
-      delete data[key]
-      delete data[norm]
-      yield* fsys.writeJson(file, data, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
+      yield* fsys.atomicWriteJson(file, (current: Record<string, unknown>) => {
+        const data = Record.filterMap(current, (v) => Result.fromOption(decode(v), () => undefined))
+        delete data[key]
+        delete data[norm]
+        return data
+      }, 0o600).pipe(Effect.mapError(fail("Failed to write auth data")))
       const stored = yield* credentials.list(Integration.ID.make(norm))
       for (const credential of stored) {
         yield* credentials.remove(credential.id)
       }
     })
```

---

# 问题3：解码失败条目静默丢弃导致凭据无声清除 1级
## 问题3分析:
`all()` 第 69 行 `Record.filterMap` 将解码失败条目过滤掉，仅在第 72-73 行记录警告。但 `set/remove` 基于这份"已过滤"的结果整文件覆写（第 87、107 行），导致：
- 单条 JSON 损坏 → 该条目永久丢失，且无恢复机制
- 其它供应商凭据被"无提示清除"（代码注释第 63-64 行自认风险）

### 问题3修复后的代码：
```diff
     const all = Effect.fn("Auth.all")(function* () {
       const data = (yield* fsys.readJson(file).pipe(
         Effect.tapError((error) => Effect.logWarning("Failed to read auth data", error)),
         Effect.orElseSucceed(() => ({})),
       )) as Record<string, unknown>
-      const result = Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
-      const dropped = Object.keys(data).filter((key) => !(key in result))
-      if (dropped.length > 0) yield* Effect.logWarning("Dropped undecodable auth entries", { keys: dropped })
-      return result
+      const decoded = Record.filterMap(data, (value) => Result.fromOption(decode(value), () => undefined))
+      const dropped = Object.keys(data).filter((key) => !(key in decoded))
+      if (dropped.length > 0) {
+        yield* Effect.logError("Undecodable auth entries detected - manual recovery required", { keys: dropped })
+        // 保留原始损坏条目，不自动清除，交由人工/修复流程处理
+        return { ...decoded, ...Object.fromEntries(dropped.map(k => [k, { _corrupted: true, raw: data[k] }])) }
+      }
+      return decoded
     })
```

---

# 问题4：明文存储凭据且无加密 2级
## 问题4分析:
`auth.json` 以明文 JSON 存储 OAuth refresh/access token、API key（第 87、107 行 `writeJson`）。`0o600` 仅防同机器其它用户读取，无法防：
- 磁盘备份/镜像泄露
- 进程内存转储
- 供应链攻击读取构建产物
等保三级要求敏感数据加密存储。

### 问题4修复后的代码：
```diff
-    yield* fsys.writeJson(file, { ...data, [norm]: info }, 0o600)
+    const encrypted = yield* EncryptService.encrypt(JSON.stringify({ ...data, [norm]: info }))
+    yield* fsys.writeFile(file, encrypted, 0o600)
```
需引入 `EncryptService`（AES-GCM + 硬件绑定密钥或用户口令派生），解密在 `all()` 对应处理。

---

# 问题5：Key 规范化逻辑不一致 3级
## 问题5分析:
第 84-85 行：
```ts
if (norm !== key) delete data[key]
delete data[norm + "/"]
```
- `norm` 已去除尾部 `/`，`norm + "/"` 永远不等于原 `key`（除非 key 以 `//` 结尾）
- 第 105-106 行 `remove` 同理
建议统一仅保留 `norm` 一种形式，移除冗余删除。

### 问题5修复后的代码：
```diff
     const set = Effect.fn("Auth.set")(function* (key: string, info: Info) {
       const norm = key.replace(/\/+$/, "")
       const data = yield* all()
-      if (norm !== key) delete data[key]
-      delete data[norm + "/"]
+      delete data[key] // 兼容旧 key 形式
       yield* fsys.writeJson(file, { ...data, [norm]: info }, 0o600)
```
`remove` 同理。