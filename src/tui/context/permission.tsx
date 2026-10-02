import { createStore } from "solid-js/store"
import { useArgs } from "./args"
import { createSimpleContext } from "./helper"
import { fromTuiAutoFlag, type PermissionMode } from "@/permission/modes"

// R-1：此前这里另有一份 `"auto" | "normal"` 的平行类型，与 permission/modes.ts
// 的四模式同名不同义，两套系统互不相连。现统一到 modes.ts 的 PermissionMode。
export type { PermissionMode }

export const { use: usePermission, provider: PermissionProvider } = createSimpleContext({
  name: "Permission",
  init: () => {
    const args = useArgs()
    const [store, setStore] = createStore<{ mode: PermissionMode }>({
      mode: fromTuiAutoFlag(args.auto),
    })
    return {
      get mode() {
        return store.mode
      },
      set(mode: PermissionMode) {
        setStore("mode", mode)
      },
      // UI 用的布尔视图：只有 bypassPermissions 算「自动批准」
      get auto() {
        return store.mode === "bypassPermissions"
      },
      toggle() {
        setStore("mode", (mode) => (mode === "bypassPermissions" ? "default" : "bypassPermissions"))
      },
    }
  },
})