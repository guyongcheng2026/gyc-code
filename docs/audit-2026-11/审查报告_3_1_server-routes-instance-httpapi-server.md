注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：rootApiRoutes 与 instanceRoutes 未挂 rateLimitLayer，/session、/file、authSet 等路由无令牌桶限流 2级

## 问题1分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/server.ts:147-151`（rootApiRoutes 组装）、`src/gyccode/server/routes/instance/httpapi/server.ts:180-182`（instanceRoutes 组装）。
- 对照证据：同层 event 路由装配处 `event:154` 已挂 `rateLimitLayer`，本文件 `server.ts:186` 亦挂载了限流层——令牌桶是该层路由的标准防护，root/instance 两组被漏挂。
- 根因：组装 rootApiRoutes、instanceRoutes 时未套 `rateLimitLayer`，`/session`、`/file`、`authSet` 等端点直通 handler，无每令牌桶速率限制。
- 影响：2级。请求仍受 `server.ts:181` 鉴权层约束（非匿名可达），但已认证客户端可高频调用上述端点，造成资源耗尽、会话枚举与日志刷盘放大；属防护缺失，非直接越权。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/server.ts
+++ b/src/gyccode/server/routes/instance/httpapi/server.ts
@@ -147,7 +147,7 @@
-  const rootApiRoutes = Router.merge(
+  const rootApiRoutes = rateLimitLayer(Router.merge(
     authSetRoutes,
     sessionRoutes,
     fileRoutes,
-  )
+  ))
@@ -180,3 +180,3 @@
-  const instanceRoutes = Router.merge(
+  const instanceRoutes = rateLimitLayer(Router.merge(
     ...handlers
-  )
+  ))
```
