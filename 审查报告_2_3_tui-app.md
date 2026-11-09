注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：installation.update-available 异步事件处理器无 catch，任何 rejection 将升级为致命 unhandledRejection 2级
## 问题1分析:
`src/tui/app.tsx:1863-1909` 注册了 async 事件处理器，内部依次 `await DialogConfirm.show`（1870）、`await sdk.client.global.upgrade`（1890）、`await DialogAlert.show`（1902），全程无 try/catch。

事件派发端 `src/tui/context/sdk.tsx:38-40` 的 `emitter.emit` 为同步 `for (const handler of handlers) handler(event)`，**不消费返回的 Promise**；而 `src/tui/protocol/v2/index.ts:92-97` 的响应拦截器在 content-type 为 text/html 时会直接 `throw new Error(...)`，客户端其他路径也可能产生非 result-tuple 形态的 rejection。

一旦该 handler 内任一 await reject，rejection 直达进程级 `unhandledRejection` 处理器（`src/tui/app.tsx:538-547`）：仅当错误信息命中 `isRecoverableRejection` 白名单（`src/tui/util/crash-classify.ts:13-24`，如 fetch failed/ECONNREFUSED）才记日志继续；**不在白名单内的错误会走 `degrade(reason, 1)` 降级退出**——一个升级提示流程的失败足以把整个 TUI 打回终端。同文件其他 fire-and-forget 调用均使用 `settled(...)` 或显式 `.catch`（如 1195-1201、1219-1229），本处是遗漏。

### 问题1修复后的代码：
```diff
   event.on("installation.update-available", async (evt) => {
-    console.log("installation.update-available", evt)
-    const version = evt.properties.version
-
-    const skipped = kv.get("skipped_version")
-    if (skipped && !isVersionGreater(version, skipped)) return
-
-    const choice = await DialogConfirm.show(
-      dialog,
-      `发现新版本`,
-      `检测到新版本 v${version}，是否立即更新？`,
-      "skip",
-    )
-
-    if (choice === false) {
-      kv.set("skipped_version", version)
-      return
-    }
-
-    if (choice !== true) return
-
-    toast.show({
-      variant: "info",
-      message: `正在更新到 v${version}…`,
-      duration: 30000,
-    })
-
-    const result = await sdk.client.global.upgrade({ target: version })
-
-    if (result.error || !result.data?.success) {
-      toast.show({
-        variant: "error",
-        title: "更新失败",
-        message: "更新失败",
-        duration: 10000,
-      })
-      return
-    }
-
-    await DialogAlert.show(
-      dialog,
-      "更新完成",
-      `已成功更新到 GycCode v${result.data.version}，请重启应用。`,
-    )
-
-    void exit()
+    try {
+      const version = evt.properties.version
+
+      const skipped = kv.get("skipped_version")
+      if (skipped && !isVersionGreater(version, skipped)) return
+
+      const choice = await DialogConfirm.show(
+        dialog,
+        `发现新版本`,
+        `检测到新版本 v${version}，是否立即更新？`,
+        "skip",
+      )
+
+      if (choice === false) {
+        kv.set("skipped_version", version)
+        return
+      }
+
+      if (choice !== true) return
+
+      toast.show({
+        variant: "info",
+        message: `正在更新到 v${version}…`,
+        duration: 30000,
+      })
+
+      const result = await sdk.client.global.upgrade({ target: version })
+
+      if (result.error || !result.data?.success) {
+        toast.show({
+          variant: "error",
+          title: "更新失败",
+          message: "更新失败",
+          duration: 10000,
+        })
+        return
+      }
+
+      await DialogAlert.show(
+        dialog,
+        "更新完成",
+        `已成功更新到 GycCode v${result.data.version}，请重启应用。`,
+      )
+
+      void exit()
+    } catch (error) {
+      // 事件回调返回的 Promise 无人消费（context/sdk.tsx:39），
+      // 收在这里避免升级流程失败升级为 unhandledRejection 触发降级退出。
+      logError("tui.app", error, { op: "installation.update-available" })
+    }
   })
```
---
# 问题2：裸 console.log 残留于 TUI 事件处理器，与全仓 logError 收敛约定不一致 3级
## 问题2分析:
`src/tui/app.tsx:1864` 为 `console.log("installation.update-available", evt)`。仓库已统一以 `logError/logWarn` 替换裸 console 调用，本处为漏网之鱼：renderer 以 `externalOutputMode: "passthrough"` 创建（`src/tui/app.tsx:334`），console 直写 stdout 可能与已渲染的终端帧交织产生花屏噪声；且打印整个 `evt` 对象（完整事件 payload）无级别、无归因字段，不进 `gyccode.log`，事后无从检索。

### 问题2修复后的代码：
```diff
   event.on("installation.update-available", async (evt) => {
-    console.log("installation.update-available", evt)
     const version = evt.properties.version
```
---
# 问题3：GYCCODE_ROUTE 环境变量 JSON.parse 无容错，畸形值直接击穿启动 3级
## 问题3分析:
`src/tui/app.tsx:937`：`initialRoute: process.env.GYCCODE_ROUTE ? JSON.parse(process.env.GYCCODE_ROUTE) : undefined`。对象字面量在渲染树构建时立即求值；若该调试环境变量是残缺 JSON（如手工设置时漏引号），`JSON.parse` 抛 `SyntaxError`。该表达式位于 `ErrorBoundary`（`src/tui/app.tsx:915`）作用域内，错误会被兜底成整屏 `ErrorComponent`——一个仅用于指定初始路由的调试开关导致整个 TUI 无法进入正常使用界面。环境变量属外部输入，应跳过而非致命。

### 问题3修复后的代码：
```diff
+function parseRouteEnv(value: string | undefined) {
+  if (!value) return undefined
+  try {
+    return JSON.parse(value)
+  } catch {
+    // 畸形 GYCCODE_ROUTE 只应跳过初始路由，不应击穿启动
+    return undefined
+  }
+}
+
 export const run = Effect.fn("Tui.run")(function* (input: TuiInput) {
```
以及在 JSX 中替换：
```diff
                       <TuiStartupProvider
                         value={{
-                          initialRoute: process.env.GYCCODE_ROUTE ? JSON.parse(process.env.GYCCODE_ROUTE) : undefined,
+                          initialRoute: parseRouteEnv(process.env.GYCCODE_ROUTE),
                           skipInitialLoading: Boolean(process.env.GYCCODE_FAST_BOOT),
                         }}
                       >
```
---
# 问题4：app.heap_snapshot 在 onSnapshot 缺省时提示「堆快照已写入 undefined」 3级
## 问题4分析:
`src/tui/app.tsx:1549-1557`：`const files = await props.onSnapshot?.()`，而 `TuiInput.onSnapshot` 为可选（`src/tui/app.tsx:196`）。当调用方未注入该回调时 `files` 为 `undefined`，模板字符串 `堆快照已写入 ${files?.join(", ")}` 渲染出「堆快照已写入 undefined」——命令仍可被键位/面板触发（注册于 `src/tui/app.tsx:168`），用户得到一条语义错误的成功提示。

### 问题4修复后的代码：
```diff
         run: async () => {
           const files = await props.onSnapshot?.()
           toast.show({
             variant: "info",
-            message: `堆快照已写入 ${files?.join(", ")}`,
+            message: files?.length
+              ? `堆快照已写入 ${files.join(", ")}`
+              : "当前运行方式不支持堆快照",
             duration: 5000,
           })
           dialog.clear()
         },
```
