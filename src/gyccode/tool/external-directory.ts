import path from "path"
import { lstat, realpath } from "fs/promises"
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
  // Determine containment through the real path so symlinks cannot escape the
  // worktree. Fail closed when realpath cannot confirm safety, distinguishing
  // two failure shapes:
  //  - broken symlink (lstat says symlink, target missing): writing would
  //    create the link target outside the worktree -> treat as external.
  //  - plain missing path (new file): judged by its nearest existing ancestor,
  //    so creating a new file inside the worktree is not treated as external.
  const inside = yield* Effect.tryPromise({
    try: async () => {
      try {
        return containsPath(await realpath(fullPath), ins)
      } catch {
        // realpath failed. Distinguish a broken symlink (writing would create
        // the link target outside the worktree -> external) from a plain
        // missing path (new file -> judged by its nearest existing ancestor).
        const stat = await lstat(fullPath).catch(() => undefined)
        if (stat?.isSymbolicLink()) return false
        let current = path.dirname(fullPath)
        for (;;) {
          const ancestor = await realpath(current).catch(() => undefined)
          if (ancestor) return containsPath(ancestor, ins)
          const parent = path.dirname(current)
          if (parent === current) return false
          current = parent
        }
      }
    },
    catch: () => false,
  })
  if (inside) return false

  const kind = options?.kind ?? "file"
  const dir = kind === "directory" ? fullPath : path.dirname(fullPath)
  const glob =
    process.platform === "win32"
      ? FSUtil.normalizePathPattern(path.join(dir, "*"))
      : path.join(dir, "*").replaceAll("\\", "/")
  // The permission covers the whole external directory, but auto-approve only
  // the exact target file - a directory-wide `always` would silently authorize
  // every current and future file under it after a single confirmation.
  const autoApproved =
    process.platform === "win32" ? FSUtil.normalizePathPattern(fullPath) : fullPath.replaceAll("\\", "/")

  yield* ctx.ask({
    permission: "external_directory",
    patterns: [glob],
    always: [autoApproved],
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
