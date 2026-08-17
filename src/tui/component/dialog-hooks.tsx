import { TextAttributes } from "@opentui/core"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useToast } from "../ui/toast"
import { useClipboard } from "../context/clipboard"
import { useBindings } from "../keymap"
import { HookRegistry } from "../../gyccode/hook/registry"
import { HookEvent } from "../../gyccode/hook/types"

const EVENT_LABELS: Record<string, string> = {
  PreToolUse: "工具执行前",
  PostToolUse: "工具执行后",
  PreCompact: "压缩前",
  PostCompact: "压缩后",
  SessionStart: "会话开始",
  SessionEnd: "会话结束",
  PreMessage: "消息前",
  PostMessage: "消息后",
  Notification: "通知",
}

export function DialogHooks() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const toast = useToast()
  const clipboard = useClipboard()

  dialog.setSize("large")

  const registry = createMemo(() => {
    const instance = new HookRegistry()
    return instance
  })

  const events = createMemo(() => HookEvent.values as readonly string[])

  const hooksByEvent = createMemo(() => {
    const reg = registry()
    return events()
      .map((evt) => ({
        event: evt,
        label: EVENT_LABELS[evt] ?? evt,
        hooks: reg.getHooks(evt as HookEvent),
      }))
      .filter((group) => group.hooks.length > 0)
  })

  const totalHooks = createMemo(() =>
    hooksByEvent().reduce((sum, group) => sum + group.hooks.length, 0),
  )

  const copy = () => {
    const text = hooksByEvent()
      .map((group) => `[${group.label}]`)
      .concat()
      .join("\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "Hook 信息已复制到剪贴板", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制 Hook 信息", group: "Dialog", cmd: copy }],
  }))

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Hooks — 钩子管理
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.textMuted}>
        已注册 Hook: <b>{totalHooks()}</b> 个，覆盖 {hooksByEvent().length} 个事件
      </text>

      <Show
        when={totalHooks() > 0}
        fallback={
          <box>
            <text fg={theme.textMuted}>当前未注册任何 Hook。</text>
            <text fg={theme.textMuted}>Hook 配置文件: ~/.gyccode/hooks.json</text>
            <text fg={theme.textMuted}>支持事件: PreToolUse / PostToolUse / SessionStart 等</text>
          </box>
        }
      >
        <For each={hooksByEvent()}>
          {(group) => (
            <box>
              <text fg={theme.text}>
                <b>{group.label}</b> ({group.event})
              </text>
              <For each={group.hooks}>
                {(hook) => (
                  <box flexDirection="row" gap={1}>
                    <text flexShrink={0} fg={theme.success}>
                      •
                    </text>
                    <text fg={theme.text} wrapMode="word">
                      {hook.command}
                    </text>
                    <Show when={hook.matcher}>
                      <text fg={theme.textMuted}>匹配: {hook.matcher}</text>
                    </Show>
                    <Show when={hook.timeout}>
                      <text fg={theme.textMuted}>超时: {hook.timeout}ms</text>
                    </Show>
                  </box>
                )}
              </For>
            </box>
          )}
        </For>
      </Show>

      <text fg={theme.textMuted}>Hook 在工具执行前后和会话生命周期触发自定义命令</text>
    </box>
  )
}
