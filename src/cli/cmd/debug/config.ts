import { EOL } from "os"
import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"

export const ConfigCommand = effectCmd({
  command: "config",
  describe: "显示解析后的配置",
  builder: (yargs) => yargs,
  handler: Effect.fn("Cli.debug.config")(function* () {
    const { Config } = yield* Effect.promise(() => import("@/config/config"))
    const config = yield* Config.Service.use((cfg) => cfg.get())
    process.stdout.write(JSON.stringify(config, null, 2) + EOL)
  }),
})
