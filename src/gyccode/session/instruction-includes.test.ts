import { expect, test } from "bun:test"
import { resolveIncludes, MAX_INCLUDE_DEPTH, TEXT_FILE_EXTENSIONS } from "./instruction-includes"

test("MAX_INCLUDE_DEPTH and TEXT_FILE_EXTENSIONS are sane", () => {
  expect(MAX_INCLUDE_DEPTH).toBeGreaterThanOrEqual(3)
  expect(TEXT_FILE_EXTENSIONS.size).toBeGreaterThan(50)
  expect(TEXT_FILE_EXTENSIONS.has("ts")).toBe(true)
  expect(TEXT_FILE_EXTENSIONS.has("py")).toBe(true)
})

test("resolveIncludes returns empty for content without @include", () => {
  expect(resolveIncludes("just some text\nno includes here")).toEqual([])
})

test("resolveIncludes extracts @path and @./path references", () => {
  const refs = resolveIncludes("See @CONVENTIONS.md and @./docs/rules.md for details.")
  expect(refs).toEqual(["CONVENTIONS.md", "docs/rules.md"])
})

test("resolveIncludes ignores @ mentions that are not file paths", () => {
  const refs = resolveIncludes("Thanks @user for the fix, see @README.md")
  expect(refs).toEqual(["README.md"])
})

test("resolveIncludes handles @~/ absolute and @/ rooted references", () => {
  const refs = resolveIncludes("Read @~/global/guide.md and @/repo/root.md")
  expect(refs).toEqual(["~/global/guide.md", "/repo/root.md"])
})
