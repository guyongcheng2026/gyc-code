import { LayerNode } from "@gyccode/core/effect/layer-node"
import { httpClient } from "@gyccode/core/effect/app-node-platform"
import path from "path"
import { SessionV1 } from "@gyccode/core/v1/session"
import type { EventV2 } from "@gyccode/core/event"
import { EventV2Bridge } from "@/event-v2-bridge"
import { SessionEvent } from "@gyccode/schema/session-event"
import { DateTime, Effect, Layer, Context } from "effect"
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/unstable/http"
import { Config } from "@/config/config"
import { InstanceState } from "@/effect/instance-state"
import { RuntimeFlags } from "@/effect/runtime-flags"
import { Flag } from "@gyccode/core/flag/flag"
import { FSUtil } from "@gyccode/core/fs-util"
import { withTransientReadRetry } from "@/util/effect-http-client"
import { Global } from "@gyccode/core/global"
import { type SessionEventPublisher } from "./session-cwd"
import { resolveIncludes, MAX_INCLUDE_DEPTH, TEXT_FILE_EXTENSIONS } from "./instruction-includes"
import type { MessageV2 } from "./message-v2"
import type { MessageID, SessionID } from "./schema"

function extract(messages: SessionV1.WithParts[]) {
  const paths = new Set<string>()
  for (const msg of messages) {
    for (const part of msg.parts) {
      if (part.type === "tool" && part.tool === "read" && part.state.status === "completed") {
        if (part.state.time.compacted) continue
        const loaded = part.state.metadata?.loaded
        if (!loaded || !Array.isArray(loaded)) continue
        for (const p of loaded) {
          if (typeof p === "string") paths.add(p)
        }
      }
    }
  }
  return paths
}

export const publishInstructionsListed = Effect.fn("Instruction.publishInstructionsListed")(function* (
  events: SessionEventPublisher,
  sessionID: SessionID,
  files: readonly string[],
) {
  yield* events.publish(SessionEvent.InstructionsListed, {
    sessionID,
    files: Array.from(files),
    timestamp: yield* DateTime.now,
  })
})

export interface Interface {
  readonly clear: (messageID: MessageID) => Effect.Effect<void>
  readonly systemPaths: () => Effect.Effect<Set<string>, FSUtil.Error>
  /**
   * The prompt instruction text plus the exact resolved instruction paths that
   * backed it, so callers can publish `session.instructions` with the same set
   * without re-walking the filesystem (see `publishResolved`).
   */
  readonly system: () => Effect.Effect<{ files: string[]; paths: ReadonlySet<string> }, FSUtil.Error>
  readonly publishResolved: (sessionID: SessionID, paths: ReadonlySet<string>) => Effect.Effect<void>
  readonly find: (dir: string) => Effect.Effect<string | undefined, FSUtil.Error>
  readonly resolve: (
    messages: SessionV1.WithParts[],
    filepath: string,
    messageID: MessageID,
  ) => Effect.Effect<{ filepath: string; content: string }[], FSUtil.Error>
}

export class Service extends Context.Service<Service, Interface>()("@gyccode/Instruction") {}

const layer: Layer.Layer<
  Service,
  never,
  FSUtil.Service | Config.Service | Global.Service | HttpClient.HttpClient | RuntimeFlags.Service | EventV2Bridge.Service
> = Layer.effect(
  Service,
  Effect.gen(function* () {
    const cfg = yield* Config.Service
    const fs = yield* FSUtil.Service
    const global = yield* Global.Service
    const flags = yield* RuntimeFlags.Service
    const events = yield* EventV2Bridge.Service
    const http = HttpClient.filterStatusOk(withTransientReadRetry(yield* HttpClient.HttpClient))
    const globalFiles = [
      path.join(global.config, "AGENTS.md"),
      ...(!flags.disableClaudeCodePrompt ? [path.join(global.home, ".claude", "CLAUDE.md")] : []),
    ]
    const instructionFiles = [
      "AGENTS.md",
      ...(!flags.disableClaudeCodePrompt ? ["CLAUDE.md"] : []),
      "CONTEXT.md", // deprecated
    ]

    const state = yield* InstanceState.make(
      Effect.fn("Instruction.state")(() =>
        Effect.succeed({
          // Track which instruction files have already been attached for a given assistant message.
          claims: new Map<MessageID, Set<string>>(),
        }),
      ),
    )

    const relative = Effect.fnUntraced(function* (instruction: string) {
      const ctx = yield* InstanceState.context
      if (!Flag.GYCCODE_DISABLE_PROJECT_CONFIG) {
        return yield* fs
          .globUp(instruction, ctx.directory, ctx.worktree)
          .pipe(Effect.catch(() => Effect.succeed([] as string[])))
      }
      return yield* fs
        .globUp(instruction, global.config, global.config)
        .pipe(Effect.catch(() => Effect.succeed([] as string[])))
    })

    const read = Effect.fnUntraced(function* (filepath: string) {
      return yield* fs.readFileString(filepath).pipe(Effect.catch(() => Effect.succeed("")))
    })

    // Recursively resolve `@include` references in an instruction file.
    // Bounded by MAX_INCLUDE_DEPTH and a visited-set to prevent cycles; only
    // text files are pulled in (TEXT_FILE_EXTENSIONS), so binaries never enter
    // the prompt. Aligned with Claude Code's claudemd.ts @include handling.
    const withIncludes = Effect.fnUntraced(function* (from: string, content: string) {
      const ctx = yield* InstanceState.context
      const base = path.dirname(from)
      const visited = new Set([path.resolve(from)])

      const loadIncludes = (source: string, text: string, depth: number): Effect.Effect<string> =>
        Effect.gen(function* () {
          if (depth > MAX_INCLUDE_DEPTH) return text
          let out = text
          for (const ref of resolveIncludes(text)) {
            const target = ref.startsWith("~/")
              ? path.join(global.home, ref.slice(2))
              : ref.startsWith("/")
                ? ref
                : path.resolve(base, ref)
            const resolved = path.resolve(target)
            if (visited.has(resolved)) continue
            const ext = (path.extname(resolved) || "").slice(1).toLowerCase()
            if (!TEXT_FILE_EXTENSIONS.has(ext)) continue
            if (!resolved.startsWith(ctx.worktree) && !resolved.startsWith(global.home)) continue
            const included = yield* read(resolved)
            if (!included) continue
            visited.add(resolved)
            const nested = yield* loadIncludes(resolved, included, depth + 1)
            out += `\n\nInstructions from: ${resolved}\n${nested}`
          }
          return out
        })

      return yield* loadIncludes(from, content, 1)
    })

    const fetch = Effect.fnUntraced(function* (url: string) {
      const res = yield* http.execute(HttpClientRequest.get(url)).pipe(
        Effect.timeout(5000),
        Effect.catch(() => Effect.succeed(null)),
      )
      if (!res) return ""
      const body = yield* res.arrayBuffer.pipe(Effect.catch(() => Effect.succeed(new ArrayBuffer(0))))
      return new TextDecoder().decode(body)
    })

    const clear = Effect.fn("Instruction.clear")(function* (messageID: MessageID) {
      const s = yield* InstanceState.get(state)
      s.claims.delete(messageID)
    })

    const systemPaths = Effect.fn("Instruction.systemPaths")(function* () {
      const config = yield* cfg.get()
      const ctx = yield* InstanceState.context
      const paths = new Set<string>()

      for (const file of globalFiles) {
        if (yield* fs.existsSafe(file)) {
          paths.add(path.resolve(file))
          break
        }
      }

      // The first project-level match wins so we don't stack AGENTS.md/CLAUDE.md from every ancestor.
      if (!Flag.GYCCODE_DISABLE_PROJECT_CONFIG) {
        for (const file of instructionFiles) {
          const matches = yield* fs
            .findUp(file, ctx.directory, ctx.worktree)
            .pipe(Effect.catch(() => Effect.succeed([])))
          if (matches.length > 0) {
            matches.forEach((item) => paths.add(path.resolve(item)))
            break
          }
        }
      }

      if (config.instructions) {
        for (const raw of config.instructions) {
          if (raw.startsWith("https://") || raw.startsWith("http://")) continue
          const instruction = raw.startsWith("~/") ? path.join(global.home, raw.slice(2)) : raw
          const matches = yield* (
            path.isAbsolute(instruction)
              ? fs.glob(path.basename(instruction), {
                  cwd: path.dirname(instruction),
                  absolute: true,
                  include: "file",
                })
              : relative(instruction)
          ).pipe(Effect.catch(() => Effect.succeed([] as string[])))
          matches.forEach((item) => paths.add(path.resolve(item)))
        }
      }

      return paths
    })

    const system = Effect.fn("Instruction.system")(function* () {
      const config = yield* cfg.get()
      const paths = yield* systemPaths()
      const urls = (config.instructions ?? []).filter(
        (item) => item.startsWith("https://") || item.startsWith("http://"),
      )

      const files = yield* Effect.forEach(Array.from(paths), read, { concurrency: 8 })
      const remote = yield* Effect.forEach(urls, fetch, { concurrency: 4 })

      const local = Array.from(paths).flatMap((item, i) =>
        files[i] ? [`Instructions from: ${item}\n${withIncludes(item, files[i]!)}`] : [],
      )
      const remoteParts = urls.flatMap((item, i) => (remote[i] ? [`Instructions from: ${item}\n${remote[i]}`] : []))

      return { files: [...local, ...remoteParts], paths }
    })

    const find = Effect.fn("Instruction.find")(function* (dir: string) {
      for (const file of instructionFiles) {
        const filepath = path.resolve(path.join(dir, file))
        if (yield* fs.existsSafe(filepath)) return filepath
      }
      return undefined
    })

    const resolve = Effect.fn("Instruction.resolve")(function* (
      messages: SessionV1.WithParts[],
      filepath: string,
      messageID: MessageID,
    ) {
      const sys = yield* systemPaths()
      const already = extract(messages)
      const results: { filepath: string; content: string }[] = []
      const s = yield* InstanceState.get(state)
      const root = path.resolve(yield* InstanceState.directory)

      const target = path.resolve(filepath)
      let current = path.dirname(target)

      // Walk upward from the file being read and attach nearby instruction files once per message.
      while (current.startsWith(root) && current !== root) {
        const found = yield* find(current)
        if (!found || found === target || sys.has(found) || already.has(found)) {
          current = path.dirname(current)
          continue
        }

        let set = s.claims.get(messageID)
        if (!set) {
          set = new Set()
          s.claims.set(messageID, set)
        }
        if (set.has(found)) {
          current = path.dirname(current)
          continue
        }

        set.add(found)
        const content = yield* read(found)
        if (content) {
          results.push({ filepath: found, content: `Instructions from: ${found}\n${content}` })
        }

        current = path.dirname(current)
      }

      return results
    })

    const publishResolved = Effect.fn("Instruction.publishResolved")(function* (
      sessionID: SessionID,
      paths: ReadonlySet<string>,
    ) {
      yield* publishInstructionsListed(events, sessionID, Array.from(paths))
    })

    return Service.of({ clear, systemPaths, system, publishResolved, find, resolve })
  }),
)

export function loaded(messages: SessionV1.WithParts[]) {
  return extract(messages)
}

export const node = LayerNode.make({
  service: Service,
  layer: layer,
  deps: [Config.node, FSUtil.node, Global.node, RuntimeFlags.node, EventV2Bridge.node, httpClient],
})

export * as Instruction from "./instruction"
