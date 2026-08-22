import { expect, test } from "bun:test"
import { Effect } from "effect"
import {
  detectMagicDocTitle,
  isMagicDocFile,
  buildMagicDocUpdatePrompt,
  MAGIC_DOC_HEADER,
  maybeRegisterMagicDoc,
  resetMagicDocRegistry,
  registeredMagicDocs,
  updateRegisteredMagicDocs,
  type MagicDocUpdater,
} from "./magic-docs"

test("MAGIC_DOC_HEADER constant", () => {
  expect(MAGIC_DOC_HEADER).toContain("MAGIC DOC")
})

test("detectMagicDocTitle extracts the title from a MAGIC DOC header", () => {
  expect(detectMagicDocTitle("# MAGIC DOC: Auth Module")).toBe("Auth Module")
  expect(detectMagicDocTitle("# MAGIC DOC: 缓存层")).toBe("缓存层")
  expect(detectMagicDocTitle("# not a magic doc")).toBeUndefined()
  expect(detectMagicDocTitle("")).toBeUndefined()
})

test("isMagicDocFile is true only for files with a MAGIC DOC header", () => {
  expect(isMagicDocFile("# MAGIC DOC: Payments")).toBe(true)
  expect(isMagicDocFile("# MAGIC DOC: Payments\nSome content")).toBe(true)
  expect(isMagicDocFile("plain docs without header")).toBe(false)
})

test("buildMagicDocUpdatePrompt includes the title and the current content", () => {
  const prompt = buildMagicDocUpdatePrompt("Auth Module", "current doc body")
  expect(prompt).toContain("Auth Module")
  expect(prompt).toContain("current doc body")
  expect(prompt.toLowerCase()).toContain("update")
})

test("maybeRegisterMagicDoc registers only MAGIC DOC files", () => {
  resetMagicDocRegistry()
  expect(maybeRegisterMagicDoc("/p/docs.md", "# MAGIC DOC: Auth")).toBe(true)
  expect(maybeRegisterMagicDoc("/p/other.md", "plain content")).toBe(false)
  const reg = registeredMagicDocs()
  expect(reg.size).toBe(1)
  expect(reg.get("/p/docs.md")).toBe("Auth")
})

test("updateRegisteredMagicDocs calls the updater for each registered doc", async () => {
  resetMagicDocRegistry()
  maybeRegisterMagicDoc("/p/a.md", "# MAGIC DOC: A")
  maybeRegisterMagicDoc("/p/b.md", "# MAGIC DOC: B")
  const updated: string[] = []
  const updater: MagicDocUpdater = (filepath, title, _content) => {
    updated.push(filepath)
    return Effect.succeed(`updated ${title}`)
  }
  await Effect.runPromise(updateRegisteredMagicDocs(updater))
  expect(updated.sort()).toEqual(["/p/a.md", "/p/b.md"])
})

test("updateRegisteredMagicDocs does nothing when no docs are registered", async () => {
  resetMagicDocRegistry()
  const calls: string[] = []
  const updater: MagicDocUpdater = (filepath) => {
    calls.push(filepath)
    return Effect.succeed("x")
  }
  await Effect.runPromise(updateRegisteredMagicDocs(updater))
  expect(calls).toEqual([])
})
