import { TextAttributes } from "@opentui/core"
import { createMemo, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useRoute } from "../context/route"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { useKV } from "../context/kv"
import { DialogConfirm } from "../ui/dialog-confirm"

const PLAN_MODE_KEY = "plan_mode_active"

export function DialogPlan() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const route = useRoute()
  const sdk = useSDK()
  const toast = useToast()
  const kv = useKV()

  dialog.setSize("medium")

  const planActive = createMemo(() => kv.get(PLAN_MODE_KEY, false))

  const enterPlanMode = async () => {
    const ok = await DialogConfirm.show(
      dialog,
      "进入计划模式",
      "进入计划模式后，助手将只做分析和规划，不修改文件。确认进入？",
    )
    if (ok !== true) return

    kv.set(PLAN_MODE_KEY, true)
    toast.show({
      message: "已进入计划模式，助手将只做规划不修改文件",
      variant: "info",
      duration: 3000,
    })
    dialog.clear()
  }

  const exitPlanMode = async () => {
    const ok = await DialogConfirm.show(
      dialog,
      "退出计划模式",
      "退出计划模式后，助手可以开始执行计划并修改文件。确认退出？",
    )
    if (ok !== true) return

    kv.set(PLAN_MODE_KEY, false)
    toast.show({
      message: "已退出计划模式，助手可以开始执行",
      variant: "info",
      duration: 3000,
    })
    dialog.clear()
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Plan — 计划模式
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>当前状态:</text>
      <text fg={planActive() ? theme.success : theme.warning}>
        <b>{planActive() ? "计划模式（只规划不执行）" : "执行模式（可修改文件）"}</b>
      </text>

      <Show when={planActive()} fallback={
        <box>
          <text fg={theme.textMuted}>计划模式下，助手会：</text>
          <text fg={theme.textMuted}>  1. 分析需求并理解上下文</text>
          <text fg={theme.textMuted}>  2. 制定详细实施计划</text>
          <text fg={theme.textMuted}>  3. 不修改任何文件</text>
          <text fg={theme.textMuted}>  4. 等待用户确认后再执行</text>
        </box>
      }>
        <box>
          <text fg={theme.textMuted}>当前处于计划模式，助手只做规划。</text>
          <text fg={theme.textMuted}>退出后助手可以开始执行计划。</text>
        </box>
      </Show>

      <box marginTop={1}>
        <box
          backgroundColor={theme.backgroundElement}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          onMouseDown={planActive() ? exitPlanMode : enterPlanMode}
        >
          <text fg={theme.text}>
            {planActive() ? "退出计划模式" : "进入计划模式"}
          </text>
        </box>
      </box>
    </box>
  )
}
