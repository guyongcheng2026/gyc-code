注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：log 端点透传客户端 message/extra 注入日志，且 level 兜底 error 2级

## 问题1分析:

- 位置：`src/gyccode/server/routes/instance/httpapi/handlers/control.ts:28-39`（`log` handler 将客户端 `message`、`extra` 原样写入日志，`level` 非法时兜底为 `error`）。
- 根因：
  1. **日志注入**：`message`/`extra` 未做长度截断与字段清洗即落盘，攻击者可伪造看似服务端产生的审计记录（伪造审计），或写入超大 payload 刷爆审计表（刷盘放大）；
  2. **级别污染**：`level` 兜底 `error` 而非 `info`，任意无效级别请求都会制造 error 级告警，污染错误审计表的可信度并触发误报。
- 对照证据：审计表本就无 severity 列、级别寄生 `fields.level`（log-error.ts:33 自认权宜），客户端可写级别会进一步破坏级别索引的可信性。
- 影响：2级。审计完整性受损（伪造/污染）与日志存储放大；端点仍受鉴权层保护，非未授权访问。

### 问题1修复后的代码：

```diff
--- a/src/gyccode/server/routes/instance/httpapi/handlers/control.ts
+++ b/src/gyccode/server/routes/instance/httpapi/handlers/control.ts
@@ -28,12 +28,16 @@
 export const log = (input: LogInput) =>
   Effect.gen(function* () {
-    const level = input.level ?? "error"
-    yield* writeAuditLog({ level, message: input.message, extra: input.extra })
+    const level = VALID_LEVELS.includes(input.level) ? input.level : "info"
+    const message = String(input.message).slice(0, MAX_LOG_MESSAGE_LEN)
+    const extra = sanitizeExtra(input.extra)
+    yield* writeAuditLog({
+      level,
+      message: `[client] ${message}`,
+      extra,
+    })
     return yield* Effect.void
   })
+
+const VALID_LEVELS = ["debug", "info", "warn", "error"] as const
+const MAX_LOG_MESSAGE_LEN = 2000
```
