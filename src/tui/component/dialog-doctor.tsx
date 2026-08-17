import { TextAttributes } from "@opentui/core"
import { InstallationChannel, InstallationVersion } from "@gyccode/core/installation/version"
import { createMemo, For, Show } from "solid-js"
import { useTheme } from "../context/theme"
import { useDialog } from "../ui/dialog"
import { useSync } from "../context/sync"
import { useLocal } from "../context/local"
import { useClipboard } from "../context/clipboard"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"
import { describeOS, describeTerminal } from "../util/system"
import { execSync } from "node:child_process"

type CheckResult = {
  label: string
  value: string
  status: "ok" | "warn" | "error"
  detail?: string
}

function checkCommand(cmd: string): string | null {
  try {
    const output = execSync(`${cmd} --version`, { encoding: "utf8", timeout: 5000, stdio: ["pipe", "pipe", "pipe"] })
    return output.trim().split("\n")[0]
  } catch {
    return null
  }
}

export function DialogDoctor() {
  const { theme } = useTheme()
  const dialog = useDialog()
  const sync = useSync()
  const local = useLocal()
  const clipboard = useClipboard()
  const toast = useToast()

  dialog.setSize("large")

  const checks = createMemo<CheckResult[]>(() => {
    const results: CheckResult[] = []

    // 版本信息
    results.push({
      label: "gyccode 版本",
      value: `${InstallationVersion} (${InstallationChannel})`,
      status: "ok",
    })

    // 运行时检查
    results.push({
      label: "Node.js",
      value: process.versions.node,
      status: "ok",
    })
    results.push({
      label: "Bun",
      value: typeof Bun !== "undefined" ? Bun.version : "未检测到",
      status: typeof Bun !== "undefined" ? "ok" : "warn",
    })

    // OS 和终端
    results.push({
      label: "操作系统",
      value: describeOS(),
      status: "ok",
    })
    results.push({
      label: "终端",
      value: describeTerminal(),
      status: "ok",
    })

    // 外部工具检查
    const gitVer = checkCommand("git")
    results.push({
      label: "Git",
      value: gitVer ?? "未安装",
      status: gitVer ? "ok" : "error",
      detail: gitVer ? undefined : "Git 未安装或不在 PATH 中，版本控制功能不可用",
    })

    const rgVer = checkCommand("rg")
    results.push({
      label: "ripgrep",
      value: rgVer ?? "未安装",
      status: rgVer ? "ok" : "warn",
      detail: rgVer ? undefined : "ripgrep 未安装，搜索功能将使用降级模式",
    })

    // MCP 连接状态
    const mcpCount = Object.keys(sync.data.mcp).length
    const mcpConnected = Object.values(sync.data.mcp).filter((m) => m.status === "connected").length
    results.push({
      label: "MCP 服务器",
      value: `${mcpConnected}/${mcpCount} 已连接`,
      status: mcpCount === 0 ? "warn" : mcpConnected === mcpCount ? "ok" : "error",
      detail: mcpCount === 0 ? "未配置 MCP 服务器" : undefined,
    })

    // LSP 连接状态
    const lspCount = sync.data.lsp.length
    const lspConnected = sync.data.lsp.filter((l) => l.status === "connected").length
    results.push({
      label: "LSP 服务器",
      value: `${lspConnected}/${lspCount} 已连接`,
      status: lspCount === 0 ? "warn" : lspConnected === lspCount ? "ok" : "error",
    })

    // 当前模型
    const model = local.model.current()
    results.push({
      label: "当前模型",
      value: model ? `${model.providerID}/${model.modelID}` : "未选择",
      status: model ? "ok" : "warn",
    })

    return results
  })

  const hasErrors = createMemo(() => checks().some((c) => c.status === "error"))
  const hasWarnings = createMemo(() => checks().some((c) => c.status === "warn"))

  const summary = createMemo(() => {
    if (hasErrors()) return { text: "发现问题，请查看下方详情", color: theme.error }
    if (hasWarnings()) return { text: "部分检查项有警告", color: theme.warning }
    return { text: "所有检查通过", color: theme.success }
  })

  const copy = () => {
    const text = checks()
      .map((c) => `${c.label}: ${c.value}${c.detail ? ` (${c.detail})` : ""}`)
      .join("\n")
    void clipboard
      .write?.(text)
      .then(() => toast.show({ message: "诊断信息已复制到剪贴板", variant: "info" }))
      .catch(toast.error)
  }

  useBindings(() => ({
    bindings: [{ key: "return", desc: "复制诊断信息", group: "Dialog", cmd: copy }],
  }))

  const statusColor = (status: CheckResult["status"]) =>
    status === "ok" ? theme.success : status === "warn" ? theme.warning : theme.error

  const statusIcon = (status: CheckResult["status"]) =>
    status === "ok" ? "✓" : status === "warn" ? "⚠" : "✗"

  return (
    <box paddingLeft={2} paddingRight={2} gap={1} paddingBottom={1}>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.text} attributes={TextAttributes.BOLD}>
          Doctor — 环境诊断
        </text>
        <text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
          esc
        </text>
      </box>
      <text fg={summary().color}>
        <b>{summary().text}</b>
      </text>
      <box>
        <For each={checks()}>
          {(check) => (
            <box flexDirection="row" gap={1}>
              <text flexShrink={0} fg={statusColor(check.status)}>
                {statusIcon(check.status)}
              </text>
              <text flexShrink={0} fg={theme.textMuted}>
                {check.label.padEnd(16)}
              </text>
              <text fg={theme.text} wrapMode="word">
                {check.value}
              </text>
            </box>
          )}
        </For>
      </box>
      <Show when={checks().some((c) => c.detail)}>
        <box gap={1}>
          <For each={checks().filter((c) => c.detail)}>
            {(check) => (
              <text fg={theme.warning} wrapMode="word">
                {check.label}: {check.detail}
              </text>
            )}
          </For>
        </box>
      </Show>
      <box flexDirection="row" justifyContent="space-between">
        <text fg={theme.textMuted}>反馈问题时请附带此信息。</text>
        <text onMouseUp={copy}>
          <span style={{ fg: theme.text }}>
            <b>copy</b>
          </span>{" "}
          <span style={{ fg: theme.textMuted }}>enter</span>
        </text>
      </box>
    </box>
  )
}
