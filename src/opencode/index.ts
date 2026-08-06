import yargs, { type Argv, type CommandModule } from "yargs"
import { hideBin } from "yargs/helpers"
import { readFileSync, existsSync } from "fs"
import { homedir, EOL } from "os"
import { join } from "path"

// Load API keys from ~/.codex/.env (and project .env) before anything else.
const ENV_FILES = [join(homedir(), ".codex", ".env"), join(process.cwd(), ".env")]
for (const file of ENV_FILES) {
  if (!existsSync(file)) continue
  for (const line of readFileSync(file, "utf-8").split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line)
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2]
  }
}
import { UI } from "./cli/ui"
import { InstallationVersion } from "@opencode-ai/core/installation/version"
import { FormatError } from "./cli/error"
import { errorMessage } from "./util/error"
import { Heap } from "./cli/heap"

// Lazy command loader: registers command name/describe synchronously (cheap),
// loads the heavy command module only when the command is actually parsed.
function lazy(command: string, describe: string, load: () => Promise<CommandModule>): CommandModule {
  return {
    command,
    describe,
    builder: async (y: Argv) => {
      const mod = await load()
      return mod.builder ? mod.builder(y) : y
    },
    handler: async (argv) => {
      const mod = await load()
      await mod.handler?.(argv)
    },
  }
}

const args = hideBin(process.argv)

function show(out: string) {
  const text = out.trimStart()
  if (!text.startsWith("opencode ")) {
    process.stderr.write(UI.logo() + EOL + EOL)
    process.stderr.write(text + EOL)
    return
  }
  process.stderr.write(out)
}

const cli = yargs(args)
  .parserConfiguration({ "populate--": true })
  .scriptName("opencode")
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
    if (opts.printLogs) process.env.OPENCODE_PRINT_LOGS = "1"
    if (opts.logLevel) process.env.OPENCODE_LOG_LEVEL = opts.logLevel
    if (opts.pure) {
      process.env.OPENCODE_PURE = "1"
    }

    Heap.start()

    process.env.AGENT = "1"
    process.env.OPENCODE = "1"
    process.env.OPENCODE_PID = String(process.pid)
  })
  .usage("")
  .completion("completion", "generate shell completion script")
  .command(lazy("acp", "start ACP (Agent Client Protocol) server", async () => (await import("./cli/cmd/acp")).AcpCommand))
  .command(lazy("mcp", "manage MCP servers", async () => (await import("./cli/cmd/mcp")).McpCommand))
  .command(lazy("$0 [project]", "start TUI", async () => (await import("./cli/cmd/tui")).TuiThreadCommand))
  .command(lazy("attach <url>", "attach to a running server", async () => (await import("./cli/cmd/attach")).AttachCommand))
  .command(lazy("run [message..]", "run with a message", async () => (await import("./cli/cmd/run")).RunCommand))
  .command(lazy("generate", "generate a prompt", async () => (await import("./cli/cmd/generate")).GenerateCommand))
  .command(lazy("debug", "debugging and troubleshooting tools", async () => (await import("./cli/cmd/debug")).DebugCommand))
  .command(lazy("login [url]", "login to an account", async () => (await import("./cli/cmd/account")).ConsoleCommand))
  .command(lazy("providers", "manage AI providers and credentials", async () => (await import("./cli/cmd/providers")).ProvidersCommand))
  .command(lazy("create", "create an agent", async () => (await import("./cli/cmd/agent")).AgentCommand))
  .command(lazy("upgrade [target]", "upgrade to a different version", async () => (await import("./cli/cmd/upgrade")).UpgradeCommand))
  .command(lazy("uninstall", "uninstall opencode", async () => (await import("./cli/cmd/uninstall")).UninstallCommand))
  .command(lazy("serve", "starts a headless server", async () => (await import("./cli/cmd/serve")).ServeCommand))
  .command(lazy("web", "start server and open web interface", async () => (await import("./cli/cmd/web")).WebCommand))
  .command(lazy("models [provider]", "list available models", async () => (await import("./cli/cmd/models")).ModelsCommand))
  .command(lazy("stats", "show statistics", async () => (await import("./cli/cmd/stats")).StatsCommand))
  .command(lazy("export [sessionID]", "export a session", async () => (await import("./cli/cmd/export")).ExportCommand))
  .command(lazy("import <file>", "import a session", async () => (await import("./cli/cmd/import")).ImportCommand))
  .command(lazy("install", "manage GitHub installation", async () => (await import("./cli/cmd/github")).GithubCommand))
  .command(lazy("pr <number>", "manage pull requests", async () => (await import("./cli/cmd/pr")).PrCommand))
  .command(lazy("session", "manage sessions", async () => (await import("./cli/cmd/session")).SessionCommand))
  .command(lazy("plugin <module>", "manage plugins", async () => (await import("./cli/cmd/plug")).PluginCommand))
  .command(lazy("$0 [query]", "run a database query", async () => (await import("./cli/cmd/db")).DbCommand))
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
    cli.showHelp(show)
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
