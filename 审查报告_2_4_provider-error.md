注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：json() 返回类型被 JSON.parse 的 any 污染，错误解析全链路失去类型检查 <3>级
## 问题1分析:
error.ts:80-95 的 `json()` 无返回类型标注，其中 `JSON.parse(input)`（error.ts:83）在 TypeScript 里返回 `any`，联合 `object`/`undefined` 分支后整个函数推断为 `any`。污染向下传导：
- error.ts:112 `const body = typeof raw?.message === "string" ? (json(raw.message) ?? raw) : raw` —— `raw` 为 `any`，`body` 为 `any`；
- error.ts:118 `switch (body?.error?.code)`、error.ts:142/150 `body?.error?.message` —— 属性路径写错（如把 `error.code` 打成 `error.Code`）编译器不报错，只会在运行期静默 `undefined` 走默认分支；
- error.ts:175-176 `const body = json(input.error.responseBody)` 后 `body?.error?.code === "context_length_exceeded"` 同样无保护。

该文件是全仓错误分类的枢纽（context_overflow 判定直接影响自动压缩重试），却在这里放弃了类型防线；仓库另有 noUncheckedIndexedAccess 门禁与 any 清零约定，此处属漏网。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/error.ts
+++ b/src/gyccode/provider/error.ts
@@ -77,8 +77,8 @@
   }).trim()
 }
 
-function json(input: unknown) {
+function json(input: unknown): Record<string, any> | undefined {
   if (typeof input === "string") {
     try {
       const result = JSON.parse(input)
       // P2 修复：显式排除 null（typeof null === "object"）
-      if (result !== null && typeof result === "object") return result
+      if (result !== null && typeof result === "object") return result as Record<string, any>
       return undefined
     } catch {
       return undefined
     }
   }
-  if (typeof input === "object" && input !== null) {
-    return input
-  }
+  if (typeof input === "object" && input !== null) return input as Record<string, any>
   return undefined
 }
```
（显式标注 `Record<string, any> | undefined` 后，`body?.error?.code` 的可选链与类型收窄恢复编译期保护；若要彻底消灭 any，可再定义 `type ApiErrorBody = { type?: string; error?: { code?: string; message?: string } }` 并在解析点断言。）

---
# 问题2：message() 未截断的 responseBody 直接拼进错误消息，超长/含敏感内容的响应体进入日志与 UI <3>级
## 问题2分析:
error.ts:76 `return \`${msg}: ${e.responseBody}\`` 把**整个原始响应体**拼接到错误消息末尾，仅靠 error.ts:66 的 `/^\s*<!doctype|^\s*<html/i` 过滤 HTML 开头：
1. 网关返回以 `{"error"...}` 开头的大 JSON 错误页（不触发 HTML 分支，error.ts:48-57 的 JSON 解析因缺 `message`/`error` 字段走空）时，数百 KB 的原始体被整体塞进 message；
2. 该 message 会流经 `parseAPICallError`（error.ts:187）进入错误审计表、TUI 错误展示与 `logError`（provider.ts:60、provider.ts:108 同源链路），造成日志膨胀，且响应体可能回显请求头/URL 中的 key 片段；
3. 对比 error.ts:36-41 对空消息的兜底已有节制，此处缺任何长度上限。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/error.ts
+++ b/src/gyccode/provider/error.ts
@@ -73,7 +73,10 @@
       return msg
     }
 
-    return `${msg}: ${e.responseBody}`
+    // 响应体可能极大（网关错误页）且会回显请求细节：只取截断片段进消息。
+    const body = e.responseBody.length > 512 ? `${e.responseBody.slice(0, 512)}…[truncated]` : e.responseBody
+    return `${msg}: ${body}`
   }).trim()
 }
```
