import path from "path"
import { realpath } from "fs/promises"
import { Effect } from "effect"
import { InstanceState } from "@/effect/instance-state"
import type * as Tool from "./tool"
import { containsPath } from "../project/instance-context"
import { FSUtil } from "@gyccode/core/fs-util"

type Kind = "file" | "directory"

type Options = {
  bypass?: boolean
  kind?: Kind
}

export const assertExternalDirectoryEffect = Effect.fn("Tool.assertExternalDirectory")(function* (
  ctx: Tool.Context,
  target?: string,
  options?: Options,
) {
  if (!target) return false

  if (options?.bypass) return false

  const ins = yield* InstanceState.context
  // Resolve symlinks to their real target before checking containment.
  // A symlink whose link path is inside the worktree but whose target
  // points outside would bypass the containsPath check without realpath.
  const fullPath = target
  const resolved = yield* Effect.tryPromise({
    try: () => realpath(fullPath),
    catch: () => fullPath, // If realpath fails (broken symlink, etc.), use the original
  })
  if (containsPath(resolved, ins)) return false

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? fullPath : path.dirname(fullPath)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [glob],
    metadata: {
      filepath: fullPath,
      parentDir: dir,
    },
  })
  return true
})

export async function assertExternalDirectory(ctx: Tool.Context, target?: string, options?: Options) {
  return Effect.runPromise(assertExternalDirectoryEffect(ctx, target, options))
}
