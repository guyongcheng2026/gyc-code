import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"
import { useSDK } from "./sdk"
import { logError } from "@core/observability/log-error"
import { fromTuiAutoFlag, type PermissionMode } from "@/permission/modes"

// R-1：此前这里另有一份 `"auto" | "normal"` 的平行类型，与 permission/modes.ts
// 的四模式同名不同义，两套系统互不相连。现统一到 modes.ts 的 PermissionMode。
export type { PermissionMode }

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const sdk = useSDK()
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: fromTuiAutoFlag(args.auto),
    })
    // 本地 store 只驱动界面显示，后端 Permission.mode() 才是权限裁决的真实来源。
    // 此前只改本地 store，后端 setMode 零调用点、mode() 恒为 default，
    // 于是 --auto 与界面上的模式切换对真实裁决毫无影响。每次变更都同步给后端。
    const sync = (mode: PermissionMode) => {
      void sdk.client.tui
        .executeCommand({ command: `permission.mode:${mode}` })
        .catch((error) => logError("tui.permission", error, { mode }))
    }
    // 启动时就把 --auto/--yolo 推导出的初始模式推给后端，
    // 否则首轮请求已经按 default 裁决完毕，开关形同虚设。
    sync(store.mode)
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
        sync(mode)
      },
      // UI 用的布尔视图：只有 bypassPermissions 算「自动批准」
      get auto() {
        return store.mode === "bypassPermissions"
      },
      toggle() {
        // 不在 setStore 的 updater 里发请求：updater 可能被重复求值，副作用会被放大
        this.set(store.mode === "bypassPermissions" ? "default" : "bypassPermissions")
      },
    }
  },
})