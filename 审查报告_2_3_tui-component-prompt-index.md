注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：pasteAttachment 用 UTF-16 length 计算 extmark 结束偏移，与同文件 promptOffsetWidth 口径不一致，粘贴图片占位符提交时文本错位 2级
## 问题1分析:
Prompt 的 textarea 偏移按**显示宽度**计数（`src/tui/prompt/display.ts:8` 注释明确「Textarea offsets count newlines as one position」）。同文件两条粘贴路径口径却不一致：

- `pasteText`（`src/tui/component/prompt/index.tsx:1234`）：`const extmarkEnd = extmarkStart + promptOffsetWidth(virtualText)` —— 显示宽度口径，正确；
- `pasteAttachment`（`src/tui/component/prompt/index.tsx:1316`）：`const extmarkEnd = extmarkStart + virtualText.length` —— UTF-16 code unit 长度口径。

图片占位符为 `[图片 N]`（1315 行），`图`/`片` 各为 1 个 code unit 但显示宽度 2：`virtualText.length` 比显示宽度少 2，extmark 的 end 偏移被截短。该 extmark 随后写入 store（1344-1350 行）并在提交时参与 `expandTrackedPastedText`（1099-1107 行，按 `extmark.start/end` 定位虚拟文本做真实内容替换）——end 错位会使替换范围偏移，表现为粘贴图片后提交时占位符残留或正文被截断。`[PDF N]` 全 ASCII 时 length 与显示宽度恰好相等，故该缺陷仅在中文占位符路径暴露，具有隐蔽性。

### 问题1修复后的代码：
```diff
   async function pasteAttachment(file: { filename?: string; filepath?: string; content: string; mime: string }) {
     const currentOffset = input.cursorOffset
     const extmarkStart = currentOffset
     const pdf = file.mime === "application/pdf"
     const count = store.prompt.parts.filter((x) => {
       if (x.type !== "file") return false
       if (pdf) return x.mime === "application/pdf"
       return x.mime.startsWith("image/")
     }).length
     const virtualText = pdf ? `[PDF ${count + 1}]` : `[图片 ${count + 1}]`
-    const extmarkEnd = extmarkStart + virtualText.length
+    // textarea 偏移按显示宽度计数（与 pasteText/promptOffsetWidth 同口径），
+    // [图片 N] 含全角字符，用 length 会把 end 截短导致提交时占位符替换错位。
+    const extmarkEnd = extmarkStart + promptOffsetWidth(virtualText)
     const textToInsert = virtualText + " "
```
---
# 问题2：submitInner 在两个 await 之后不再复查 input 存活，卸载竞态下操作已销毁的 textarea 3级
## 问题2分析:
`src/tui/component/prompt/index.tsx` 的 `submitInner` 在入口有存活守卫（1026 行 `if (input && !input.isDestroyed && ...)`），但之后跨越了两个 await 点：1069 行 `await move.getDirectory(...)`、1073 行 `await sdk.client.session.create(...)`。Prompt 按 sessionID 随 Session 重挂载（`src/tui/app.tsx:1949` keyed Show），await 期间若路由切换（如快捷切换键、`session.deleted` 事件导航），续体会继续执行并操作已销毁的渲染器：

- 1101 行 `input.extmarks.getAllForTypeId(promptPartTypeId)`；
- 1226 行 `input.clear()`；
- 1208 行 `input.extmarks.clear()`。

同文件对「组件按 sessionID 重挂载」已有明确认知并多处加了守卫（447-454 行 interruptResetTimer 注释、264-270 行 prompt.append 的 `isDestroyed` 检查），此处属遗漏。当前未观测到崩溃是因为销毁后属性访问多为惰性失效，但这是依赖渲染器实现细节的偶然安全，健壮性上应补齐与 1026 行一致的复查。

### 问题2修复后的代码：
```diff
       sessionID = res.data.id
     }
+
+    // 跨越 await 后组件可能已随会话切换卸载（Prompt 按 sessionID 重挂载），
+    // 与入口 1026 行同口径复查，避免操作已销毁的 textarea。
+    if (!input || input.isDestroyed) return false
 
     const inputText = expandTrackedPastedText(
       store.prompt.input,
```
---
# 问题3：会话创建失败仅裸 console.log，与全仓 logError 收敛约定不一致 3级
## 问题3分析:
`src/tui/component/prompt/index.tsx:1086`：`console.log("Creating a session failed:", res.error)`。仓库已将裸 console 统一替换为 `logError`（同文件 1195 行发送提示词失败即走 `logError("tui.prompt", ...)` 并带 `session.id` 归因），本处是漏网之鱼：toast 文案（1089 行）提示「打开控制台查看详细信息」，但 `console.log` 不进 `gyccode.log` 审计链路，失败原因（尤其 res.error 的结构化字段）无法事后检索归因。

### 问题3修复后的代码：
```diff
       if (res.error) {
         if (finishMoveProgress) move.finishSubmit()
-        console.log("Creating a session failed:", res.error)
+        logError("tui.prompt", res.error, { op: "session.create" })
 
         toast.show({
           message: "创建会话失败。打开控制台查看详细信息。",
           variant: "error",
         })
```
---
# 问题4：新建会话提交后的 50ms navigate 定时器无卸载守卫（代码注释自认 temporary hack）3级
## 问题4分析:
`src/tui/component/prompt/index.tsx:1216-1225`：`// temporary hack to make sure the message is sent` 之后 `setTimeout(() => route.navigate({ type: "session", sessionID }), 50)`。该定时器：

1. 未保存句柄、未在 `onCleanup`（699-706 行）中清除——组件在 50ms 内卸载（如用户立即快捷切换会话）后回调仍会执行；
2. 无 `route` 当前状态复查——若用户在这 50ms 内已导航到别处，回调会把界面强行拉回刚创建的会话，覆盖用户意图。

同文件其他延时路径均有守卫：264-270 行 prompt.append 的 `setTimeout` 带 `input.isDestroyed` 检查、1299-1303 行粘贴刷新同理、interruptResetTimer 在 onCleanup 清理（700 行）。此处为唯一无守卫的延时导航。

### 问题4修复后的代码：
```diff
     // temporary hack to make sure the message is sent
     if (!props.sessionID) {
       if (editorParts.length > 0) editor.preserveSelectionFromNewSession()
-      setTimeout(() => {
-        route.navigate({
-          type: "session",
-          sessionID,
-        })
-      }, 50)
+      const navigateTimer = setTimeout(() => {
+        // 卸载后不再导航；sessionID 为空说明组件已重挂载到新会话场景，跳过
+        if (input?.isDestroyed) return
+        route.navigate({
+          type: "session",
+          sessionID,
+        })
+      }, 50)
+      pendingNavigateTimer = navigateTimer
     }
```
配套在组件顶部声明句柄并在 onCleanup 清理：
```diff
   let input: TextareaRenderable
   let anchor: BoxRenderable
   let interruptResetTimer: ReturnType<typeof setTimeout> | undefined
+  let pendingNavigateTimer: ReturnType<typeof setTimeout> | undefined
```
```diff
   onCleanup(() => {
     if (interruptResetTimer) clearTimeout(interruptResetTimer)
+    if (pendingNavigateTimer) clearTimeout(pendingNavigateTimer)
     if (store.prompt.input && props.sessionID !== undefined) {
       stashDraft(props.sessionID, { prompt: unwrap(store.prompt), cursor: input.cursorOffset })
     }
     setInputTarget(undefined)
     props.ref?.(undefined)
   })
```
