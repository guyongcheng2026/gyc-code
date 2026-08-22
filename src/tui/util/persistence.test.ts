import { mkdtempSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { readJson, readText, writeJsonAtomic, writeText } from "./persistence"

const dir = mkdtempSync(join(tmpdir(), "gyc-persist-"))
const file = join(dir, "a.txt")

describe("persistence", () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it("writeText + readText round-trip", async () => {
    await writeText(file, "hello")
    expect(await readText(file)).toBe("hello")
  })
  it("writeJsonAtomic + readJson round-trip, no temp leftovers", async () => {
    await writeJsonAtomic(file, { a: 1, b: "x" })
    expect(await readJson<{ a: number; b: string }>(file)).toEqual({ a: 1, b: "x" })
    expect(readdirSync(dir).length).toBe(1)
  })
})
