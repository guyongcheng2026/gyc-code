# 问题1：ScopedCache 容量无限，长期运行内存泄漏 1级
## 问题1分析:
第 47 行 `capacity: Number.POSITIVE_INFINITY` 导致缓存永不驱逐。每个不同工作目录调用 `get` 都会缓存一个实例，进程生命周期内单调增长。典型场景：用户在多项目间切换、CI 并行跑多工作区、长期运行的 TUI 服务。

### 问题1修复后的代码：
```diff
     const cache = yield* ScopedCache.make<string, A, E, R>({
-      capacity: Number.POSITIVE_INFINITY,
+      capacity: 32, // 默认保留最近 32 个工作目录实例
+      // 可选：基于访问时间的 LRU 驱逐策略（ScopedCache 内部已实现）
       lookup: () =>
         Effect.gen(function* () {
           return yield* init(yield* context)
         }),
     })
```
或引入配置项 `InstanceStateCacheCapacity` 从 `Config` 读取。

---

# 问题2：disposer 使用 Effect.runPromise 创建新运行时 2级
## 问题2分析:
第 54 行 `registerDisposer((directory) => Effect.runPromise(ScopedCache.invalidate(cache, directory)))`：
- 每次目录变更都 `Effect.runPromise` 启动新运行时，开销大
- 无法复用主运行时的层（Database、Logger 等），`invalidate` 内若有副作用会丢失上下文
- 返回的 `off` 为 `() => void`，`addFinalizer` 中 `Effect.sync(off)` 同步调用，若 `off` 抛异常会卡死 finalizer

### 问题2修复后的代码：
```diff
-    const off = registerDisposer((directory) => Effect.runPromise(ScopedCache.invalidate(cache, directory)))
-    yield* Effect.addFinalizer(() => Effect.sync(off))
+    // 捕获当前运行时，disposer 复用
+    const runtime = yield* Effect.runtime<never>()
+    const off = registerDisposer((directory) => {
+      Effect.runFork(runtime)(ScopedCache.invalidate(cache, directory))
+    })
+    yield* Effect.addFinalizer(() => Effect.sync(() => { off() }))
```
或将 `registerDisposer` 改为接收 `Effect.Effect<void>` 由框架统一调度。

---

# 问题3：缓存键仅目录，忽略项目/配置差异 2级
## 问题3分析:
第 65 行 `ScopedCache.get(self.cache, yield* directory)` 以 `directory` 为键。但 `init` 接收完整 `InstanceContext`（含 `project`、`worktree`、`vcs` 等）。同一目录下：
- 不同项目配置（如 mono-repo 子项目）→ 复用错误实例
- Git worktree 切换 → worktree 变但 directory 不变（若符号链接）→ 缓存命中错误实例

### 问题3修复后的代码：
```diff
-export const make = <A, E = never, R = never>(
-  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
-): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
-  Effect.gen(function* () {
-    const cache = yield* ScopedCache.make<string, A, E, R>({ ... })
-  })
-
-export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
-  Effect.gen(function* () {
-    return yield* ScopedCache.get(self.cache, yield* directory)
-  })
+// 键包含 project.id + worktree，区分同目录不同项目
+const makeCacheKey = (ctx: InstanceContext) => `${ctx.project.id}@${ctx.worktree}`
+
+export const make = <A, E = never, R = never>(
+  init: (ctx: InstanceContext) => Effect.Effect<A, E, R | Scope.Scope>,
+): Effect.Effect<InstanceState<A, E, Exclude<R, Scope.Scope>>, never, R | Scope.Scope> =>
+  Effect.gen(function* () {
+    const cache = yield* ScopedCache.make<string, A, E, R>({ ... })
+  })
+
+export const get = <A, E, R>(self: InstanceState<A, E, R>) =>
+  Effect.gen(function* () {
+    return yield* ScopedCache.get(self.cache, yield* Effect.map(context, makeCacheKey))
+  })
```

---

# 问题4：无 TTL 过期机制，配置变更不生效 3级
## 问题4分析:
缓存条目永不过期。场景：用户修改项目配置（如 `.gyccode/config.json`）、Git 远程变更、权限变更 → 缓存实例仍持有旧配置，需重启进程才能刷新。

### 问题4修复后的代码：
```diff
     const cache = yield* ScopedCache.make<string, A, E, R>({
       capacity: 32,
+      timeToLive: Duration.minutes(30), // 30 分钟未访问自动过期，配合手动 invalidate
       lookup: () => ...
     })
```
`ScopedCache` 支持 `timeToLive` 选项（需确认 Effect 版本），或自行实现定期清理。

---

# 问题5：fallback context 硬编码 ProjectID.global 2级
## 问题5分析:
第 24 行 `id: ProjectID.global`。Layer 构建期、测试、CLI 非项目命令时回退到此上下文。但 `global` 不是合法项目 ID，后续逻辑（如 `Project.node`、VCS 操作）可能误判为真实项目，导致空指针或错误行为。

### 问题5修复后的代码：
```diff
   // Layer 构建期等无 InstanceRef 的场景，回退到当前目录的最小上下文
   const directory = yield* Effect.sync(() => process.cwd())
   return {
     directory,
     worktree: directory,
     project: {
-      id: ProjectID.global,
+      id: ProjectID.make("__fallback__"), // 显式标记为回退，不参与持久化/索引
       worktree: directory,
       vcs: undefined,
       ...
     },
   }
```