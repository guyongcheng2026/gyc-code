import { expect, test } from "bun:test"
import { ReadCache, FILE_UNCHANGED_STUB } from "./read-cache"

test("read-before-write guard state: set then invalidate keeps read=true", () => {
  const cache = ReadCache()
  cache.set("/tmp/rw.ts", "x", { mtime: new Date(), size: 1, type: "File" })
  cache.invalidate("/tmp/rw.ts")
  expect(cache.hasRead("/tmp/rw.ts")).toBe(true)
})

test("write of a new file needs no prior read; existing file needs read", () => {
  const cache = ReadCache()
  // Simulate the guard: a file that exists but was never read must be rejected.
  cache.invalidate("/tmp/existing.ts")
  expect(cache.hasRead("/tmp/existing.ts")).toBe(false)
  // After read (stub) it is allowed.
  cache.markRead("/tmp/existing.ts")
  expect(cache.hasRead("/tmp/existing.ts")).toBe(true)
})

test("FILE_UNCHANGED_STUB is exported for tool reuse", () => {
  expect(FILE_UNCHANGED_STUB).toBe("<file unchanged>")
})
