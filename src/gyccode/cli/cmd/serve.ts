import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { withNetworkOptions, resolveNetworkOptions } from "../network"
import { Flag } from "@gyccode/core/flag/flag"

export const ServeCommand = effectCmd({
  command: "serve",
  builder: (yargs) => withNetworkOptions(yargs),
  describe: "starts a headless gyc server",
  // Server loads instances per-request via x-gyccode-directory header — no
  // need for an ambient project InstanceContext at startup.
  instance: false,
  handler: Effect.fn("Cli.serve")(function* (args) {
    const { Server } = yield* Effect.promise(() => import("../../server/server"))
    const opts = yield* resolveNetworkOptions(args)
    const isLoopback = opts.hostname === "127.0.0.1" || opts.hostname === "localhost" || opts.hostname === "::1"
    if (!Flag.GYCCODE_SERVER_PASSWORD) {
      if (!isLoopback) {
        console.error(
          "Error: refusing to expose an unsecured server on a non-loopback address. Set GYCCODE_SERVER_PASSWORD before listening on " + opts.hostname,
        )
        process.exit(1)
      }
      console.log("Warning: GYCCODE_SERVER_PASSWORD is not set; server is unsecured (loopback only).")
    } else if (!isLoopback) {
      console.warn(
        "Warning: serving plain HTTP with Basic Auth over a non-loopback address; credentials are transmitted in cleartext. Terminate TLS at a reverse proxy in production.",
      )
    }
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`gyccode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
