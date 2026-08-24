// 乱码守护验收脚本：验证"子进程复位代码页 → 守护定时器恢复 UTF-8"链路。
// 必须在真实控制台窗口中运行：bun scripts/verify-utf8-guard.mjs
// （agent/管道环境下 stdout 非 TTY，守护会拒绝安装，结果无效）
//
// 读取代码页用 kernel32 直读（win32GetConsoleCodePage），绕开 chcp.com
// 在 bun 下不返回 stdout 的问题；复位用 cmd.exe /c chcp 936（chcp 是 cmd
// 内置命令，经 cmd.exe 执行更可靠，且会真实修改控制台代码页）。

import { spawnSync } from "node:child_process"
import { writeFileSync } from "node:fs"
import {
  win32InstallUtf8ConsoleGuard,
  win32EnableUtf8Console,
  win32GetConsoleCodePage,
} from "@gyccode/tui/terminal-win32"

function reset936() {
  // chcp 是 cmd 内置命令，必须经 cmd.exe 执行；stdio ignore 避免输出干扰
  spawnSync("cmd.exe", ["/c", "chcp", "936"], { stdio: "ignore" })
}

const outFile = process.env.GYC_VERIFY_RESULT
try {
  if (!process.stdout.isTTY) {
    console.error("请在真实终端窗口中运行本脚本（当前 stdout 非 TTY，守护不会安装）")
    if (outFile) writeFileSync(outFile, "SKIP: stdout 非 TTY，守护不会安装，结果无效\n", "utf8")
    process.exit(1)
  }

  const results = []
  const check = (name, actual, expect) =>
    results.push([name, actual, actual === expect ? "PASS" : "FAIL"])

  win32EnableUtf8Console()
  check("初始代码页（切到 65001）", win32GetConsoleCodePage(), 65001)

  reset936()
  check("模拟子进程复位后（应为 936，确认复位生效）", win32GetConsoleCodePage(), 936)

  const stop = win32InstallUtf8ConsoleGuard(200)
  await new Promise((r) => setTimeout(r, 1000))
  check("守护运行 1s 后（应恢复 65001）", win32GetConsoleCodePage(), 65001)

  stop()
  reset936()
  await new Promise((r) => setTimeout(r, 1000))
  check("停止守护再复位（应保持 936，证明恢复来自守护本身）", win32GetConsoleCodePage(), 936)

  win32EnableUtf8Console()
  check("清理：恢复 65001", win32GetConsoleCodePage(), 65001)

  let failed = 0
  for (const [, , verdict] of results) {
    if (verdict === "FAIL") failed++
  }
  if (outFile) {
    const lines = results.map(([name, actual, verdict]) => `  [${verdict}] ${name} -> 实际 ${actual}`)
    writeFileSync(
      outFile,
      [...lines, failed === 0 ? "RESULT: ALL PASS" : `RESULT: ${failed} FAIL`].join("\n") + "\n",
      "utf8",
    )
  }
  for (const [name, actual, verdict] of results) {
    console.log(`  [${verdict}] ${name} -> 实际 ${actual}`)
  }
  process.exitCode = failed === 0 ? 0 : 1
} catch (e) {
  if (outFile) {
    try {
      writeFileSync(outFile, "ERROR: " + (e && e.stack ? e.stack : String(e)) + "\n", "utf8")
    } catch {}
  }
  console.error(e)
  process.exitCode = 1
}
