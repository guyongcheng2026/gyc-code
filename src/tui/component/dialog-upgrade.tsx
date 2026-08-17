import { TextAttributes } from "@opentui/core"
import { InstallationVersion, InstallationChannel } from "@gyccode/core/installation/version"
import { createMemo, Show, createSignal } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSDK } from "../context/sdk"
import { useToast } from "../ui/toast"
import { DialogConfirm } from "../ui/dialog-confirm"
import { execSync } from "node:child_process"

function getLatestVersion(): string | null {
  try {
    const output = execSync("npm view @gyccode/cli version 2>nul", {
      encoding: "utf8",
      timeout: 10000,
      stdio: ["pipe", "pipe", "pipe"],
    })
    return output.trim() || null
  } catch {
    return null
  }
}

function isVersionGreater(a: string, b: string): boolean {
  const pa = a.replace(/^v/, "").split(".").map(Number)
  const pb = b.replace(/^v/, "").split(".").map(Number)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const na = pa[i] ?? 0
    const nb = pb[i] ?? 0
    if (na > nb) return true
    if (na < nb) return false
  }
  return false
}

export function DialogUpgrade() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sdk = useSDK()
  const toast = useToast()

  dialog.setSize("medium")

  const [latest, setLatest] = createSignal<string | null>(null)
  const [checking, setChecking] = createSignal(true)

  const checkLatest = async () => {
    setChecking(true)
    const version = getLatestVersion()
    setLatest(version)
    setChecking(false)
  }
  void checkLatest()

  const hasUpdate = createMemo(() => {
    const v = latest()
    if (!v) return false
    return isVersionGreater(v, InstallationVersion)
  })

  const doUpgrade = async () => {
    const ok = await DialogConfirm.show(
      dialog,
      "升级确认",
      hasUpdate()
        ? `确定要从 ${InstallationVersion} 升级到 ${latest()} 吗？`
        : "确定要重新安装当前版本吗？",
    )
    if (ok !== true) return

    toast.show({
      message: "正在升级，请稍候...",
      variant: "info",
      duration: 30000,
    })

    void sdk.client.global
      .upgrade({ target: latest() ?? undefined })
      .then((result) => {
        if (result.error || !result.data?.success) {
          toast.show({ message: "升级失败", variant: "error" })
          return
        }
        toast.show({
          message: `已升级到 v${result.data.version}，请重启应用`,
          variant: "success",
          duration: 10000,
        })
        dialog.clear()
      })
      .catch((error: unknown) => {
        toast.show({
          message: error instanceof Error ? error.message : "升级失败",
          variant: "error",
        })
      })
  }

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Upgrade — 版本升级
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>

      <text fg={theme.text}>
        当前版本: <b>{InstallationVersion}</b>
      </text>
      <text fg={theme.textMuted}>渠道: {InstallationChannel}</text>

      <Show
        when={!checking()}
        fallback={<text fg={theme.textMuted}>正在检查最新版本...</text>}
      >
        <Show
          when={latest()}
          fallback={<text fg={theme.warning}>无法获取最新版本（可能网络问题）</text>}
        >
          <Show
            when={hasUpdate()}
            fallback={<text fg={theme.success}>已是最新版本</text>}
          >
            <text fg={theme.success}>
              有新版本可用: <b>{latest()}</b>
            </text>
          </Show>
        </Show>
      </Show>

      <Show when={hasUpdate()}>
        <box marginTop={1}>
          <box
            backgroundColor={theme.backgroundElement}
            paddingLeft={2}
            paddingRight={2}
            paddingTop={1}
            paddingBottom={1}
            onMouseDown={doUpgrade}
          >
            <text fg={theme.text}>立即升级</text>
          </box>
        </box>
      </Show>

      <text fg={theme.textMuted}>也可在终端运行: gyc upgrade</text>
    </box>
  )
}
