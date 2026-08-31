import { TextAttributes } from "@opentui/core"
import { createSignal, For } from "solid-js"
import { useDialog } from "../ui/dialog"
import { useTuiConfig } from "../config"
import { useTheme } from "../context/theme"
import { useToast } from "../ui/toast"
import { useBindings } from "../keymap"

const OPTIONS: Array<{ value: "auto" | "opentui"; label: string; desc: string }> = [
	{ value: "auto", label: "auto（默认）", desc: "opentui 优先，失败自动降级 fallback" },
	{ value: "opentui", label: "opentui（原生）", desc: "强制原生渲染器，禁用降级" },
]

export function DialogRendererSelect() {
	const dialog = useDialog()
	const config = useTuiConfig()
	const toast = useToast()
	const { theme } = useTheme()
	const [selected, setSelected] = createSignal<"auto" | "opentui">(
		config.renderer === "opentui" ? "opentui" : "auto",
	)

	dialog.setSize("medium")

	const confirm = () => {
		const value = selected()
		toast.show({
			message: value === "auto" ? "已设为 auto，下次启动生效" : "已设为 opentui，下次启动生效",
			variant: "info",
		})
		dialog.clear()
	}

	useBindings(() => ({
		bindings: [
			{ key: "return", desc: "确认", group: "Dialog", cmd: confirm },
			{ key: "escape", desc: "取消", group: "Dialog", cmd: () => dialog.clear() },
		],
	}))

	return (
		<box paddingLeft={2} paddingRight={2} gap={1}>
			<box flexDirection="row" justifyContent="space-between">
				<text attributes={TextAttributes.BOLD} fg={theme.text}>
					渲染器选择
				</text>
				<text fg={theme.textMuted} onMouseUp={() => dialog.clear()}>
					esc/enter
				</text>
			</box>
			<box>
				<text fg={theme.textMuted}>切换需重启 TUI 才能生效</text>
			</box>
			<box height={1} />
			<For each={OPTIONS}>
				{(opt) => (
					<box
						onMouseUp={() => setSelected(opt.value)}
						flexDirection="row"
						gap={1}
					>
						<text
							fg={selected() === opt.value ? theme.primary : theme.textMuted}
							attributes={selected() === opt.value ? TextAttributes.BOLD : TextAttributes.NONE}
						>
							{selected() === opt.value ? "▶ " : "  "}
							{opt.label}
						</text>
						<text fg={theme.textMuted}>— {opt.desc}</text>
					</box>
				)}
			</For>
			<box height={1} />
			<box flexDirection="row" justifyContent="flex-end">
				<box
					paddingLeft={3}
					paddingRight={3}
					backgroundColor={theme.primary}
					onMouseUp={confirm}
				>
					<text fg={theme.selectedListItemText}>确定</text>
				</box>
			</box>
		</box>
	)
}
