
import yargs from "yargs"
import type { Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import { Effect } from "effect"
import { existsSync } from "fs"
import { homedir, EOL } from "os"
import { join } from "path"
import { win32InstallUtf8ConsoleGuard } from "@gyccode/tui/terminal-win32"
import { tuiTiming } from "@gyccode/tui/util/timing"
import dotenv from "dotenv"

// Load API keys from ~/.gyc/.env (fallback: ~/.codex/.env for existing setups) and project .env.
const ENV_FILES = [
  join(homedir(), ".gyc", ".env"),
  join(homedir(), ".codex", ".env"),
  join(process.cwd(), ".env"),
]
// 禁止注入的危险环境变量（影响子进程行为、安全边界）
const BLOCKLISTED_ENVS = new Set([
  // PATH 相关
  "PATH",
  "PATHEXT",
  
  // Node.js 相关
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "NODE_PATH",
  
  // SSL/TLS 证书
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "CA_BUNDLE",
  
  // Python 相关
  "PYTHONPATH",
  "PYTHONHOME",
  "PYTHONSTARTUP",
  
  // 动态链接库（Linux/macOS）
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  
  // Shell 配置
  "PS1",
  "PS2",
  "PS3",
  "PS4",
  "IFS",
  "ENV",
  "BASH_ENV",
  "PROMPT_COMMAND",
  
  // 临时目录
  "TMPDIR",
  "TMP",
  "TEMP",
  
  // 用户主目录
  "HOME",
  "USERPROFILE",
  
  // 其他危险变量
  "PROMPT",
  "HISTFILE",
  "HISTSIZE",
  "HISTFILESIZE",
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
// Windows conhost 默认按系统 ANSI 代码页（如 936/GBK）解码 UTF-8 字节流，
// 导致 TUI 底部 spinner（Braille 字符）与中文状态文本显示为乱码。启动时
// 将控制台输出代码页切换为 UTF-8（65001），幂等且对 Windows Terminal 无副作用。
win32InstallUtf8ConsoleGuard()
tuiTiming("entry module evaluated (static imports done)")
// 注意：禁止对 stdin/stdout/stderr 调用 setEncoding。
// 1) Windows 控制台 TTY 上 stdin.setEncoding 会触发 libuv 断言崩溃
//    （Assertion failed: 0, file src\win\req-inl.h）；
// 2) OpenTUI 的 StdinParser 依赖原始字节流（Buffer）解析键盘事件，
//    设置编码后 data 事件变为 string，中文输入、/命令选择、模型切换全部失效。
// 乱码问题由 win32InstallUtf8ConsoleGuard() 运行期守护切换控制台代码页 65001 解决。
import { UI } from "@gyccode/cli/ui"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { FormatError } from "@gyccode/cli/error"
import { errorMessage } from "./util/error"
import { Heap } from "@gyccode/cli/heap"

const args = hideBin(process.argv)

// Command registry: first argument (or alias) -> dynamic module loader.
// Commands are loaded on demand so a long-running session only keeps the
// modules it actually uses in memory (reduces RSS on low-RAM machines).
type CommandLoader = { load: () => Promise<Record<string, unknown>>; name: string }

const providersLoader: CommandLoader = { load: () => import("@gyccode/cli/cmd/providers"), name: "ProvidersCommand" }
const pluginLoader: CommandLoader = { load: () => import("@gyccode/cli/cmd/plug"), name: "PluginCommand" }

const COMMANDS: Record<string, CommandLoader> = {
  cli: { load: () => import("@gyccode/cli/cmd/cli"), name: "CliCommand" },
  acp: { load: () => import("@gyccode/cli/cmd/acp"), name: "AcpCommand" },
  mcp: { load: () => import("@gyccode/cli/cmd/mcp"), name: "McpCommand" },
  attach: { load: () => import("@gyccode/cli/cmd/attach"), name: "AttachCommand" },
  run: { load: () => import("@gyccode/cli/cmd/run"), name: "RunCommand" },
  generate: { load: () => import("@gyccode/cli/cmd/generate"), name: "GenerateCommand" },
  debug: { load: () => import("@gyccode/cli/cmd/debug"), name: "DebugCommand" },
  console: { load: () => import("@gyccode/cli/cmd/account"), name: "ConsoleCommand" },
  providers: providersLoader,
  auth: providersLoader,
  agent: { load: () => import("@gyccode/cli/cmd/agent"), name: "AgentCommand" },
  upgrade: { load: () => import("@gyccode/cli/cmd/upgrade"), name: "UpgradeCommand" },
  uninstall: { load: () => import("@gyccode/cli/cmd/uninstall"), name: "UninstallCommand" },
  serve: { load: () => import("@gyccode/cli/cmd/serve"), name: "ServeCommand" },
  web: { load: () => import("@gyccode/cli/cmd/web"), name: "WebCommand" },
  models: { load: () => import("@gyccode/cli/cmd/models"), name: "ModelsCommand" },
  stats: { load: () => import("@gyccode/cli/cmd/stats"), name: "StatsCommand" },
  export: { load: () => import("@gyccode/cli/cmd/export"), name: "ExportCommand" },
  import: { load: () => import("@gyccode/cli/cmd/import"), name: "ImportCommand" },
  github: { load: () => import("@gyccode/cli/cmd/github"), name: "GithubCommand" },
  pr: { load: () => import("@gyccode/cli/cmd/pr"), name: "PrCommand" },
  session: { load: () => import("@gyccode/cli/cmd/session"), name: "SessionCommand" },
  tui: { load: () => import("@gyccode/cli/cmd/tui"), name: "TuiThreadCommand" },
  plugin: pluginLoader,
  plug: pluginLoader,
  memory: { load: () => import("@gyccode/cli/cmd/memory"), name: "MemoryCommand" },
  learning: { load: () => import("@gyccode/cli/cmd/learning"), name: "LearningCommand" },
  db: { load: () => import("@gyccode/cli/cmd/db"), name: "DbCommand" },
  workflow: { load: () => import("@gyccode/cli/cmd/workflow"), name: "WorkflowCommand" },
  send: { load: () => import("@gyccode/cli/cmd/send"), name: "SendCommand" },
  gateway: { load: () => import("@gyccode/cli/cmd/gateway"), name: "GatewayCommand" },
  pair: { load: () => import("@gyccode/cli/cmd/pair"), name: "PairCommand" },
}

// Canonical command keys (excluding aliases) used to render the full --help list.
// Derived from COMMANDS by keeping the first key for each unique loader — aliases
// (e.g. `auth`→providers, `plug`→plugin) share a loader reference and are skipped.
// Single source of truth: the list cannot drift when commands or aliases change.
const COMMAND_KEYS = (() => {
  const seen = new Set<CommandLoader>()
  const keys: string[] = []
  for (const [key, loader] of Object.entries(COMMANDS)) {
    if (seen.has(loader)) continue
    seen.add(loader)
    keys.push(key)
  }
  return keys
})()

// bare `gyc` / `gyc tui` 共用同一个 TUI 命令模块；`defaultEntry` 时挂到 `$0`。
async function registerTui(cli: Argv, defaultEntry: boolean) {
  const mod = await import("@gyccode/cli/cmd/tui")
  const command = mod.TuiThreadCommand as unknown as Record<string, unknown>
  if (defaultEntry) cli.command({ ...command, command: "$0 [project]" } as never)
  else cli.command({ ...command, describe: false } as never)
}

async function registerCommand(cli: Argv, loader: CommandLoader) {
  const mod = await loader.load()
  cli.command(mod[loader.name] as never)
}

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("gyc ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("gyc")
  .wrap(100)
  .help("help", "show help")
  .alias("help", "h")
  .version("version", "show version number", InstallationVersion)
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

    Heap.start()

    process.env.AGENT = "1"
    process.env.GYCCODE = "1"
    process.env.GYCCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")

// Register commands on demand to keep memory low: only the invoked command
// (or the default TUI) is loaded at startup. --help registers everything
// except `db`, which stays a lightweight placeholder so the sqlite dependency
// is not pulled into the help path.
const first = args.find((a) => !a.startsWith("-"))
const isHelp = !first && (args.includes("-h") || args.includes("--help"))

if (isHelp) {
  for (const key of COMMAND_KEYS) {
    if (key === "db") continue
    // `tui` 是 bare `gyc` 的旧入口：保留可用，但不占用帮助列表条目。
    if (key === "tui") continue
    await registerCommand(cli, COMMANDS[key]!)
  }
  cli.command("db", "database tools")
  // 仅注册隐藏别名 `gyc tui`；默认入口的 `$0` 不在此注册，
  // 否则 yargs 会把 `gyc --help` 当成默认命令的帮助、不再输出全局命令列表。
  await registerTui(cli, false)
} else if (first && COMMANDS[first]) {
  await registerCommand(cli, COMMANDS[first]!)
} else {
  // 默认入口：bare `gyc` 直接进入全屏 TUI（`gyc tui` 仍可作为隐藏别名使用）。
  await registerTui(cli, true)
}

cli
  .fail((msg, err) => {
    if (
      msg?.startsWith("Unknown argument") ||
      msg?.startsWith("Not enough non-option arguments") ||
      msg?.startsWith("Invalid values:")
    ) {
      if (err) throw err
      cli.showHelp(show)
    }
    if (err) throw err
    process.exit(1)
  })
  .strict()

try {
  if (args.includes("-h") || args.includes("--help")) {
    await cli.parse(args, (err: Error | undefined, _argv: unknown, out: string) => {
      if (err) throw err
      if (!out) return
      show(out)
    })
  } else {
    await cli.parse()
  }
} catch (e) {
  const formatted = FormatError(e)
  if (formatted) UI.error(formatted)
  if (formatted === undefined) {
    UI.error("Unexpected error" + EOL)
    process.stderr.write(errorMessage(e) + EOL)
  }
  process.exitCode = 1
}

// 命令完成后显式退出：Effect 运行时与实例内 watcher/定时器句柄会挂住 event loop，
// 仅设 process.exitCode 无法让进程退出（曾致 stats/models/plugin list 等命令输出完成后进程挂起）。
// 与单轮命令（line 381/406）的既有退出模式一致；交互式 TUI/循环在 handler 内自行退出，不受影响。
process.exit(process.exitCode ?? 0)
