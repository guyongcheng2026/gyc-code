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
      // 有口令但走明文 HTTP，Basic Auth 凭据将以明文过网，违反铁律 ⑤（传输必须 TLS 加密）。
      // 「反向代理终结 TLS」是正当部署形态，但必须由使用者显式确认，不能默认放行。
      const acknowledged = process.env.GYCCODE_ALLOW_INSECURE_TRANSPORT === "1"
      if (!acknowledged) {
        logError(
          "cli.serve",
          "错误：拒绝在非回环地址上以明文 HTTP 传输凭据。" +
            "请在反向代理后以 TLS 对外暴露（代理侧终结 TLS），" +
            "或确认由你自行承担该风险并设置 GYCCODE_ALLOW_INSECURE_TRANSPORT=1 重新启动。",
          { hostname: opts.hostname },
        )
        process.exit(1)
      }
      logWarn(
        "cli.serve",
        "Warning: serving plain HTTP with Basic Auth over a non-loopback address; credentials are transmitted in cleartext. GYCCODE_ALLOW_INSECURE_TRANSPORT=1 已设置，确认由反向代理或受控网络承担风险。",
        { hostname: opts.hostname },
      )
    }
    const server = yield* Effect.promise(() => Server.listen(opts))
    console.log(`gyccode server listening on http://${server.hostname}:${server.port}`)

    yield* Effect.never
  }),
})
