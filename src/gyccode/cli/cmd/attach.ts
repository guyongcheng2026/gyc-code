import { cmd } from "./cmd"
import { UI } from "@/cli/ui"
import { errorMessage } from "@gyccode/tui/util/error"
import { validateSession } from "../tui/validate-session"
import { ServerAuth } from "@/server/auth"

export const AttachCommand = cmd({
  command: "attach <url>",
  describe: "连接到正在运行的 gyc 服务端",
  builder: (yargs) =>
    yargs
      .positional("url", {
        type: "string",
        describe: "http://localhost:4096",
        demandOption: true,
      })
      .option("dir", {
        type: "string",
        description: "运行目录",
      })
      .option("continue", {
        alias: ["c"],
        describe: "继续上一个会话",
        type: "boolean",
      })
      .option("session", {
        alias: ["s"],
        type: "string",
        describe: "要继续的会话 ID",
      })
      .option("fork", {
        type: "boolean",
        describe: "继续会话时派生新会话（与 --continue 或 --session 一起使用）",
      })
      .option("password", {
        alias: ["p"],
        type: "string",
        describe: "Basic 认证密码（默认取 GYCCODE_SERVER_PASSWORD）",
      })
      .option("username", {
        alias: ["u"],
        type: "string",
        describe: "Basic 认证用户名（默认取 GYCCODE_SERVER_USERNAME 或 'gyccode'）",
      }),
  handler: async (args) => {
    const directory = (() => {
      if (!args.dir) return undefined
      try {
        process.chdir(args.dir)
        return process.cwd()
      } catch {
        // If the directory doesn't exist locally (remote attach), pass it through.
        return args.dir
      }
    })()

    const { TuiConfig } = await import("@/config/tui")
    if (args.fork && !args.continue && !args.session) {
      UI.error("--fork 需要配合 --continue 或 --session 使用")
      process.exitCode = 1
      return
    }

    const headers = ServerAuth.headers({ password: args.password, username: args.username })
    const config = await TuiConfig.get()

    try {
      await validateSession({
        url: args.url,
        sessionID: args.session,
        directory,
        headers,
      })
    } catch (error) {
      UI.error(errorMessage(error))
      process.exitCode = 1
      return
    }

    const { Effect } = await import("effect")
    const { run } = await import("../tui/layer")
    const { createLegacyTuiPluginHost } = await import("@/plugin/tui/runtime")
    const configPromise = Promise.resolve(config)
    await Effect.runPromise(
      run({
        url: args.url,
        config: configPromise,
        pluginHost: createLegacyTuiPluginHost(),
        args: {
          continue: args.continue,
          sessionID: args.session,
          fork: args.fork,
        },
        directory,
        headers,
      })
    )
  },
})
