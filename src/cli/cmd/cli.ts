import { Effect } from "effect"
import type { Argv } from "yargs"
import { resolve as pathResolve, isAbsolute as pathIsAbsolute } from "path"
import { effectCmd } from "../effect-cmd"
import { UI } from "../ui"
import { readStdin } from "@core/util/read-stdin"
import { Filesystem } from "@/util/filesystem"

/**
 * `gyc cli` —— 纯命令行界面（原 bare `gyc` 行为）。
 *
 * 传消息：非交互单轮执行；无消息：进入逐行对话。全屏界面请用 bare `gyc`。
 */
export const CliCommand = effectCmd({
  command: "cli [message..]",
  describe: "纯命令行界面：传消息则非交互单轮；无参数进入逐行对话",
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
  handler: Effect.fn("Cli.cli")(function* (args) {
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
      const { runPipeline } = yield* Effect.promise(() => import("../core"))
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
      const { runPipeline } = yield* Effect.promise(() => import("../core"))
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
      const { runInteractiveLoop } = yield* Effect.promise(() => import("../core"))
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
