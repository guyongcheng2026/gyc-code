// 纯 CLI 默认入口（gyc / gyc "消息"）。
//
// 三种形态：
//   1. 传消息或 stdin 管道 → 非交互单轮（复用 RunCommand.handler，行为与 `gyc run` 完全一致）。
//   2. 无参数且 stdout 为 TTY → 逐行对话（node:readline，Node 直跑，不依赖 OpenTUI）。
//   3. --mini → 转发 TUI 的 mini 交互（需 Bun，Node 下由 index.ts 先提升）。
import path from "path"
import type { Argv } from "yargs"
import { createInterface } from "node:readline/promises"
import { Effect } from "effect"
import { UI } from "../ui"
import { effectCmd } from "../effect-cmd"
import { readStdin } from "../../../core/util/read-stdin"
import { spawnBunSync } from "../util/bun-runtime"
import { Filesystem } from "@/util/filesystem"
import { createGyccodeClient, type GyccodeClient } from "@gyccode/protocol/v2"
import { FormatError, FormatUnknownError } from "../error"
import { streamLoop } from "./run/stream-cli"
import type { PermissionV1 } from "@gyccode/core/v1/permission"
import { RunCommand } from "./run"

function formatRunError(error: unknown) {
  return FormatError(error) ?? FormatUnknownError(error)
}

// 交互模式下用户在场，但第一版无授权 UI，权限保持与 `gyc run` 相同的拒绝规则
// （permission.asked 事件由 streamLoop 打印提示并自动拒绝，安全默认）。
const INTERACTIVE_PERMISSIONS: PermissionV1.Ruleset = [
  { permission: "question", action: "deny", pattern: "*" },
  { permission: "plan_enter", action: "deny", pattern: "*" },
  { permission: "plan_exit", action: "deny", pattern: "*" },
]

type CliInput = {
  directory?: string
  model?: string
  agent?: string
  thinking: boolean
  auto: boolean
}

function localFetchFn() {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const { Server } = await import("@/server/server")
    const { ServerAuth } = await import("@/server/auth")
    const request = new Request(input, init)
    const headers = new Headers(request.headers)
    const auth = ServerAuth.header()
    if (auth) headers.set("Authorization", auth)
    return Server.Default().app.fetch(new Request(request, { headers }))
  }) as typeof globalThis.fetch
}

async function createLocalClient(directory: string): Promise<GyccodeClient> {
  return createGyccodeClient({
    baseUrl: "http://gyccode.internal",
    fetch: localFetchFn(),
    directory,
  })
}

// 一轮对话：订阅事件流 → prompt → 流式渲染直到 idle。
async function runTurn(sdk: GyccodeClient, sessionID: string, text: string, input: CliInput) {
  const events = await sdk.event.subscribe()
  const completed = streamLoop({
    client: sdk,
    events,
    sessionID,
    format: "default",
    thinking: input.thinking,
    auto: input.auto,
  })
  const result = await sdk.session.prompt({
    sessionID,
    parts: [{ type: "text", text }],
  })
  if (result.error) {
    UI.error(formatRunError(result.error))
    return
  }
  await completed
}

const HELP_TEXT = [
  "gyc 纯 CLI 交互",
  "",
  "  直接输入问题并回车，逐轮对话（同一会话内保持上下文）。",
  "  斜杠命令：",
  "    /exit  /quit   退出",
  "    /help          显示本帮助",
  "    /<command>     执行斜杠命令（如 /compact）",
  "  模式切换：",
  "    gyc tui        切换到全屏 TUI（当前 CLI 退出，由 TUI 接管）",
  "    gyc --mini     切换到 split-footer 交互（当前 CLI 退出，由 mini 接管）",
  "",
  "  Ctrl-C 退出。",
].join("\n")

async function interactiveLoop(input: CliInput) {
  const root = Filesystem.resolve(process.env.PWD ?? process.cwd())
  const directory = input.directory ?? root
  const sdk = await createLocalClient(directory)
  const created = await sdk.session.create({
    title: undefined,
    permission: [...INTERACTIVE_PERMISSIONS],
  })
  const sessionID = created.data?.id
  if (!sessionID) {
    UI.error("Failed to create session")
    process.exit(1)
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on("SIGINT", () => {
    process.stdout.write("\n")
    rl.close()
    process.exit(0)
  })
  process.stdout.write(`gyc 会话 ${sessionID.slice(0, 8)} · 输入 /help 查看命令\n`)
  try {
    for (;;) {
      const line = await rl.question("gyc> ")
      const text = line.trim()
      if (!text) continue
      if (text === "/exit" || text === "/quit") break
      if (text === "/help") {
        process.stdout.write(HELP_TEXT + "\n")
        continue
      }
      // 模式切换：`gyc tui` / `gyc --mini`（或裸 `tui` / `--mini`）由 Bun 子进程
      // 接管全屏交互（OpenTUI 仅支持 Bun）。先关闭 readline 恢复终端，再拉起
      // 子进程；切换后本 CLI 进程退出（子进程独立运行，退出后回到 shell）。
      if (/^(?:gyc\s+)?tui(?:\s+.*)?$/i.test(text)) {
        rl.close()
        const code = spawnBunSync(["tui"])
        if (code === undefined) {
          UI.error("TUI 需要 Bun 运行时产物（dist-bun 缺失或启动失败），请重新构建：bun run build")
          process.exit(1)
        }
        process.exit(code)
      }
      if (/^(?:gyc\s+)?(?:--mini|-i)$/i.test(text)) {
        rl.close()
        const code = spawnBunSync(["--mini"])
        if (code === undefined) {
          UI.error("TUI 需要 Bun 运行时产物（dist-bun 缺失或启动失败），请重新构建：bun run build")
          process.exit(1)
        }
        process.exit(code)
      }
      const sub = /^gyc\s+(\S+)/i.exec(text)
      if (sub) {
        process.stdout.write(`交互模式内仅支持 tui / --mini 切换；其他子命令请 /exit 后运行 gyc ${sub[1]}\n`)
        continue
      }
      if (text.startsWith("/")) {
        const [command, ...rest] = text.slice(1).split(" ")
        const result = await sdk.session.command({
          sessionID,
          command,
          arguments: rest.join(" "),
        })
        if (result.error) UI.error(formatRunError(result.error))
        continue
      }
      await runTurn(sdk, sessionID, text, input)
    }
  } finally {
    rl.close()
  }
}

export const DefaultCommand = effectCmd({
  command: "$0 [message..]",
  describe: "gyc 默认入口：传消息则非交互单轮；无参数进入逐行对话；--tui 进入全屏 TUI",
  instance: (args) => !args.attach,
  directory: (args) => (args.dir && !args.attach ? path.resolve(process.cwd(), args.dir) : process.cwd()),
  builder: (yargs: Argv) =>
    yargs
      .positional("message", {
        describe: "message to send",
        type: "string",
        array: true,
        default: [],
      })
      .option("command", {
        describe: "the command to run, use message for args",
        type: "string",
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
      .option("share", {
        type: "boolean",
        describe: "share the session",
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
      .option("format", {
        type: "string",
        choices: ["default", "json"],
        default: "default",
        describe: "format: default (formatted) or json (raw JSON events)",
      })
      .option("file", {
        alias: ["f"],
        type: "string",
        array: true,
        describe: "file(s) to attach to message",
      })
      .option("title", {
        type: "string",
        describe: "title for the session (uses truncated prompt if no value provided)",
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
      .option("port", {
        type: "number",
        describe: "port for the local server (defaults to random port if no value provided)",
      })
      .option("variant", {
        type: "string",
        describe: "model variant (provider-specific reasoning effort, e.g., high, max, minimal)",
      })
      .option("thinking", {
        type: "boolean",
        describe: "show thinking blocks",
      })
      .option("mini", {
        type: "boolean",
        hidden: true,
        default: false,
      })
      .option("interactive", {
        alias: ["i"],
        type: "boolean",
        hidden: true,
        describe: "legacy alias for --mini",
        default: false,
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
      })
      .option("demo", {
        type: "boolean",
        default: false,
        hidden: true,
      }),
  handler: Effect.fn("Cli.default")(function* (args) {
    yield* Effect.promise(async () => {
      const mini = args.mini || args.interactive
      if (mini) {
        // --mini 转发 TUI 的 split-footer 交互（Node 下 index.ts 已提升到 Bun）。
        const { runMini } = await import("./run")
        await runMini({
          directory: args.dir,
          attach: args.attach,
          password: args.password,
          username: args.username,
          continue: args.continue,
          session: args.session,
          fork: args.fork,
          model: args.model,
          agent: args.agent,
          prompt: [...args.message, ...(args["--"] || [])].join(" "),
          demo: args.demo,
        })
        return
      }

      const message = [...args.message, ...(args["--"] || [])].join(" ")
      // 仅在无 message/command 时才读取 stdin（有参数时不阻塞等待管道/终端 EOF）。
      const piped =
        message.trim() || args.command
          ? undefined
          : process.stdin.isTTY
            ? undefined
            : await readStdin()
      const hasInput = Boolean(message.trim() || piped?.trim() || args.command)

      if (hasInput) {
        // 非交互单轮：复用 gyc run 的完整 handler（行为完全一致）。
        // stdin 已在上面消费，把管道内容合并进 message 再转发，避免二次读取为空。
        const combined = message.trim() ? message : (piped ?? "")
        await RunCommand.handler({
          ...args,
          _: args._ ?? [],
          message: combined ? [combined] : [],
        } as never)
        return
      }

      // 无消息、无管道、stdout 非 TTY（纯脚本环境）→ 无输入可做，报错退出。
      if (!process.stdout.isTTY) {
        UI.error("You must provide a message or a command")
        process.exit(1)
      }

      // 逐行对话（纯 CLI，Node 直跑）。
      await interactiveLoop({
        directory: args.dir,
        model: args.model,
        agent: args.agent,
        thinking: args.thinking ?? false,
        auto: args.auto || args.yolo || args["dangerously-skip-permissions"],
      })
    })
  }),
})
