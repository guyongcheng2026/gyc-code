import type { TuiDispose, TuiPluginApi, TuiRouteDefinition } from "@gyccode/protocol/plugin/tui"
import { createSignal } from "solid-js"

type RouteEntry = {
  key: symbol
  render: TuiRouteDefinition["render"]
}

export type RouteMap = Map<string, RouteEntry[]>

export function createPluginRoutes() {
  const routes: RouteMap = new Map()
  const [revision, setRevision] = createSignal(0)

  return {
    register(list: TuiRouteDefinition[]) {
      const key = Symbol()
      list.forEach((item) => routes.set(item.name, [...(routes.get(item.name) ?? []), { key, render: item.render }]))
      setRevision((value) => value + 1)

      return () => {
        list.forEach((item) => {
          const next = routes.get(item.name)?.filter((entry) => entry.key !== key) ?? []
          if (next.length) {
            routes.set(item.name, next)
            return
          }
          routes.delete(item.name)
        })
        setRevision((value) => value + 1)
      }
    },
    get(name: string) {
      revision()
      return routes.get(name)?.at(-1)?.render
    },
  }
}

export type PluginRoutes = ReturnType<typeof createPluginRoutes>

export function createTuiApi(input: Omit<TuiPluginApi, "lifecycle">): TuiPluginApi & { dispose(): void } {
  // host 级生命周期：与插件级 scope（runtime.ts 的 createPluginScope）不同，
  // 此处承载「TUI 卸载时」的全局清理——abort 所有插件异步 + 执行 host 层注册的
  // 清理函数。此前为空实现（onDispose 返回空函数、signal 永不 abort），插件若
  // 依赖 lifecycle.signal 取消操作或依赖 onDispose 释放资源会静默失效。
  const controller = new AbortController()
  const disposers: Array<TuiDispose> = []
  return {
    ...input,
    lifecycle: {
      signal: controller.signal,
      onDispose(fn) {
        disposers.push(fn)
        return () => {
          const i = disposers.indexOf(fn)
          if (i >= 0) disposers.splice(i, 1)
        }
      },
    },
    // 宿主在卸载时调用：先 abort（取消在途异步），再逆序执行清理（后注册先释放，
    // 与插件 scope 的 dispose 顺序一致）。幂等，重复调用无副作用。
    dispose: () => {
      controller.abort()
      for (const fn of disposers.splice(0).reverse()) fn()
    },
  }
}
