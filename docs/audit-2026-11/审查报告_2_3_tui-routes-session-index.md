注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：会话加载 effect 在 await 之后缺少路由失效检查，快速切换会话会产生 workspace/editor 串台竞态 2级
## 问题1分析:
`src/tui/routes/session/index.tsx:313-351` 的 `createEffect` 以 `route.sessionID` 为输入，内部启动一个 async IIFE。Session 组件按 sessionID keyed 重挂载（`src/tui/app.tsx:1949`），但**重挂载不会取消已发起的异步续体**——旧实例闭包里的 await 仍会继续执行。

失效检查只出现在两处：catch 分支（343 行 `if (route.sessionID !== sessionID) return`）与最终滚动（341 行 `if (route.sessionID === sessionID && scroll)`）。中间的写操作全程无防护：

- 317 行 `await sdk.client.session.get(...)` 之后，329 行 `project.workspace.set(result.data.workspaceID)`、336 行 `await sync.bootstrap(...)`、339 行 `editor.reconnect(result.data.directory)`、340 行 `await sync.session.sync(sessionID)` 都会照常执行；
- `previousWorkspace` 在 await 之前（316 行）用 `untrack` 采样，若用户在 A→B 快速切换且两会在不同 workspace，A 的续体可能在 B 已把 workspace 切好之后再次 `workspace.set(A)`，把活动 workspace 改回旧值，并把编辑器重连到 A 的目录；
- 该 effect 内也没有任何 AbortSignal/onCleanup 取消机制，属于典型的「stale closure 越权写全局状态」竞态。

### 问题1修复后的代码：
```diff
       const result = await sdk.client.session.get({ sessionID }, { throwOnError: true })
+      // 挂载后路由可能已切走：本实例的异步续体不会被取消，
+      // 后续 workspace/editor/sync 写操作必须先做失效检查。
+      if (route.sessionID !== sessionID) return
       if (!result.data) {
         toast.show({
           message: `未找到会话: ${sessionID}`,
           variant: "error",
           duration: 5000,
         })
         navigate({ type: "home" })
         return
       }
 
       if (result.data.workspaceID !== previousWorkspace) {
         project.workspace.set(result.data.workspaceID)
 
         // Sync all the data for this workspace. Note that this
         // workspace may not exist anymore which is why this is not
         // fatal. If it doesn't we still want to show the session
         // (which will be non-interactive)
         try {
           await sync.bootstrap({ fatal: false })
         } catch { /* 非致命：workspace 可能已删除，会话降级为不可交互 */ }
+        if (route.sessionID !== sessionID) return
       }
       editor.reconnect(result.data.directory)
       await sync.session.sync(sessionID)
       if (route.sessionID === sessionID && scroll) scroll.scrollBy(100_000)
```
---
# 问题2：滚动类命令直接解引用尚未挂载的 scroll 句柄，与同文件其他路径的判空守卫不一致 3级
## 问题2分析:
`src/tui/routes/session/index.tsx:375` 声明 `let scroll: ScrollBoxRenderable`（无初始值），仅当 `<Show when={session()}>`（1561 行）渲染出 scrollbox 后才由 ref（1563 行）赋值。而 `sessionCommandList` 注册的滚动命令在组件挂载时即绑入键位（1424-1436 行 `useBindings`），在 `session()` 尚未从 sync 数据解析出来的加载窗口内触发会直接对 `undefined` 调方法：

- `session.page.up`：884 行 `scroll.scrollBy(-scroll.height / 2)`；
- `session.page.down`：894 行；`session.line.up/down`：904/914 行；
- `session.half.page.up/down`：924/934 行；`session.first/last`：944/954 行；
- `session.message.next/prev` 经 `scrollToMessage`（508 行）→ 478 行 `scroll.getChildren()`、512 行 `scroll.scrollBy(...)` 同样无判空。

同文件其他路径均已按「`if (!scroll || scroll.isDestroyed) return`」防护（520、529、531 行 scheduleScrollFix 回调内），唯独命令路径遗漏。触发时 TypeError 会从键位命令栈抛出，错误传播取决于 keymap 分发器是否兜底，最坏情况直达 `uncaughtException`（`src/tui/app.tsx:513`）触发降级退出。

### 问题2修复后的代码：
```diff
   const keymap = useGyccodeKeymap()
   const dialog = useDialog()
   const renderer = useRenderer()
+
+  // scrollbox 仅在 session() 就绪后才挂载（1561 行 Show），
+  // 加载窗口内键位命令可能先于 ref 赋值触发，统一在此收口判空。
+  const scrollGuard = () => scroll !== undefined && !scroll.isDestroyed
```
8 处命令统一改为 guarded 调用，以 page.up/down 为例（line/half.page/first/last 同法）：
```diff
       run: () => {
-        scroll.scrollBy(-scroll.height / 2)
+        if (!scrollGuard()) return
+        scroll.scrollBy(-scroll.height / 2)
         dialog.clear()
       },
```
```diff
       run: () => {
-        scroll.scrollBy(scroll.height / 2)
+        if (!scrollGuard()) return
+        scroll.scrollBy(scroll.height / 2)
         dialog.clear()
       },
```
`findNextVisibleMessage` 入口补同一守卫：
```diff
   const findNextVisibleMessage = (direction: "next" | "prev"): string | null => {
+    if (!scrollGuard()) return null
     const children = scroll.getChildren()
```
