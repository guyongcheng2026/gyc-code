import { mkdtempSync, readdirSync, rmSync, writeFileSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, describe, expect, it } from "bun:test"
import { readJson, readText, writeJsonAtomic, writeJsonAtomicLogged, writeText } from "./persistence"

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
  it("writeJsonAtomicLogged swallows write failures (no unhandledRejection)", async () => {
    // 父路径是一个普通文件 → mkdir ENOTDIR：写入必然失败，
    // 但 writeJsonAtomicLogged 必须吸收异常而不是向调用方传播
    const blocker = join(dir, "blocker")
    writeFileSync(blocker, "x")
    await writeJsonAtomicLogged(join(blocker, "sub", "model.json"), { a: 1 }, "test")
  })
})
