import { GlobalBus } from "@/bus/global"
import { InstanceStore } from "@/project/instance-store"
import { Effect } from "effect"
import { Event } from "./event"

// P0 修复：Disposer Set 永久泄漏
// instance-registry.ts 的 disposers Set 需要在全局清理时清空
function clearDisposers() {
  // 延迟导入避免循环依赖
  return import("@/effect/instance-registry").then(({ disposeInstance }) => disposeInstance(""))
}

export const emitGlobalDisposed = Effect.sync(() =>
  GlobalBus.emit("event", {
    directory: "global",
    payload: {
      type: Event.Disposed.type,
      properties: {},
    },
  }),
)

export const disposeAllInstancesAndEmitGlobalDisposed = Effect.fn("Server.disposeAllInstancesAndEmitGlobalDisposed")(
  function* (options?: { swallowErrors?: boolean }) {
    const store = yield* InstanceStore.Service
    yield* Effect.gen(function* () {
      yield* options?.swallowErrors
        ? store.disposeAll().pipe(Effect.catchCause((cause) => Effect.logWarning("global disposal failed", { cause })))
        : store.disposeAll()
      // P0 修复：清理 instance-registry 的 Disposer Set
      const { disposers } = yield* Effect.promise(() => import("@/effect/instance-registry"))
      disposers.clear()
      yield* emitGlobalDisposed
    }).pipe(Effect.uninterruptible)
  },
)

export * as GlobalLifecycle from "./global-lifecycle"
