#!/usr/bin/env bun
/**
 * 内存对比测量：fallback vs opentui（单进程顺序测量）
 *
 * Bun spawnSync 有问题，改用 Bun.subprocess 异步。
 */
import { spawn } from "bun"
import { join, dirname } from "path"
import { fileURLToPath } from "url"

const __dirname = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(__dirname, "..")

async function measure(name: string, script: string): Promise<number> {
	const proc = spawn({
		cmd: [process.execPath, "-e", script],
		cwd: repoRoot,
		stdout: "pipe",
		stderr: "pipe",
	})

	const [out] = await Promise.all([
		proc.stdout.text(),
		proc.exited,
	])

	const match = out.match(/RSS_MB:(\d+)/)
	return match ? parseInt(match[1]) : 0
}

async function main() {
	const fallbackScript = `
		process.env.GYC_TUI_BACKEND = "fallback"
		const path = "${repoRoot.replace(/\\/g, "\\\\")}\\\\src\\\\tui\\\\fallback\\\\terminal.ts"
		const { FallbackRenderer, ProcessBackend } = await import(path)
		const backend = new ProcessBackend(process.stdout, process.stdin)
		const renderer = new FallbackRenderer(backend, { maxFps: 60, mouseEnabled: true, kittyKeyboard: true })
		const mem = process.memoryUsage()
		console.log("RSS_MB:" + Math.round(mem.rss / 1024 / 1024))
	`

	const opentuiScript = `
		try {
			await import("@opentui/core")
		} catch(e) {
			console.log("opentui_import_fail:" + e.message)
		}
		const mem = process.memoryUsage()
		console.log("RSS_MB:" + Math.round(mem.rss / 1024 / 1024))
	`

	console.log("测量 fallback...")
	const fbRss = await measure("fallback", fallbackScript)
	console.log(`  fallback RSS: ${fbRss} MB`)

	console.log("测量 opentui...")
	const opRss = await measure("opentui", opentuiScript)
	console.log(`  opentui RSS: ${opRss} MB`)

	if (fbRss > 0 && opRss > 0) {
		const diff = opRss - fbRss
		const pct = ((diff / opRss) * 100).toFixed(1)
		console.log(`\n结果：fallback 比 opentui 省 ${diff} MB (${pct}%)`)
		console.log("  - opentui 含 FFI/koffi native 库")
		console.log("  - opentui 含 V8/JS 渲染引擎开销")
		console.log("  - fallback 仅纯 JS diff-frame 渲染")
	} else if (opRss === 0) {
		console.log("\nopentui 加载失败（当前环境无 native FFI 支持）")
		console.log("fallback 可正常加载运行")
	} else {
		console.log("\n测量失败")
	}
}

main().catch(console.error)
