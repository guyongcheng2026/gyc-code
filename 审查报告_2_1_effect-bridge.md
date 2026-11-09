# 问题1：wrap 用 as 断言把未被 ctx 满足的 R 强转 never，依赖缺失从编译错误降级为运行时 defect 3级

## 问题1分析:
`bridge.ts:61` 的 `wrap` 将 `effect.pipe(Effect.provide(ctx))` 断言为 `Effect.Effect<A, E, never>`。`ctx` 是 `bridge.ts:56` `Effect.context()` 在 `make()` 调用点捕获的运行时上下文；而 `Shape` 接口（`bridge.ts:7-12`）的 `promise`/`fork`/`run` 均接受任意 `R`。当调用方传入依赖 **ctx 中不存在** 的 service 的 effect 时，`Effect.provide(ctx)` 后的剩余需求实际非 `never`，但 `as` 断言（never 是任意类型的子类型，断言恒通过）将其掩盖：

- 编译期：不报错（`bridge.ts:8-10` 签名允许任何 R）；
- 运行期：在 `bridge.ts:65/67/71/79` 的 `Effect.runPromise`/`runFork`/`runPromiseExit`/`runSync` 中以 "Service not found" 缺陷失败，`promise` 路径 reject 为包裹 Cause 的 `FiberFailure`，JS 调用方（如 `mcp/index.ts:539`、`provider/provider.ts:1716`、`command/index.ts:150`）难以定位是缺依赖。

属类型不安全（3 级）：编译器本可拦截的错误被断言降级为运行时缺陷。影响面：`EffectBridge` 共 14 个引用文件，但只有传入依赖超出 `make()` 时 ctx 覆盖范围的调用点会被收窄后的签名逼出编译错误——这正是期望行为；ctx 已覆盖的调用（`Exclude<R, R_ctx>` 为 `never`）不受影响。

### 问题1修复后的代码：
```diff
 export interface Shape {
-  readonly promise: <A, E, R>(effect: Effect.Effect<A, E, R>) => Promise<A>
-  readonly fork: <A, E, R>(effect: Effect.Effect<A, E, R>) => Fiber.Fiber<A, E>
-  readonly run: <A, E, R>(effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E>
+  readonly promise: <A, E>(effect: Effect.Effect<A, E, never>) => Promise<A>
+  readonly fork: <A, E>(effect: Effect.Effect<A, E, never>) => Fiber.Fiber<A, E>
+  readonly run: <A, E>(effect: Effect.Effect<A, E, never>) => Effect.Effect<A, E>
   readonly bind: <Args extends readonly unknown[], Result>(fn: (...args: Args) => Result) => (...args: Args) => Result
 }
@@
     const wrap = <A, E, R>(effect: Effect.Effect<A, E, R>) =>
-      attachWith(effect.pipe(Effect.provide(ctx)) as Effect.Effect<A, E, never>, { instance, workspace })
+      attachWith(effect.pipe(Effect.provide(ctx)), { instance, workspace })
```
接口收窄后调用点的 `R` 被约束为 `never`，`wrap` 内 `Effect.provide(ctx)` 的推导结果必为 `never`，断言失去存在意义，依赖未满足在调用点编译期暴露。

---
## 核查要点（未列为问题）
- `bridge.ts:14-17`/`bridge.ts:48-52` 的 `restoreWorkspace` 对 `undefined` workspace 直接透传，`WorkspaceRef`（`instance-ref.ts:9-11`）带 defaultValue，`yield*` 不会失败，无错误通道问题。
- `bridge.ts:27-38` 模块级 `bind` 创建时 `captureSync()`（`bridge.ts:19-25`）快照上下文，`getReferenceUnsafe` 缺失时返回默认值不抛错（effect 源码 `Context.ts:1518`），无竞态。
- `bridge.ts:68-75` `run` 经 `Effect.runPromiseExit`（永不 reject 的 Promise）+ `.then(resume)` 恢复，成功/失败/中断三态均映射到 `resume`，无挂起路径；内层 fiber 与调用方中断未联动属 Effect.callback 既有语义，把握不足不列问题。
