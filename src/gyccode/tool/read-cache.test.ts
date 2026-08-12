import { expect, test } from "bun:test"
import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ReadCache } from "./read-cache"

test("hasRead is false for unseen file, true after markRead", () => {
  const cache = ReadCache()
  expect(cache.hasRead("C:/proj/a.ts")).toBe(false)
  cache.markRead("C:/proj/a.ts")
  expect(cache.hasRead("C:/proj/a.ts")).toBe(true)
})

test("set() also marks the file as read", () => {
  const cache = ReadCache()
  cache.set("C:/proj/b.ts", "content", { mtime: new Date(), size: 7, type: "File" })
  expect(cache.hasRead("C:/proj/b.ts")).toBe(true)
})

test("invalidate clears content but keeps read state", () => {
  const cache = ReadCache()
  cache.markRead("C:/proj/c.ts")
  cache.invalidate("C:/proj/c.ts")
  expect(cache.get("C:/proj/c.ts")).toBeUndefined()
  expect(cache.hasRead("C:/proj/c.ts")).toBe(true)
})


test("backslash and forward-slash paths share the same cache key", () => {
  const cache = ReadCache()
  const dir = mkdtempSync(join(tmpdir(), "readcache-"))
  const f = join(dir, "x.ts")
  writeFileSync(f, "content")
  cache.markRead(f)
  // read.ts normalizes on Windows (backslash->slash); write/edit must match
  expect(cache.hasRead(f.replace(/\\/g, "/"))).toBe(true)
  rmSync(dir, { recursive: true, force: true })
})
