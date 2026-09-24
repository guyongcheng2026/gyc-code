import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@gyccode/core/flag/flag"
import { logError, logWarn } from "@core/observability/log-error"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "启动无头 gyc 服务器",
  // Server loads instances per-request via x-gyccode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("@/server/server"))
    const opts = yield* resolveNetworkOptions(args)
    const isLoopback = opts.hostname === "127.0.0.1" || opts.hostname === "localhost" || opts.hostname === "::1"
    if (!Flag.GYCCODE_SERVER_PASSWORD) {
      if (!isLoopback) {
        logError(
          "cli.serve",
          "错误：拒绝在非回环地址上暴露未受保护的服务器。在监听前请设置 GYCCODE_SERVER_PASSWORD " + opts.hostname,
          { hostname: opts.hostname },
        )
        process.exit(1)
      }
      console.log("Warning: GYCCODE_SERVER_PASSWORD is not set; server is unsecured (loopback only).")
    } else if (!isLoopback) {
      logWarn(
        "cli.serve",
        "Warning: serving plain HTTP with Basic Auth over a non-loopback address; credentials are transmitted in cleartext. Terminate TLS at a reverse proxy in production.",
        { hostname: opts.hostname },
      )
    }
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`gyccode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
