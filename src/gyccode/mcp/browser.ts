import { LayerNode } from "@gyccode/core/effect/layer-node"
import { openUrl } from "@gyccode/core/open"
import { Context, Effect, Layer } from "effect"

export interface Interface {
  readonly open: (url: string) => Effect.Effect<void, Error>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/McpBrowser") {}

const layer = Layer.succeed(
  Service,
  Service.of({
    open: Effect.fn("McpBrowser.open")(function* (url: string) {
      const subprocess = yield* Effect.tryPromise({
        try: () => openUrl(url),
        catch: (error) => (error instanceof Error ? error : new Error(String(error))),
      })
      yield* Effect.callback<void, Error>((resume) => {
        const cleanup = () => {
          clearTimeout(timer)
          subprocess.removeAllListeners("error")
          subprocess.removeAllListeners("exit")
        }
        const timer = setTimeout(() => {
          // The subprocess usually exits quickly; once the timeout fires, stop
          // listening so a late non-zero exit/error isn't silently swallowed.
          cleanup()
          resume(Effect.void)
        }, 500)
        subprocess.on("error", (error) => {
          cleanup()
          resume(Effect.fail(error))
        })
        const onExit = (code: number | null) => {
          if (code === null || code === 0) return
          clearTimeout(timer)
          resume(Effect.fail(new Error(`Browser open failed with exit code ${code}`)))
        }
        subprocess.on("exit", onExit)
        // On Windows and WSL, open() can return only after the launcher has exited.
        onExit(subprocess.exitCode)
      })
    }),
  }),
)

export const node = LayerNode.make({ service: Service, layer, deps: [] })

export * as McpBrowser from "./browser"
