import { Effect } from "effect"
import { effectCmd } from "../../effect-cmd"

export const AgentCommand = effectCmd({
  command: "agent <name>",
  describe: "显示智能体配置详情",
  builder: (yargs) =>
    yargs
      .positional("name", {
        type: "string",
        demandOption: true,
        description: "智能体名称",
      })
      .option("tool", {
        type: "string",
        description: "要执行的工具 ID",
      })
      .option("params", {
        type: "string",
        description: "工具参数，JSON 或 JS 对象字面量",
      }),
  handler: (args) =>
    Effect.gen(function* () {
      const { debugAgent } = yield* Effect.promise(() => import("./agent.handler"))
      return yield* debugAgent(args)
    }),
})
