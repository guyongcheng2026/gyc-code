
import yargs from "yargs"
import type { Argv } from "yargs"
import { hideBin } from "yargs/helpers"
import { Effect } from "effect"
import { readFileSync, existsSync } from "fs"
import { homedir, EOL } from "os"
import { join, dirname, resolve as pathResolve, isAbsolute as pathIsAbsolute } from "path"
import { fileURLToPath } from "url"
import { win32InstallUtf8ConsoleGuard } from "@gyccode/tui/terminal-win32"
import { tuiTiming } from "@gyccode/tui/util/timing"

// Load API keys from ~/.gyc/.env (fallback: ~/.codex/.env for existing setups) and project .env.
const ENV_FILES = [
  join(homedir(), ".gyc", ".env"),
  join(homedir(), ".codex", ".env"),
  join(process.cwd(), ".env"),
]
// 绂佹娉ㄥ叆鐨勫嵄闄╃幆澧冨彉閲忥紙褰卞搷瀛愯繘绋嬭涓恒€佸畨鍏ㄨ竟鐣岋級
const BLOCKLISTED_ENVS = new Set([
  "PATH",
  "NODE_OPTIONS",
  "NODE_EXTRA_CA_CERTS",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "REQUESTS_CA_BUNDLE",
  "CURL_CA_BUNDLE",
  "PYTHONPATH",
  "PYTHONHOME",
  "LD_PRELOAD",
  "LD_LIBRARY_PATH",
  "DYLD_INSERT_LIBRARIES",
  "DYLD_LIBRARY_PATH",
  "PS1",
  "PS2",
  "PS4",
  "IFS",
  "ENV",
  "BASH_ENV",
])
for (const file of ENV_FILES) {
  if (!existsSync(file)) continue
  for (const rawLine of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const line = rawLine.trim()
    if (!line || line.startsWith("#")) continue // 璺宠繃绌鸿鍜屾敞閲?
    // 鏀寔琛屽唴娉ㄩ噴锛欿EY=value # comment 鎴?KEY=value#comment
    // 鎵惧埌绗竴涓笉鍦ㄥ紩鍙峰唴鐨?# 瀛楃
    let hashIdx = -1
    let inQuote = false
    let quoteChar = ""
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]
      if (!inQuote && (ch === '"' || ch === "'")) {
        inQuote = true
        quoteChar = ch
      } else if (inQuote && ch === quoteChar) {
        inQuote = false
        quoteChar = ""
      } else if (!inQuote && ch === "#") {
        hashIdx = i
        break
      }
    }
    const cleanLine = hashIdx >= 0 ? line.slice(0, hashIdx).trim() : line
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(cleanLine)
    if (!m || process.env[m[1]] !== undefined) continue
    const key = m[1]
    if (BLOCKLISTED_ENVS.has(key)) continue // 闃绘柇鍗遍櫓鐜鍙橀噺娉ㄥ叆
    // 璐┆ (.*) 浼氬悶鎺夎灏剧┖鐧斤紝鍏?trim锛涘啀鎸?dotenv 鎯緥鍓ョ鎴愬棣栧熬寮曞彿
    // 锛圓PI_KEY="sk-xxx" 鈫?sk-xxx锛夛紝鍚﹀垯寮曞彿浼氬師鏍疯繘鍏ョ幆澧冨彉閲忓鑷磋璇佸け璐?
    let value = m[2].trim()
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1)
    }
    process.env[key] = value
  }
}
// Windows conhost 榛樿鎸夌郴缁?ANSI 浠ｇ爜椤碉紙濡?936/GBK锛夎В鐮?UTF-8 瀛楄妭娴侊紝
// 瀵艰嚧 TUI 搴曢儴 spinner锛圔raille 瀛楃锛変笌涓枃鐘舵€佹枃鏈樉绀轰负涔辩爜銆傚惎鍔ㄦ椂
// 灏嗘帶鍒跺彴杈撳嚭浠ｇ爜椤靛垏鎹负 UTF-8锛?5001锛夛紝骞傜瓑涓斿 Windows Terminal 鏃犲壇浣滅敤銆?
win32InstallUtf8ConsoleGuard()
tuiTiming("entry module evaluated (static imports done)")
// 娉ㄦ剰锛氱姝㈠ stdin/stdout/stderr 璋冪敤 setEncoding銆?
// 1) Windows 鎺у埗鍙?TTY 涓?stdin.setEncoding 浼氳Е鍙?libuv 鏂█宕╂簝
//    锛圓ssertion failed: 0, file src\win\req-inl.h锛夛紱
// 2) OpenTUI 鐨?StdinParser 渚濊禆鍘熷瀛楄妭娴侊紙Buffer锛夎В鏋愰敭鐩樹簨浠讹紝
//    璁剧疆缂栫爜鍚?data 浜嬩欢鍙樹负 string锛屼腑鏂囪緭鍏ャ€?鍛戒护閫夋嫨銆佹ā鍨嬪垏鎹㈠叏閮ㄥけ鏁堛€?
// 涔辩爜闂鐢?win32InstallUtf8ConsoleGuard() 杩愯鏈熷畧鎶ゅ垏鎹㈡帶鍒跺彴浠ｇ爜椤?65001 瑙ｅ喅銆?
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
// Derived from COMMANDS by keeping the first key for each unique loader 鈥?aliases
// (e.g. `auth`鈫抪roviders, `plug`鈫抪lugin) share a loader reference and are skipped.
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
  // 鏄惧紡 `gyc tui`锛歄penTUI 缁?koffi 鏀寔 Node锛岀洿鎺ユ敞鍐屾墽琛岋紙鏃犻渶 dist-bun Bun 浜х墿锛夈€?
  await registerCommand(cli, COMMANDS[first]!)
} else {
  // Default: 绾?CLI锛?0锛夈€備紶娑堟伅鍒欓潪浜や簰鍗曡疆锛屾棤鍙傛暟杩涘叆閫愯瀵硅瘽锛圢ode 鐩磋窇锛夛紱
  // 浣跨敤鏂扮殑缁熶竴浜や簰鏍稿績妯″潡
  const { effectCmd } = await import("./cli/effect-cmd")
  const { readStdin } = await import("../core/util/read-stdin")
  const { Filesystem } = await import("./util/filesystem")

  cli.command(
    effectCmd({
      command: "$0 [message..]",
      describe: "gyc 榛樿鍏ュ彛锛氫紶娑堟伅鍒欓潪浜や簰鍗曡疆锛涙棤鍙傛暟杩涘叆閫愯瀵硅瘽锛?-tui 杩涘叆鍏ㄥ睆 TUI",
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
          // --attach 妯″紡锛氳繛鎺ヨ繙绋嬫湇鍔″櫒锛屼娇鐢?runPipeline
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
            attachHeaders: {
              Authorization: args.password || (args as any).username ? `Basic ${btoa(`${args.username || "gyccode"}:${(args as any).password || ""}`)}` : undefined,
            },
            pipedInput: piped,
          }))
          if (result.error) die(result.error)
          process.exitCode = result.exitCode
          // 鍗曡疆瀹屾垚锛歠lush 鍚庢樉寮忛€€鍑猴紝瀹炰緥鍐?watcher/瀹氭椂鍣ㄥ彞鏌勪細鎸備綇 event loop
          yield* Effect.promise(() => new Promise<void>((resolve) => process.stdout.write("", resolve)))
          process.exit(result.exitCode)
          return
        }

        // 浜や簰妯″紡鎴栧崟杞ā寮?
        if (message.trim()) {
          // 鏈夋秷鎭細鍗曡疆鎵ц
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
          // 鍗曡疆瀹屾垚锛歠lush 鍚庢樉寮忛€€鍑猴紝瀹炰緥鍐?watcher/瀹氭椂鍣ㄥ彞鏌勪細鎸備綇 event loop
          yield* Effect.promise(() => new Promise<void>((resolve) => process.stdout.write("", resolve)))
          process.exit(result.exitCode)
        } else {
          // 鏃犳秷鎭細杩涘叆浜や簰寮忓惊鐜紙鎯版€у姞杞?cli/core锛岀函鍗曡疆鍛戒护涓嶈儗杞戒氦浜掓ā鍧楋級
          const { runInteractiveLoop } = yield* Effect.promise(() => import("./cli/core"))
          yield* Effect.promise(() => runInteractiveLoop({
            directory,
            model: (args as any).model,
            variant: (args as any).variant,
            agent: (args as any).agent,
            thinking,
            auto,
            sessionID: (args as any).session,
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
