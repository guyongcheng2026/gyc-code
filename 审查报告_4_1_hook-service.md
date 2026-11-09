注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度
# 问题1：matcher 直接 new RegExp(h.matcher)，用户可控正则模式，存在 ReDoS 拒绝服务风险 3级
## 问题1分析：
src/gyccode/hook/service.ts:40 `byEvent.filter((h) => !h.matcher || new RegExp(h.matcher).test(input.tool_name!))` 将配置项 `h.matcher` 直接传给 `new RegExp` 并立即 `.test()`。matcher 为用户可控字符串，若构造为 `(a+)+$` 等灾难性回溯模式，正则匹配会阻塞事件循环，导致拒绝服务。
### 问题1修复后的代码：
```diff
-      const matched = input.tool_name
-        ? byEvent.filter((h) => !h.matcher || new RegExp(h.matcher).test(input.tool_name!))
-        : byEvent
+      const safeMatcher = (pattern: string) => {
+        try {
+          const re = new RegExp(pattern)
+          if (re.source.length > 256) return null
+          return re
+        } catch { return null }
+      }
+      const matched = input.tool_name
+        ? byEvent.filter((h) => {
+            if (!h.matcher) return true
+            const re = safeMatcher(h.matcher)
+            return re ? re.test(input.tool_name!) : false
+          })
+        : byEvent
```
