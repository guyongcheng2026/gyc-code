import { EOL } from "os"
import { Effect } from "effect"
import { ModelsDev } from "@gyccode/core/models-dev"
import { effectCmd, fail } from "../effect-cmd"
import { UI } from "../ui"
import { ProviderV2 } from "@gyccode/core/provider"

export const ModelsCommand = effectCmd({
  command: "models [provider]",
  describe: "列出所有可用模型",
  builder: (yargs) =>
    yargs
      .positional("provider", {
        describe: "用于筛选模型的服务商 ID",
        type: "string",
        array: false,
      })
      .option("verbose", {
        describe: "使用更详细的模型输出（包含成本等元数据）",
        type: "boolean",
      })
      .option("refresh", {
        describe: "从 models.dev 刷新模型缓存",
        type: "boolean",
      }),
  handler: Effect.fn("Cli.models")(function* (args) {
    const { Provider } = yield* Effect.promise(() => import("@/provider/provider"))
    if (args.refresh) {
      yield* ModelsDev.Service.use((s) => s.refresh(true))
      UI.println(UI.Style.TEXT_SUCCESS_BOLD + "模型缓存已刷新" + UI.Style.TEXT_NORMAL)
    }

    const provider = yield* Provider.Service
    const providers = yield* provider.list()

    const print = (providerID: ProviderV2.ID, verbose?: boolean) => {
      const p = providers[providerID]
      const sorted = Object.entries(p.models).sort(([a], [b]) => a.localeCompare(b))
      for (const [modelID, model] of sorted) {
        process.stdout.write(`${providerID}/${modelID}`)
        process.stdout.write(EOL)
        if (verbose) {
          process.stdout.write(JSON.stringify(model, null, 2))
          process.stdout.write(EOL)
        }
      }
    }

    if (args.provider) {
      const providerID = ProviderV2.ID.make(args.provider)
      if (!providers[providerID]) return yield* fail(`未找到服务商：${args.provider}`)
      print(providerID, args.verbose)
      return
    }

    const ids = Object.keys(providers).sort((a, b) => {
      const aIsGyccode = a.startsWith("gyccode")
      const bIsGyccode = b.startsWith("gyccode")
      if (aIsGyccode && !bIsGyccode) return -1
      if (!aIsGyccode && bIsGyccode) return 1
      return a.localeCompare(b)
    })

    for (const providerID of ids) print(ProviderV2.ID.make(providerID), args.verbose)
  }),
})
