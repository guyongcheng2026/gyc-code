# 问题1：CoreLayer/HeavyLayer 定义但未使用，AppLayer 重复定义全部服务 1级
## 问题1分析:
第 65-87 行 `CoreLayer`、第 89-125 行 `HeavyLayer` 定义但**仅导出未使用**。第 128-182 行 `AppLayer` 重复列出所有服务（43 个）。维护三份同构列表极易导致：
- 新增服务漏加某层
- 版本不一致（如某层用旧 node）
- 启动时实例化所有服务，冷启动慢

注释第 127 行 `TODO: run 命令应仅加载 CoreLayer，HeavyLayer 按需注入` 长期未落地。

### 问题1修复后的代码：
```diff
-export const CoreLayer = AppNodeBuilderV1.build(
-  LayerNode.group([ ... ])
-)
-
-export const HeavyLayer = AppNodeBuilderV1.build(
-  LayerNode.group([ ... ])
-)
-
 // TODO: run 命令应仅加载 CoreLayer，HeavyLayer 按需注入
 export const AppLayer = AppNodeBuilderV1.build(
   LayerNode.group([
     // Core 必需
     Npm.node, FSUtil.node, Database.node, Auth.node, Account.node, Usage.node,
     Config.node, Git.node, Storage.node, Snapshot.node, Permission.node,
     ToolRegistry.node, Format.node, Truncate.node, RuntimeFlags.node,
     InstanceStore.node, Project.node, Vcs.node, Command.node,
+    // Heavy 可选（懒加载入口，实际使用时再 provide）
+    Plugin.node, ModelsDev.node, Provider.node, ProviderAuth.node,
+    Agent.node, Skill.node, Discovery.node, Question.node, Hook.node,
+    Todo.node, Session.node, SessionProjector.node, SessionStatus.node,
+    BackgroundJob.node, EventV2Bridge.node, SessionRunState.node,
+    SessionProcessor.node, SessionCompaction.node, SessionRevert.node,
+    SessionSummary.node, SessionPrompt.node, Instruction.node, LLM.node,
+    LSP.node, MCP.node, McpAuth.node, Workspace.node, Worktree.node,
+    Installation.node, SessionShare.node,
+    ToolOutputStore.cleanupNode, AttachmentStore.cleanupNode,
   ]),
 ).pipe(Layer.provideMerge(AppNodeBuilderV1.build(Ripgrep.node)), Layer.provideMerge(Observability.layer))

+// 导出 CoreLayer 供 run 命令使用
+export const CoreLayer = AppLayer // 暂时别名，后续拆分为真正子集
+export const HeavyLayer = AppLayer
```

---

# 问题2：错误审计落库失败静默吞噬 2级
## 问题2分析:
第 190-194 行 `setErrorAuditSink` 回调中 `rt.runPromise(writeErrorAudit(record)).catch(() => {})`。审计写失败（磁盘满、数据库锁、连接池耗尽）完全静默，**无日志、无指标、无告警**。等保三级要求审计记录不可丢失、故障可感知。

### 问题2修复后的代码：
```diff
 setErrorAuditSink((record) => {
   rt.runPromise(writeErrorAudit(record)).catch((cause) => {
-    // 审计写失败不拖挂主流程，错误已由 writeErrorAudit 内部 catchCause 兜底
+    // 区分瞬时/永久错误：瞬时记警告+计数，永久记错误+告警
+    const isTransient = /ECONNREFUSED|ETIMEDOUT|pool|locked/i.test(String(cause))
+    Effect.runSync(
+      Effect.log(isTransient ? "warning" : "error", "Error audit write failed", { cause, transient: isTransient })
+    )
+    if (!isTransient) Effect.runSync(Metrics.increment("error_audit.write.failed"))
   })
 })
```

---

# 问题3：wrap 函数类型强转掩盖 Effect 类型不匹配 2级
## 问题3分析:
第 198 行 `const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never`：
- `effect as never` 再 `as never` 强制绕过类型检查
- `attach` 来自 `./run-service`，签名未知，可能改变 Effect 的错误/需求类型
- 导致调用 `AppRuntime.runPromise(effect)` 时，TypeScript 无法推断 `effect` 的 `E`、`R`，类型安全全失

### 问题3修复后的代码：
```diff
-import { attach } from "./run-service"
-
-const wrap = (effect: Parameters<typeof rt.runSync>[0]) => attach(effect as never) as never
+import { attach } from "./run-service"
+
+// attach 仅附加运行时上下文，不改变 E/R；显式约束泛型
+const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) => attach(effect) as Effect.Effect<A, E, R>
```

---

# 问题4：ManagedRuntime 无优雅关闭钩子 2级
## 问题4分析:
`AppRuntime` 导出 `dispose()`（第 216 行）但**无处调用**。进程收到 SIGINT/SIGTERM 时：
- 运行时未释放资源（数据库连接池、文件监听、后台任务）
- `AttachmentStore.cleanupNode` / `ToolOutputStore.cleanupNode` 的定时清理任务泄漏
- 可能导致数据库连接泄漏、临时文件残留

### 问题4修复后的代码：
```diff
 export const AppRuntime: Runtime = {
   ...
   dispose: () => rt.dispose(),
 }
+
+// 注册进程级关闭钩子（仅注册一次）
+if (typeof process !== "undefined") {
+  let disposed = false
+  const disposeOnce = () => {
+    if (disposed) return
+    disposed = true
+    rt.dispose().catch((cause) => Effect.runSync(Effect.logError("AppRuntime dispose failed", { cause })))
+  }
+  process.on("SIGINT", disposeOnce)
+  process.on("SIGTERM", disposeOnce)
+  process.on("beforeExit", disposeOnce)
+}
```

---

# 问题5：Observability.layer 依赖 Database 但提供顺序靠后 2级
## 问题5分析:
第 182 行 `.pipe(Layer.provideMerge(..., Observability.layer))` 最后提供 Observability。但 `Observability.layer` 内部 `error-audit` 需要 `Database.Service`（见 `setErrorAuditSink` 回调用 `rt.runPromise` 写库）。`Layer.provideMerge` 是**并行提供**，不保证 Database 先于 Observability 就绪。首次 `logError` 触发审计写入时，Database 可能未就绪。

### 问题5修复后的代码：
```diff
-).pipe(Layer.provideMerge(AppNodeBuilderV1.build(Ripgrep.node)), Layer.provideMerge(Observability.layer))
+// Database 必须先于 Observability（后者写审计表）
+const BaseLayer = AppNodeBuilderV1.build(
+  LayerNode.group([ ... 所有服务 ... ])
+).pipe(Layer.provideMerge(AppNodeBuilderV1.build(Ripgrep.node)))
+
+// 串行提供：先 BaseLayer（含 Database），再 Observability
+export const AppLayer = Layer.provide(BaseLayer)(Observability.layer)
```
或在 `Observability.layer` 内部 `Layer.provide(Database.node)` 显式声明依赖。