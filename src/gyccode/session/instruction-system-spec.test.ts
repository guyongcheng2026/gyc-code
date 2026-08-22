import { afterEach, describe, expect, it } from "bun:test"
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { Effect, Layer } from "effect"
import { Instruction } from "./instruction"
import { Global } from "@gyccode/core/global"
import { Config } from "@/config/config"
import { EventV2Bridge } from "@/event-v2-bridge"
import { InstanceRef } from "@/effect/instance-ref"
import { LayerNode } from "@gyccode/core/effect/layer-node"

const fakeConfig = Layer.sync(Config.Service, () =>
  ({
    get: () => Effect.succeed({ instructions: [] }),
    getGlobal: () => Effect.succeed({ instructions: [] }),
    getConsoleState: () => Effect.succeed({}),
    update: () => Effect.void,
    updateGlobal: () => Effect.succeed({ info: {}, changed: false }),
    invalidate: () => Effect.void,
    directories: () => Effect.succeed([]),
    waitForDependencies: () => Effect.void,
  }) as any,
)

const fakeBridge = Layer.sync(EventV2Bridge.Service, () =>
  ({
    publish: () => Effect.void,
    listen: () => Effect.succeed(() => {}),
    subscribe: () => Effect.void,
    unsubscribe: () => Effect.void,
  }) as any,
)

describe("Instruction.system @include expansion", () => {
  let dir: string

  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true })
    dir = ""
  })

  const setup = (files: Record<string, string>) => {
    dir = mkdtempSync(join(tmpdir(), "gyc-instruction-"))
    for (const [rel, content] of Object.entries(files)) {
      const full = join(dir, rel)
      mkdirSync(join(full, ".."), { recursive: true })
      writeFileSync(full, content, "utf8")
    }
    return dir
  }

  const runSystem = (dir: string) =>
    Effect.gen(function* () {
      const svc = yield* Instruction.Service
      return yield* svc.system()
    }).pipe(
      Effect.provideService(InstanceRef, {
        directory: dir,
        worktree: dir,
        project: {
          id: "prj_test" as any,
          worktree: dir,
          vcs: undefined,
          name: undefined,
          icon: undefined,
          commands: undefined,
          time: { created: Date.now(), updated: Date.now() },
          sandboxes: [],
        },
      } as any),
      Effect.provide(
        Layer.provideMerge(
          Layer.provideMerge(
            Layer.provideMerge(
              LayerNode.compile(Instruction.node),
              fakeConfig,
            ),
            Global.layerWith({ home: dir, config: dir, data: dir, cache: dir, state: dir, tmp: dir, bin: dir, log: dir, repos: dir }),
          ),
          fakeBridge,
        ),
      ),
      Effect.runPromise,
    )

  it("expands @include references into the system instruction files", async () => {
    const dir = setup({
      "AGENTS.md": "Root guidance.\nSee @./docs/guide.md for details.",
      "docs/guide.md": "Included guidance body.",
    })

    const result = await runSystem(dir)
    const joined = result.files.join("\n")

    expect(joined).toContain("Included guidance body.")
    expect(joined).toContain("Instructions from:")
    // No Effect object dump must leak into the prompt.
    expect(joined).not.toContain('"_id"')
    expect(joined).not.toContain('"op"')
  })
})
