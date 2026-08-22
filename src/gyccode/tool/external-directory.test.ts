import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import { mkdtemp, mkdir, rm, symlink, writeFile } from "fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"
import { InstanceRef } from "@/effect/instance-ref"
import { assertExternalDirectoryEffect } from "./external-directory"
import { FSUtil } from "@gyccode/core/fs-util"
import type { InstanceContext } from "@/project/instance-context"
import type { Tool } from "./tool"

const makeInstance = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "gyc-extdir-"))
  const worktree = path.join(root, "worktree")
  await mkdir(worktree)
  return { root, worktree }
}

const instanceOf = (worktree: string): InstanceContext => ({
  directory: worktree,
  worktree,
  project: {
    id: "prj_test" as never,
    worktree,
    vcs: undefined,
    name: undefined,
    icon: undefined,
    commands: undefined,
    time: { created: 0, updated: 0 },
    sandboxes: [],
  },
})

const run = <A, E>(effect: Effect.Effect<A, E>, worktree: string) =>
  Effect.runPromise(Effect.provideService(InstanceRef, instanceOf(worktree))(effect))

const makeCtx = () => {
  const asks: Array<{ permission: string; always: unknown[] }> = []
  const toolCtx = {
    sessionID: "s1",
    messageID: "m1",
    agent: "test",
    abort: new AbortController().signal,
    messages: [],
    metadata: () => Effect.void,
    ask: (input: { permission: string; always?: unknown[] }) =>
      Effect.sync(() => {
        asks.push({ permission: input.permission, always: input.always ?? [] })
      }),
  } as unknown as Tool.Context
  return { toolCtx, asks }
}

describe("assertExternalDirectory", () => {
  it("treats an existing file inside the worktree as internal", async () => {
    const { root, worktree } = await makeInstance()
    try {
      const file = path.join(worktree, "a.txt")
      await writeFile(file, "x")
      const { toolCtx, asks } = makeCtx()
      const result = await run(assertExternalDirectoryEffect(toolCtx, file), worktree)
      expect(result).toBe(false)
      expect(asks).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("treats a new file inside the worktree as internal (no false positive)", async () => {
    const { root, worktree } = await makeInstance()
    try {
      const file = path.join(worktree, "new.txt")
      const { toolCtx, asks } = makeCtx()
      const result = await run(assertExternalDirectoryEffect(toolCtx, file), worktree)
      expect(result).toBe(false)
      expect(asks).toHaveLength(0)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("requests authorization for a path outside the worktree", async () => {
    const { root, worktree } = await makeInstance()
    try {
      const outside = path.join(root, "outside.txt")
      await writeFile(outside, "x")
      const { toolCtx, asks } = makeCtx()
      const result = await run(assertExternalDirectoryEffect(toolCtx, outside), worktree)
      expect(result).toBe(true)
      expect(asks).toHaveLength(1)
      // auto-approve is scoped to the exact target, not the whole directory
      expect(asks[0].always).toEqual([FSUtil.normalizePathPattern(outside)])
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("treats a symlink escaping the worktree as external", async () => {
    const { root, worktree } = await makeInstance()
    try {
      const outside = path.join(root, "target.txt")
      await writeFile(outside, "x")
      const link = path.join(worktree, "link.txt")
      let linkOk = true
      try {
        await symlink(outside, link)
      } catch {
        linkOk = false // Windows may lack symlink privileges; skip the assertion
      }
      if (!linkOk) return
      const { toolCtx, asks } = makeCtx()
      const result = await run(assertExternalDirectoryEffect(toolCtx, link), worktree)
      expect(result).toBe(true)
      expect(asks).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })

  it("fails closed on a broken symlink pointing outside the worktree", async () => {
    const { root, worktree } = await makeInstance()
    try {
      // symlink whose target does not exist (writing would create it outside)
      const link = path.join(worktree, "broken.txt")
      const dangling = path.join(root, "does-not-exist.txt")
      let linkOk = true
      try {
        await symlink(dangling, link)
      } catch {
        linkOk = false
      }
      if (!linkOk) return
      const { toolCtx, asks } = makeCtx()
      const result = await run(assertExternalDirectoryEffect(toolCtx, link), worktree)
      expect(result).toBe(true)
      expect(asks).toHaveLength(1)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})