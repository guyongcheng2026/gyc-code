注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：decodeURIComponent 抛 URIError 未捕获，直通 500 2级

## 问题1分析:

- 位置：`src/gyccode/server/shared/handlers/fs.ts:19`（路径参数直接 `decodeURIComponent` 解码）。
- 根因：含非法 `%` 序列的输入（如 `%zz`）会使 `decodeURIComponent` 抛出 `URIError`，该异常未被 `Effect.try` 包裹，作为未捕获异常冒泡为 500；本应映射为 400 参数错误。
- 对照证据：同文件其余失败路径均走类型化错误→明确状态码；此处为裸原生调用，属错误通道遗漏。
- 影响：2级。已鉴权客户端可稳定触发 500 与 defect 审计噪音；无数据泄露。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/shared/handlers/fs.ts
+++ b/src/gyccode/server/shared/handlers/fs.ts
@@ -19,3 +19,8 @@
-  const decoded = decodeURIComponent(rawPath)
+  const decoded = yield* Effect.try({
+    try: () => decodeURIComponent(rawPath),
+    catch: () => new BadRequest(`invalid uri encoding: ${rawPath}`),
+  })
```

# 问题2：越界路径依赖底层 die 返回 500，未显式映射 403 3级

## 问题2分析:

- 位置：`src/gyccode/server/shared/handlers/fs.ts:12-23`（路径包含性检查失败时依赖底层 `die` 冒泡，而非显式 403）。
- 根因：出根目录路径未在本层做显式拒绝并映射 `Forbidden`，而是让底层以 defect（die）形式炸出，最终表现为 500。语义上「越界访问」应为 403，500 掩盖了真实的访问控制拒绝事件，审计侧无法按 403 归类入侵尝试。
- 对照证据：`filesystem.ts:66-71` 的二次 realpath 已保证越界路径在使用前被拦截（安全有效），缺的仅是错误码映射层。
- 影响：3级。实际越界读写已被底层拦截，不构成数据泄露；问题在错误语义与审计可读性。

### 问题2修复后的代码：

```diff
--- a/src/gyccode/server/shared/handlers/fs.ts
+++ b/src/gyccode/server/shared/handlers/fs.ts
@@ -12,6 +12,9 @@
   const root = yield* workspaceRoot
   const resolved = resolve(root, decoded)
   if (!resolved.startsWith(root)) {
-    return yield* Effect.die(new Error("path escapes root"))
+    return yield* Effect.fail(
+      new Forbidden(`path outside workspace: ${decoded}`),
+    )
   }
   return resolved
```
