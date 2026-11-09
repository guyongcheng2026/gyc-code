# 问题1：makeRuntime 全仓无调用方且 ManagedRuntime 无 dispose 通道，与 core 重复的死代码 3级

## 问题1分析:
`run-service.ts:33-47` 导出的 `makeRuntime` 在整个仓库（`src` + 测试）中**没有任何调用方**：rg 两轮核查显示，全部 `makeRuntime(...)` 调用点——`core/npm.ts:15/289`、`gyccode/config/tui.ts:20/264`、`gyccode/installation/index.ts:12/342`、`cli/cmd/debug/scrap.ts:11-12`——均导入自 `@gyccode/core/effect/runtime`（实现位于 `core/effect/runtime.ts:5`）。`run-service` 本身仅被两处引用：`effect/app-runtime.ts:2`（`attach`）与 `effect/bridge.ts:5`（`attachWith`），均未触及 `makeRuntime`。

该函数除死代码外还携带一个隐患模式：`run-service.ts:34-35` 惰性创建 `ManagedRuntime`（`rt ??=`）但**不暴露任何 dispose 方法**，一旦未来被启用，`Observability.layer` 等 Layer 资源将无法释放；对照 `effect/app-runtime.ts:184-185`，主运行时显式持有 `rt` 并通过 `Pick<..., "dispose">` 对外暴露释放通道，本函数与该既有约定不一致。按极简主义铁律（未使用代码必须清理）删除死代码，同时消除与 `core/effect/runtime.ts:5` 的重复实现。

### 问题1修复后的代码：
```diff
-import { Effect, Fiber, Layer, ManagedRuntime } from "effect"
-import * as Context from "effect/Context"
+import { Effect, Fiber } from "effect"
 import { InstanceRef, WorkspaceRef } from "./instance-ref"
-import * as Observability from "@gyccode/core/observability"
 import { WorkspaceContext } from "@/control-plane/workspace-context"
 import type { InstanceContext } from "@/project/instance-context"
-import { memoMap } from "@gyccode/core/effect/memo-map"
@@
-export function makeRuntime<I, S, E>(service: Context.Service<I, S>, layer: Layer.Layer<I, E>) {
-  let rt: ManagedRuntime.ManagedRuntime<I, E> | undefined
-  const getRuntime = () => (rt ??= ManagedRuntime.make(Layer.provideMerge(layer, Observability.layer), { memoMap }))
-
-  return {
-    runSync: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => getRuntime().runSync(attach(service.use(fn))),
-    runPromiseExit: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) =>
-      getRuntime().runPromiseExit(attach(service.use(fn)), options),
-    runPromise: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>, options?: Effect.RunOptions) =>
-      getRuntime().runPromise(attach(service.use(fn)), options),
-    runFork: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) => getRuntime().runFork(attach(service.use(fn))),
-    runCallback: <A, Err>(fn: (svc: S) => Effect.Effect<A, Err, I>) =>
-      getRuntime().runCallback(attach(service.use(fn))),
-  }
-}
```
`attach`/`attachWith`（`run-service.ts:14-31`）及全部现有调用方不受影响。
