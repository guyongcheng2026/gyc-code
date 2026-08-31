import { run as runTui, type TuiInput } from "@gyccode/tui"
import { Global } from "@gyccode/core/global"
import { AppNodeBuilder } from "@gyccode/core/effect/app-node-builder"
import { Effect, Layer } from "effect"

const TuiLayer = Layer.mergeAll(
  AppNodeBuilder.build(Global.node),
  // Add any other required layers here
)

export function run(input: TuiInput): import("effect").Effect.Effect<unknown, unknown, never> {
  return runTui(input).pipe(Effect.provide(TuiLayer))
}