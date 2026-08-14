
import yargs from "yargs"
import type { Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import { readFileSync, existsSync } from "fs"
import { homedir, EOL } from "os"
import { join, dirname } from "path"
import { fileURLToPath } from "url"
import { win32EnableUtf8Console } from "@gyccode/tui/terminal-win32"
import { spawnBunSync } from "./cli/util/bun-runtime"

// Load API keys from ~/.gyc/.env (fallback: ~/.codex/.env for existing setups) and project .env.
const ENV_FILES = [
  join(homedir(), ".gyc", ".env"),
  join(homedir(), ".codex", ".env"),
  join(process.cwd(), ".env"),
]
for (const file of ENV_FILES) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (!m || process.env[m[1]] !== undefined) continue
    // 贪婪 (.*) 会吞掉行尾空白，先 trim；再按 dotenv 惯例剥离成对首尾引号
    // （API_KEY="sk-xxx" → sk-xxx），否则引号会原样进入环境变量导致认证失败
    let value = m[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    process.env[m[1]] = value
  }
}
// Windows conhost 默认按系统 ANSI 代码页（如 936/GBK）解码 UTF-8 字节流，
// 导致 TUI 底部 spinner（Braille 字符）与中文状态文本显示为乱码。启动时
// 将控制台输出代码页切换为 UTF-8（65001），幂等且对 Windows Terminal 无副作用。
win32EnableUtf8Console()
import { UI } from "./cli/ui"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { FormatError } from "./cli/error"
import { errorMessage } from "./util/error"
import { Heap } from "./cli/heap"

const args = hideBin(process.argv)

// Command registry: first argument (or alias) -> dynamic module loader.
// Commands are loaded on demand so a long-running session only keeps the
// modules it actually uses in memory (reduces RSS on low-RAM machines).
type CommandLoader = { load: () => Promise<Record<string, unknown>>; name: string }

const providersLoader: CommandLoader = { load: () => import("./cli/cmd/providers"), name: "ProvidersCommand" }
const pluginLoader: CommandLoader = { load: () => import("./cli/cmd/plug"), name: "PluginCommand" }

const COMMANDS: Record<string, CommandLoader> = {
  acp: { load: () => import("./cli/cmd/acp"), name: "AcpCommand" },
  mcp: { load: () => import("./cli/cmd/mcp"), name: "McpCommand" },
  attach: { load: () => import("./cli/cmd/attach"), name: "AttachCommand" },
  run: { load: () => import("./cli/cmd/run"), name: "RunCommand" },
  generate: { load: () => import("./cli/cmd/generate"), name: "GenerateCommand" },
  debug: { load: () => import("./cli/cmd/debug"), name: "DebugCommand" },
  console: { load: () => import("./cli/cmd/account"), name: "ConsoleCommand" },
  providers: providersLoader,
  auth: providersLoader,
  agent: { load: () => import("./cli/cmd/agent"), name: "AgentCommand" },
  upgrade: { load: () => import("./cli/cmd/upgrade"), name: "UpgradeCommand" },
  uninstall: { load: () => import("./cli/cmd/uninstall"), name: "UninstallCommand" },
  serve: { load: () => import("./cli/cmd/serve"), name: "ServeCommand" },
  web: { load: () => import("./cli/cmd/web"), name: "WebCommand" },
  models: { load: () => import("./cli/cmd/models"), name: "ModelsCommand" },
  stats: { load: () => import("./cli/cmd/stats"), name: "StatsCommand" },
  export: { load: () => import("./cli/cmd/export"), name: "ExportCommand" },
  import: { load: () => import("./cli/cmd/import"), name: "ImportCommand" },
  github: { load: () => import("./cli/cmd/github"), name: "GithubCommand" },
  pr: { load: () => import("./cli/cmd/pr"), name: "PrCommand" },
  session: { load: () => import("./cli/cmd/session"), name: "SessionCommand" },
  tui: { load: () => import("./cli/cmd/tui"), name: "TuiThreadCommand" },
  plugin: pluginLoader,
  plug: pluginLoader,
  memory: { load: () => import("./cli/cmd/memory"), name: "MemoryCommand" },
  db: { load: () => import("./cli/cmd/db"), name: "DbCommand" },
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

// OpenTUI 原生渲染（@opentui/core FFI）仅支持 Bun（bun:ffi）；Node 无 node:ffi 模块，
// TUI 无法在 Node 下初始化。Node 主进程检测到默认 TUI 命令时，交由 Bun 子进程
// 运行 Bun 目标产物（dist-bun）接管 TUI；非 TUI 命令（run/agent/serve 等）保持 Node 运行。
function spawnTuiUnderBun() {
  const code = spawnBunSync([...hideBin(process.argv)])
  if (code === undefined) {
    console.error("TUI 需要 Bun 运行时产物（dist-bun 缺失或启动失败），请重新构建：bun run build")
    process.exit(1)
  }
  process.exit(code)
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
const isHelp = args.includes("-h") || args.includes("--help")

if (isHelp) {
  for (const key of COMMAND_KEYS) {
    if (key === "db") continue
    await registerCommand(cli, COMMANDS[key]!)
  }
  cli.command("db", "database tools")
} else if (first && COMMANDS[first]) {
  // 显式 `gyc tui`：OpenTUI 原生渲染仅支持 Bun，Node 下提升到 Bun 子进程。
  if (first === "tui" && !process.versions.bun) {
    spawnTuiUnderBun()
  }
  await registerCommand(cli, COMMANDS[first]!)
} else {
  // Default: 纯 CLI（$0）。传消息则非交互单轮，无参数进入逐行对话（Node 直跑）。
  // --mini 需要 OpenTUI（split-footer 交互），Node 下提升到 Bun。
  if (!process.versions.bun && args.includes("--mini")) {
    spawnTuiUnderBun()
  }
  const def = await import("./cli/cmd/default")
  cli.command(def.DefaultCommand as never)
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
} finally {
  // Some subprocesses don't react properly to SIGTERM and similar signals.
  // Most notably, some docker-container-based MCP servers don't handle such signals unless
  // run using `docker run --init`.
  // Explicitly exit to avoid any hanging subprocesses.
  process.exit()
}
