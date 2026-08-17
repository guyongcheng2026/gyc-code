import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useRoute } from "../context/route"
import { useLocal } from "../context/local"

export function DialogPermissions() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const route = useRoute()
  const local = useLocal()

  dialog.setSize("large")

  const sessionID = createMemo(() => (route.data.type === "session" ? route.data.sessionID : undefined))

  const pendingPermissions = createMemo(() => {
    const id = sessionID()
    if (!id) return []
    return sync.data.permission[id] ?? []
  })

  const allPermissions = createMemo(() => {
    const result: Array<{ sessionID: string; requests: typeof sync.data.permission[string] }> = []
    for (const [sid, requests] of Object.entries(sync.data.permission)) {
      if (requests && requests.length > 0) result.push({ sessionID: sid, requests })
    }
    return result
  })

  const autoApproveMode = createMemo(() => local.permission.mode === "auto")

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Permissions — 权限管理
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <box flexDirection="row" gap={1}>
        <text fg={theme.textMuted}>自动批准模式:</text>
        <text fg={autoApproveMode() ? theme.success : theme.warning}>
          {autoApproveMode() ? "已开启" : "已关闭"}
        </text>
      </box>

      <Show
        when={pendingPermissions().length > 0}
        fallback={<text fg={theme.textMuted}>当前会话无待处理权限请求</text>}
      >
        <box>
          <text fg={theme.text}>
            <b>当前会话待处理请求 ({pendingPermissions().length})</b>
          </text>
          <For each={pendingPermissions()}>
            {(req) => (
              <box flexDirection="row" gap={1}>
                <text flexShrink={0} fg={theme.warning}>
                  •
                </text>
                <text fg={theme.text} wrapMode="word">
                  <b>{req.permission}</b> — {req.patterns.join(", ")}
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <Show when={allPermissions().length > pendingPermissions().length}>
        <box>
          <text fg={theme.text}>
            <b>其他会话待处理请求</b>
          </text>
          <For each={allPermissions().filter((p) => p.sessionID !== sessionID())}>
            {(item) => (
              <box>
                <text fg={theme.textMuted} wrapMode="word">
                  会话 {item.sessionID.slice(0, 8)}…: {item.requests.length} 个请求
                </text>
              </box>
            )}
          </For>
        </box>
      </Show>

      <text fg={theme.textMuted}>权限规则在配置文件 ~/.gyccode/config.json 的 permission 字段中定义</text>
    </box>
  )
}
