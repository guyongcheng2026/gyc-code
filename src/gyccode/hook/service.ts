import { LayerNode } from "@gyccode/core/effect/layer-node"
import { ChildProcessSpawner } from "effect/unstable/process/ChildProcessSpawner"
import { CrossSpawnSpawner } from "@gyccode/core/cross-spawn-spawner"
import { Shell } from "@gyccode/core/shell"
import { Context, Effect, Layer } from "effect"
import { Config } from "@/config/config"
import { runHook } from "./executor"
import type { HookConfig, HookEvent, HookInput, HookOutcome } from "./types"

export interface Interface {
  /** 按事件（+ 可选 tool_name matcher）执行匹配到的 hook，顺序执行，逐个容错。 */
  readonly run: (event: HookEvent, input: HookInput) => Effect.Effect<ReadonlyArray<HookOutcome>>
  /** 列出当前配置的全部 hook。 */
  readonly list: () => Effect.Effect<ReadonlyArray<HookConfig>>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/Hook") {}

const layer = Layer.effect(
  Service,
  Effect.gen(function* () {
    const config = yield* Config.Service
    const spawner = yield* ChildProcessSpawner

    const list = Effect.fn("Hook.list")(function* () {
      const cfg = yield* config.get()
      return (cfg.hooks ?? []).map((h) => ({
        event: h.event,
        command: h.command,
        matcher: h.matcher,
        timeout: h.timeout,
      }))
    })

    const run = Effect.fn("Hook.run")(function* (event: HookEvent, input: HookInput) {
      const cfg = yield* config.get()
      const shell = Shell.acceptable(cfg.shell) ?? ""
      const byEvent = (cfg.hooks ?? []).filter((h) => h.event === event)
      const matched = input.tool_name
        ? byEvent.filter((h) => !h.matcher || new RegExp(h.matcher).test(input.tool_name!))
        : byEvent
      // 顺序执行：hook 的执行顺序对依赖关系的用户脚本很重要，且避免并发干扰。
      return yield* Effect.forEach(matched, (h) => runHook(spawner, h, input, shell), { concurrency: 1 })
    })

    return Service.of({ run, list })
  }),
)

export const node = LayerNode.make({
  service: Service,
  layer,
  deps: [Config.node, CrossSpawnSpawner.node],
})

export * as Hook from "./service"
