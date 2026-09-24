import yargs from "yargs"
import type { Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import { Effect } from "effect"
import { existsSync } from "fs"
import { homedir, EOL } from "os"
import { join } from "path"

import { COMMANDS, COMMAND_KEYS, HIDDEN_COMMANDS_SET, registerTui, registerCommand } from "./command-registry"

// Lazy-load helpers: only import heavy modules when actually needed.
let _dotenvLoaded = false
let _tuiGuardLoaded = false
let _uiLoaded = false
let _heapStarted = false

async function loadDotenv(): Promise<void> {
  if (_dotenvLoaded) return
  _dotenvLoaded = true
  const { default: dotenv } = await import("dotenv")
  const ENV_FILES = [
    join(homedir(), ".gyc", ".env"),
    join(homedir(), ".codex", ".env"),
    join(process.cwd(), ".env"),
  ]
  // 禁止注入的危险环境变量（影响子进程行为、安全边界）
  const BLOCKLISTED_ENVS = new Set([
    // PATH 相关
    "PATH", "PATHEXT",
    // Node.js 相关
    "NODE_OPTIONS", "NODE_EXTRA_CA_CERTS", "NODE_PATH",
    // SSL/TLS 证书
    "SSL_CERT_FILE", "SSL_CERT_DIR", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE", "CA_BUNDLE",
    // Python 相关
    "PYTHONPATH", "PYTHONHOME", "PYTHONSTARTUP",
    // 动态链接库（Linux/macOS）
    "LD_PRELOAD", "LD_LIBRARY_PATH", "DYLD_INSERT_LIBRARIES", "DYLD_LIBRARY_PATH",
    // Shell 配置
    "PS1", "PS2", "PS3", "PS4", "IFS", "ENV", "BASH_ENV", "PROMPT_COMMAND",
    // 临时目录
    "TMPDIR", "TMP", "TEMP",
    // 用户主目录
    "HOME", "USERPROFILE",
    // 其他危险变量
    "PROMPT", "HISTFILE", "HISTSIZE", "HISTFILESIZE",
  ])
  for (const file of ENV_FILES) {
    if (!existsSync(file)) continue
    const result = dotenv.config({ path: file, override: false })
    if (result.error) continue
    for (const [key, value] of Object.entries(result.parsed || {})) {
      if (process.env[key] !== undefined) continue
      if (BLOCKLISTED_ENVS.has(key)) continue
      process.env[key] = value
    }
  }
}

async function loadTuiGuard(): Promise<void> {
  if (_tuiGuardLoaded) return
  _tuiGuardLoaded = true
  // Windows conhost 默认按系统 ANSI 代码页（CP936/GBK）解码 UTF-8 字节流，
  // 导致 TUI 底部 spinner（Braille 字符）与中文状态文本显示为乱码。启动时
  // 将控制台输出代码页切换为 UTF-8（65001），幂等且对 Windows Terminal 无副作用。
  const { win32InstallUtf8ConsoleGuard } = await import("@gyccode/tui/terminal-win32")
  win32InstallUtf8ConsoleGuard()
}

async function loadUI(): Promise<typeof import("@gyccode/cli/ui")> {
  if (_uiLoaded) return import("@gyccode/cli/ui")
  _uiLoaded = true
  return import("@gyccode/cli/ui")
}

async function startHeap(): Promise<void> {
  if (_heapStarted) return
  _heapStarted = true
  const { Heap } = await import("@gyccode/cli/heap")
  Heap.start()
}

const args = hideBin(process.argv)

function show(out: string, UI: typeof import("@gyccode/cli/ui")) {
  const text = out.trimStart()
  if (!text.startsWith("gyc ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

async function main() {
  // Load .env early (lightweight)
  await loadDotenv()

  const cli = yargs(args)
    .parserConfiguration({ "populate--": true })
    .scriptName("gyc")
    .wrap(100)
    .help("help", "show help")
    .alias("help", "h")
    .version("version", "show version number", (await import("@gyccode/core/installation/version")).InstallationVersion)
    .alias("version", "v")
    .option("print-logs", {
      describe: "print logs to stderr",
      type: "boolean",
    })
    .option("log-level", {
      describe: "log level",
      type: "string",
      choices: ["DEBUG", "INFO", "WARN", "ERROR"],
    })
    .option("pure", {
      describe: "run without external plugins",
      type: "boolean",
    })
    .middleware(async (opts) => {
      if (opts.printLogs) process.env.GYCCODE_PRINT_LOGS = "1"
      if (opts.logLevel) process.env.GYCCODE_LOG_LEVEL = opts.logLevel
      if (opts.pure) {
        process.env.GYCCODE_PURE = "1"
      }

      // Start heap tracking (lazy)
      await startHeap()

      process.env.AGENT = "1"
      process.env.GYCCODE = "1"
      process.env.GYCCODE_CLI = "1"
    })

  // Register commands on demand to keep memory low: only the invoked command
  // (or the default TUI) is loaded at startup. --help registers everything
  // except `db`, which stays a lightweight placeholder so the sqlite dependency
  // is not pulled into the help path.
  const first = args.find((a) => !a.startsWith("-"))
  const isHelp = !first && (args.includes("-h") || args.includes("--help"))

  if (isHelp) {
    for (const key of COMMAND_KEYS) {
      if (HIDDEN_COMMANDS_SET.has(key)) continue
      await registerCommand(cli, COMMANDS[key]!)
    }
    cli.command("db", "database tools")
    // 仅注册隐藏别名 `gyc tui`；默认入口的 `$0` 不在此注册，
    // 否则 yargs 会把 `gyc --help` 当成默认命令的帮助、不再输出全局命令列表
    await registerTui(cli, false)
  } else if (first && COMMANDS[first]) {
    await registerCommand(cli, COMMANDS[first]!)
  } else {
    // 默认入口：bare `gyc` 直接进入全屏 TUI（`gyc tui` 仍可作为隐藏别名使用）
    await registerTui(cli, true)
  }

  cli
    .fail(async (msg, err) => {
      if (
        msg?.startsWith("Unknown argument") ||
        msg?.startsWith("Not enough non-option arguments") ||
        msg?.startsWith("Invalid values:")
      ) {
        if (err) throw err
        const UI = await loadUI()
        cli.showHelp((out) => show(out, UI))
      }
      if (err) throw err
      process.exit(1)
    })
    .strict()

  try {
    // Load TUI guard for interactive commands (needed for proper UTF-8 on Windows)
    if (!isHelp && (!first || first === "tui" || args.some(a => a === "tui"))) {
      await loadTuiGuard()
    }

    if (args.includes("-h") || args.includes("--help")) {
      const UI = await loadUI()
      await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
        if (err) throw err
        if (!out) return
        show(out, UI)
      })
    } else {
      await cli.parse()
    }
  } catch (e) {
    const { FormatError } = await import("@gyccode/cli/error")
    const { errorMessage } = await import("./util/error")
    const UI = await loadUI()
    const formatted = FormatError(e)
    if (formatted) UI.error(formatted)
    if (formatted === undefined) {
      UI.error("Unexpected error" + EOL)
      process.stderr.write(errorMessage(e) + EOL)
    }
    process.exitCode = 1
  }

  // 命令完成后显式退出：Effect 运行时与实例 watcher/定时器句柄会挂住 event loop
  // 仅设 process.exitCode 无法让进程退出（曾致 stats/models/plugin list 等命令输出完成后进程挂起）
  // 与单轮命令的既有退出模式一致；交互式 TUI/循环式 handler 内自行退出，不受影响
  process.exit(process.exitCode ?? 0)
}

main()