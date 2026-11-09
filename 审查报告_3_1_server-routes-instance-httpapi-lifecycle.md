注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：markInstanceForReload 失败无 catchCause 且阻塞响应 2级

## 问题1分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/lifecycle.ts:35-41`（reload 路径直接 yield `markInstanceForReload`）。
- 对照证据：同文件 dispose 路径 `lifecycle.ts:50-52` 对失败有 `catchCause` 捕获——同属生命周期操作，reload 却缺失同等防御。
- 根因：`markInstanceForReload` 产生缺陷（defect）时未被 `catchCause` 转换，缺陷沿 fiber 冒泡为 500；且该调用同步 yield 于响应链上，reload 失败会阻塞/污染整个 HTTP 响应，而非降级为可处理的业务失败。
- 影响：2级。需已持有有效请求权限才能触发，后果为可用性受损（请求挂起或 500）与错误语义丢失，不直接导致数据越权。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/lifecycle.ts
+++ b/src/gyccode/server/routes/instance/httpapi/lifecycle.ts
@@ -35,7 +35,9 @@
-  const reloaded = yield* markInstanceForReload(instanceId)
+  const reloaded = yield* markInstanceForReload(instanceId).pipe(
+    Effect.catchCause(() => Effect.succeed(false)),
+  )
   if (!reloaded) {
     return yield* Effect.fail(new NotFound(`instance ${instanceId}`))
   }
```
