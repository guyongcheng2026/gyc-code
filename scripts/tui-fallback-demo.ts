/**
 * 自研 fallback 渲染器 PoC 演示入口。
 *
 * 运行：bun scripts/tui-fallback-demo.ts（或 node --experimental-strip-types）
 * 退出：Esc / Ctrl+C
 *
 * 零 opentui 依赖，验证差分帧引擎的中文渲染、宽字符对齐、增量输出。
 */
import { DemoApp } from "../src/tui/fallback/demo-app"
import { ProcessBackend } from "../src/tui/fallback/terminal"

const backend = new ProcessBackend(process.stdout, process.stdin)
const app = new DemoApp({
	backend,
	title: "gyc-code 安全模式 · fallback 渲染器 PoC",
	initialMessages: [
		"系统: fallback 渲染器已启动（纯 JS 差分帧引擎）",
		"系统: 本界面不依赖 opentui 原生库，宽度口径与 display-width 同源",
		"提示: 输入任意文字后回车可回显；Esc 退出",
	],
})
app.run()
