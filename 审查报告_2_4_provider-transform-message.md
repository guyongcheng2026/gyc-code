注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：Mistral 系 toolCallId 截断为 9 位并补零，不同调用 ID 可碰撞 <2>级
## 问题1分析:
transform.message.ts:151-156 对 Mistral 系模型的 toolCallId 执行 `replace(/[^a-zA-Z0-9]/g,"") → substring(0,9) → padEnd(9,"0")`：
1. **截断碰撞**：两个不同调用 ID（如 `call_abc123XYZ99` 与 `call_abc123XYZ11`，去除非字母数字后前 9 位相同）被压成同一 ID，assistant 的 tool-call 与 tool 消息的 tool-result 配对错乱，工具结果回传给错误的调用，模型据此继续推理会产生错误动作；
2. **补零碰撞**：长度不足 9 的 ID（`ab` 与 `ab0`）经 `padEnd(9,"0")` 后同为 `ab0000000`，同样错配；
3. 去除非字母数字后 ID 长度进一步缩短（`call_xxx` 的下划线被删），碰撞面比单纯截断更大。

### 问题1修复后的代码：
```diff
--- a/src/gyccode/provider/transform.message.ts
+++ b/src/gyccode/provider/transform.message.ts
@@ -148,12 +148,17 @@
     ["mistral", "devstral", "codestral", "pixtral", "mixtral"].some((family) => modelID.includes(family))
   ) {
-    const scrub = (id: string) => {
-      return id
-        .replace(/[^a-zA-Z0-9]/g, "") // Remove non-alphanumeric characters
-        .substring(0, 9) // Take first 9 characters
-        .padEnd(9, "0") // Pad with zeros if less than 9 characters
-    }
+    // 截断+补零会让不同 toolCallId 碰撞，导致 tool-result 配错调用。
+    // 改为仅做字符集清洗并保留原长度；Mistral 侧由 SDK/上游兼容处理超长 ID。
+    const scrub = (id: string) => id.replace(/[^a-zA-Z0-9]/g, "")
     const result: ModelMessage[] = []
```

---
# 问题2：unsupportedParts 对 URL 形式附件解析不出 mime，绕过模型能力检查 <3>级
## 问题2分析:
transform.message.ts:300 用 `String(part.image).split(";")[0].replace("data:", "")` 提取 mime，该逻辑只对 `data:image/png;base64,...` 形式有效。AI SDK 的 image/file part 允许直接给 URL（`https://...`），此时提取结果是整个 URL，`mimeToModality`（transform.shared.ts:6-12）返回 undefined，transform.message.ts:303 `if (!modality) return part` 直接放行——transform.message.ts:304 的模型输入能力检查被完全绕过，不支持图片的模型收到 URL 图片后由上游 API 报 400，用户看到的是与原因无关的上游错误。

### 问题2修复后的代码：
```diff
--- a/src/gyccode/provider/transform.message.ts
+++ b/src/gyccode/provider/transform.message.ts
@@ -297,11 +297,18 @@
         }
       }
 
-      const mime = part.type === "image" ? (String(part.image).split(";")[0] ?? "").replace("data:", "") : part.mediaType
+      const raw = String(part.image)
+      const mime = part.type === "image"
+        ? raw.startsWith("data:")
+          ? (raw.split(";")[0] ?? "").replace("data:", "")
+          // URL 形式附件：从路径推断 mime，推断不出时按 image 模态走能力检查。
+          : (raw.split("?")[0]?.split(".").pop() ?? "") !== ""
+            ? `image/${raw.split("?")[0]?.split(".").pop()}`
+            : "image"
+        : part.mediaType
       const filename = part.type === "file" ? part.filename : undefined
       const modality = mimeToModality(mime)
       if (!modality) return part
```

---
# 问题3：applyCaching 原地变异传入消息的 providerOptions，污染调用方共享消息 <3>级
## 问题3分析:
transform.message.ts:268 与 transform.message.ts:273 直接对 `lastContent.providerOptions` / `msg.providerOptions` 赋值（`lastContent.providerOptions = mergeDeep(...)`），而 `applyCaching` 收到的 `msgs` 元素多为上游 session 持有的 ModelMessage 引用（sanitizeMessage 各分支均是浅拷贝，content 数组内部 part 对象仍是原引用）。后果：一次 anthropic 请求处理后，cacheControl 标记被永久写进会话消息本体，后续把同一批消息发给其他 provider/模型时残留的 `anthropic.cacheControl`、`openaiCompatible.cache_control` 等键全部跟随序列化发出；若上游对消息做深比较（去重/压缩判断）也会被这些"处理副作用"干扰。

### 问题3修复后的代码：
```diff
--- a/src/gyccode/provider/transform.message.ts
+++ b/src/gyccode/provider/transform.message.ts
@@ -250,6 +250,7 @@
     }
   }
 
+  const patched = new Map<ModelMessage, ModelMessage>()
   for (const msg of unique([...system, ...final])) {
     const useMessageLevelOptions =
       model.providerID === "anthropic" ||
@@ -258,19 +259,21 @@
     const shouldUseContentOptions = !useMessageLevelOptions && Array.isArray(msg.content) && msg.content.length > 0
 
     if (shouldUseContentOptions) {
-      const lastContent = msg.content[msg.content.length - 1]
+      const parts = [...msg.content]
+      const lastContent = parts[parts.length - 1]
       if (
         lastContent &&
         typeof lastContent === "object" &&
         lastContent.type !== "tool-approval-request" &&
         lastContent.type !== "tool-approval-response"
       ) {
-        lastContent.providerOptions = mergeDeep(lastContent.providerOptions ?? {}, providerOptions)
+        parts[parts.length - 1] = { ...lastContent, providerOptions: mergeDeep(lastContent.providerOptions ?? {}, providerOptions) }
+        patched.set(msg, { ...msg, content: parts } as ModelMessage)
         continue
       }
     }
 
-    msg.providerOptions = mergeDeep(msg.providerOptions ?? {}, providerOptions)
+    patched.set(msg, { ...msg, providerOptions: mergeDeep(msg.providerOptions ?? {}, providerOptions) })
   }
 
-  return msgs
+  return msgs.map((m) => patched.get(m) ?? m)
 }
```
