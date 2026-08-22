import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useConnected } from "./use-connected"

const money = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
})

export function DialogUsage() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const local = useLocal()
  const connected = useConnected()

  dialog.setSize("large")

  const model = createMemo(() => local.model.current())

  const providers = createMemo(() =>
    sync.data.provider
      .filter((p) => Object.keys(p.models).length > 0)
      .map((p) => ({
        id: p.id,
        name: p.name ?? p.id,
        modelCount: Object.keys(p.models).length,
        hasCost: Object.values(p.models).some((m) => m.cost && (m.cost.input > 0 || m.cost.output > 0)),
      })),
  )

  const consoleState = createMemo(() => sync.data.console_state)

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Usage — 额度与使用
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <Show
        when={connected()}
        fallback={<text fg={theme.warning}>未连接任何服务商，无法查询额度</text>}
      >
        <box>
          <text fg={theme.text}>
            <b>当前模型</b>
          </text>
          <Show when={model()} fallback={<text fg={theme.textMuted}>未选择</text>}>
            {(m) => (
              <text fg={theme.text}>
                {m().providerID}/{m().modelID}
              </text>
            )}
          </Show>
        </box>
      </Show>

      <Show when={consoleState().activeOrgName}>
        <box>
          <text fg={theme.text}>
            <b>组织</b>
          </text>
          <text fg={theme.textMuted}>{consoleState().activeOrgName}</text>
        </box>
      </Show>

      <box>
        <text fg={theme.text}>
          <b>已配置服务商 ({providers().length})</b>
        </text>
        <For each={providers()}>
          {(provider) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={provider.hasCost ? theme.success : theme.textMuted}>
                •
              </text>
              <text fg={theme.text} wrapMode="word">
                <b>{provider.name}</b>{" "}
                <span fg={theme.textMuted}>
                  {provider.modelCount} 个模型{provider.hasCost ? "" : "（免费）"}
                </span>
              </text>
            </box>
          )}
        </For>
      </box>

      <text fg={theme.textMuted}>详细用量请访问服务商控制台查看</text>
    </box>
  )
}
