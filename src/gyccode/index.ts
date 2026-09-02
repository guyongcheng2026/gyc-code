
import yargs from "yargs"
import type { Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import { Effect } from "effect"
import { existsSync } from "fs"
import { homedir, EOL } from "os"
import { join, resolve as pathResolve, isAbsolute as pathIsAbsolute } from "path"
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
  workflow: { load: () => import("./cli/cmd/workflow"), name: "WorkflowCommand" },
  send: { load: () => import("./cli/cmd/send"), name: "SendCommand" },
  gateway: { load: () => import("./cli/cmd/gateway"), name: "GatewayCommand" },
  pair: { load: () => import("./cli/cmd/pair"), name: "PairCommand" },
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
  // 显式 `gyc tui`：OpenTUI 经 koffi 支持 Node，直接注册执行（无需 dist-bun Bun 产物）。
  await registerCommand(cli, COMMANDS[first]!)
} else {
  // Default: 纯 CLI（$0）。传消息则非交互单轮，无参数进入逐行对话（Node 直跑）；
  // 使用新的统一交互核心模块
  const { effectCmd } = await import("./cli/effect-cmd")
  const { readStdin } = await import("../core/util/read-stdin")
  const { Filesystem } = await import("./util/filesystem")

  cli.command(
    effectCmd({
      command: "$0 [message..]",
      describe: "gyc 默认入口：传消息则非交互单轮；无参数进入逐行对话；--tui 进入全屏 TUI",
      instance: (args) => !args.attach,
      directory: (args) => (args.dir && !args.attach ? pathResolve(process.cwd(), args.dir) : process.cwd()),
      builder: (yargs: Argv) =>
        yargs
          .positional("message", {
            describe: "message to send",
            type: "string",
            array: true,
            default: [],
          })
          .option("continue", {
            alias: ["c"],
            describe: "continue the last session",
            type: "boolean",
          })
          .option("session", {
            alias: ["s"],
            describe: "session id to continue",
            type: "string",
          })
          .option("fork", {
            describe: "fork the session before continuing (requires --continue or --session)",
            type: "boolean",
          })
          .option("model", {
            type: "string",
            alias: ["m"],
            describe: "model to use in the format of provider/model",
          })
          .option("agent", {
            type: "string",
            describe: "agent to use",
          })
          .option("file", {
            alias: ["f"],
            type: "string",
            array: true,
            describe: "file(s) to attach to message",
          })
          .option("attach", {
            type: "string",
            describe: "attach to a running gyc server (e.g., http://localhost:4096)",
          })
          .option("password", {
            alias: ["p"],
            type: "string",
            describe: "basic auth password (defaults to GYCCODE_SERVER_PASSWORD)",
          })
          .option("username", {
            alias: ["u"],
            type: "string",
            describe: "basic auth username (defaults to GYCCODE_SERVER_USERNAME or 'gyccode')",
          })
          .option("dir", {
            type: "string",
            describe: "directory to run in, path on remote server if attaching",
          })
          .option("variant", {
            type: "string",
            describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
          })
          .option("thinking", {
            type: "boolean",
            describe: "show thinking blocks",
          })
          .option("auto", {
            type: "boolean",
            describe: "auto-approve permissions that are not explicitly denied (dangerous!)",
            default: false,
          })
          .option("yolo", {
            type: "boolean",
            hidden: true,
            default: false,
          })
          .option("dangerously-skip-permissions", {
            type: "boolean",
            hidden: true,
            default: false,
          }),
      handler: Effect.fn("Cli.default")(function* (args) {
        const auto = args.auto || args.yolo || args["dangerously-skip-permissions"]
        const thinking = args.thinking ?? false
        const die = (message: string): never => {
          UI.error(message)
          process.exit(1)
        }

        if (args["dangerously-skip-permissions"]) {
          console.error("\x1b[33m⚠ 警告：--dangerously-skip-permissions 已禁用所有权限检查，存在安全风险！\x1b[0m")
          console.error("\x1b[33m⚠ 此模式下 AI 代理可以执行任何命令，包括删除文件、修改系统配置等危险操作。\x1b[0m")
          console.error("\x1b[33m⚠ 仅在受信任的环境中使用，切勿在生产环境或敏感项目中使用。\x1b[0m\n")
        }

        let message = [...args.message, ...(args["--"] || [])]
          .map((arg) => (arg.includes(" ") ? `"${arg.replace(/"/g, '\\"')}"` : arg))
          .join(" ")

        const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
        const directory = (() => {
          if (!args.dir) return args.attach ? undefined : root
          if (args.attach) return args.dir

          try {
            process.chdir(pathIsAbsolute(args.dir) ? args.dir : pathResolve(root, args.dir))
            return process.cwd()
          } catch {
            UI.error("Failed to change directory to " + args.dir)
            process.exit(1)
          }
        })()

        const piped = process.stdin.isTTY ? undefined : yield* Effect.promise(() => readStdin())
        message = [message, piped].filter(Boolean).join("\n")

        if (args.attach) {
          // --attach 模式：连接远程服务器，使用 runPipeline
          const { runPipeline } = yield* Effect.promise(() => import("./cli/core"))
          const result = yield* Effect.promise(() => runPipeline({
            message: message || undefined,
            command: (args as any).command,
            commandArgs: [(args as any).message, ...((args as any)["--"] || [])].join(" "),
            files: (args as any).file,
            model: (args as any).model,
            variant: (args as any).variant,
            agent: (args as any).agent,
            thinking,
            auto,
            sessionID: (args as any).session,
            continue: (args as any).continue,
            fork: (args as any).fork,
            directory,
            attachUrl: (args as any).attach,
            attachHeaders: (args.password || (args as any).username) ? {
              Authorization: `Basic ${btoa(`${args.username || "gyccode"}:${(args as any).password || ""}`)}`,
            } : {},
            pipedInput: piped,
          }))
          if (result.error) die(result.error)
          process.exitCode = result.exitCode
          // 单轮完成：flush 后显式退出，实例内 watcher/定时器句柄会挂住 event loop
          yield* Effect.promise(() => new Promise<void>((resolve) => process.stdout.write("", () => resolve())))
          process.exit(result.exitCode)
          return
        }

        // 交互模式或单轮模式
        if (message.trim()) {
          // 有消息：单轮执行
          const { runPipeline } = yield* Effect.promise(() => import("./cli/core"))
          const result = yield* Effect.promise(() => runPipeline({
            message,
            files: (args as any).file,
            model: (args as any).model,
            variant: (args as any).variant,
            agent: (args as any).agent,
            thinking,
            auto,
            sessionID: (args as any).session,
            continue: (args as any).continue,
            fork: (args as any).fork,
            directory,
          }))
          if (result.error) die(result.error)
          process.exitCode = result.exitCode
          // 单轮完成：flush 后显式退出，实例内 watcher/定时器句柄会挂住 event loop
          yield* Effect.promise(() => new Promise<void>((resolve) => process.stdout.write("", () => resolve())))
          process.exit(result.exitCode)
        } else {
          // 无消息：进入交互式循环（惰性加载 cli/core，纯单轮命令不背载交互模块）
          const { runInteractiveLoop } = yield* Effect.promise(() => import("./cli/core"))
          yield* Effect.promise(() => runInteractiveLoop({
            directory,
            model: (args as any).model,
            variant: (args as any).variant,
            agent: (args as any).agent,
            thinking,
            auto,
            sessionId: (args as any).session,
            continue: (args as any).continue,
            fork: (args as any).fork,
          }))
        }
      }),
    }) as never
  )
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
