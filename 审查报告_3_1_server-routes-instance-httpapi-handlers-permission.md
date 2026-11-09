注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：reply 端点无会话绑定，凭 requestID 即可跨会话审批 1级

## 问题1分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/permission.ts:16-37`（`reply` 仅以入参 `requestID` 定位并应答 pending，不校验归属）。
- 对照证据：路由端点 `groups/permission.ts:31-36` 的 `params` 只有 `requestID`——请求链从路由层就未携带会话身份，handler 层自然无法比对归属。
- 根因：pending 审批单在存储侧无「发起会话/用户」绑定校验，任何可达端点的客户端只要猜到/截获他人 `requestID`，即可替其他会话完成 allow/deny 应答，等同跨会话、跨用户审批越权。
- 影响：1级。直接破坏权限审批的授权边界——身份鉴别与访问控制失效，可导致权限规则被恶意批准。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/permission.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/permission.ts
@@ -16,6 +16,12 @@
 export const reply = (sessionId: string) =>
   Effect.gen(function* () {
+    const pending = yield* getPendingPermission(requestID)
+    if (pending.sessionId !== sessionId) {
+      return yield* Effect.fail(
+        new NotFound(`permission request ${requestID}`),
+      )
+    }
     return yield* respondPermission(requestID, decision)
   })
```

# 问题2：list 返回全部 pending，跨会话泄漏 3级

## 问题2分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/permission.ts:12-14`（`list` 直接返回全局 pending 列表，未按会话过滤）。
- 根因：查询未附加会话作用域条件，任意会话调用即可看到其他会话正在等待审批的请求（含 requestID、权限意图等元数据）。
- 对照证据：与问题1同根——pending 集合无会话归属维度（`permission/index.ts:275-278` 全局查找），list 侧也未补过滤。
- 影响：3级。信息面为 pending 元数据（requestID、权限描述），可辅助配合问题1实施跨会话审批，单独泄露量有限。

### 问题2修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/permission.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/permission.ts
@@ -12,3 +12,5 @@
 export const list = (sessionId: string) =>
-  Effect.gen(function* () {
-    return yield* listPendingPermissions()
+  Effect.gen(function* () {
+    const all = yield* listPendingPermissions()
+    return all.filter((p) => p.sessionId === sessionId)
   })
```
