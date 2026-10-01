import { expect, test } from "bun:test"
import { Effect } from "effect"
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import * as path from "node:path"
import { backup, list, rollback } from "./file-backup"

/** 每个测试用独立的备份根目录，避免互相污染 */
const makeRoot = async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "gyc-backup-"))
  const root = path.join(dir, "store")
  const file = path.join(dir, "work", "a.ts")
  await mkdir(path.dirname(file), { recursive: true })
  return { dir, root, file }
}

const setup = async (content: string) => {
  const ctx = await makeRoot()
  await writeFile(ctx.file, content)
  return ctx
}

test("写前备份保存的是落盘前的内容", async () => {
  const { dir, root, file } = await setup("original\n")
  const saved = await Effect.runPromise(backup(file, { root }))
  expect(saved).toBeDefined()
  expect(await readFile(saved!, "utf8")).toBe("original\n")

  // 备份落盘后目标文件被改写，备份内容不受影响
  await writeFile(file, "modified\n")
  expect(await readFile(saved!, "utf8")).toBe("original\n")
  await rm(dir, { recursive: true, force: true })
})

test("备份按文件隔离，不同文件互不覆盖", async () => {
  const ctx = await makeRoot()
  const other = path.join(ctx.dir, "work", "b.ts")
  await writeFile(ctx.file, "a")
  await writeFile(other, "b")
  const first = await Effect.runPromise(backup(ctx.file, { root: ctx.root }))
  const second = await Effect.runPromise(backup(other, { root: ctx.root }))
  expect(first).not.toBe(second)
  expect(await readFile(first!, "utf8")).toBe("a")
  expect(await readFile(second!, "utf8")).toBe("b")
  await rm(ctx.dir, { recursive: true, force: true })
})

test("连续多次写入后，rollback 精确回到上一次写入前", async () => {
  const { dir, root, file } = await setup("v0")
  // 模拟三次「先备份、再覆盖」
  await Effect.runPromise(backup(file, { root }))
  await writeFile(file, "v1")
  await Effect.runPromise(backup(file, { root }))
  await writeFile(file, "v2")
  await Effect.runPromise(backup(file, { root }))
  await writeFile(file, "v3")

  const ok = await Effect.runPromise(rollback(file, { root }))
  expect(ok).toBe(true)
  expect(await readFile(file, "utf8")).toBe("v2")
  await rm(dir, { recursive: true, force: true })
})

test("文件原本不存在时记录 absent 标记，rollback 删除新建的文件", async () => {
  const { dir, root, file } = await makeRoot()
  const saved = await Effect.runPromise(backup(file, { root }))
  expect(saved).toBeDefined()

  await writeFile(file, "brand new")
  const ok = await Effect.runPromise(rollback(file, { root }))
  expect(ok).toBe(true)
  await expect(readFile(file, "utf8")).rejects.toThrow()
  await rm(dir, { recursive: true, force: true })
})

test("list 按时间升序返回该文件的历史备份", async () => {
  const { dir, root, file } = await setup("v0")
  await Effect.runPromise(backup(file, { root }))
  await writeFile(file, "v1")
  await Effect.runPromise(backup(file, { root }))

  const entries = await Effect.runPromise(list(file, { root }))
  expect(entries.length).toBe(2)
  expect(entries.every((item) => item.absent === false)).toBe(true)
  for (let i = 1; i < entries.length; i++) {
    expect(entries[i]!.time).toBeGreaterThanOrEqual(entries[i - 1]!.time)
  }
  expect(await readFile(entries[0]!.path, "utf8")).toBe("v0")
  expect(await readFile(entries[1]!.path, "utf8")).toBe("v1")
  await rm(dir, { recursive: true, force: true })
})

test("超过 keep 上限后只保留最近的备份", async () => {
  const { dir, root, file } = await setup("v0")
  for (let i = 0; i < 5; i++) {
    await Effect.runPromise(backup(file, { root, keep: 2 }))
    await writeFile(file, `v${i + 1}`)
  }
  const entries = await Effect.runPromise(list(file, { root }))
  expect(entries.length).toBe(2)
  // 保留下来的应是最近两次（v3 / v4）
  expect(await readFile(entries[0]!.path, "utf8")).toBe("v3")
  expect(await readFile(entries[1]!.path, "utf8")).toBe("v4")
  await rm(dir, { recursive: true, force: true })
})

test("无备份时 rollback 返回 false 且不改动文件", async () => {
  const { dir, root, file } = await setup("keep me")
  const ok = await Effect.runPromise(rollback(file, { root }))
  expect(ok).toBe(false)
  expect(await readFile(file, "utf8")).toBe("keep me")
  await rm(dir, { recursive: true, force: true })
})

test("二进制内容按字节保真备份", async () => {
  const { dir, root, file } = await makeRoot()
  const bytes = new Uint8Array([0x00, 0xff, 0xfe, 0x80, 0x0a])
  await writeFile(file, bytes)
  const saved = await Effect.runPromise(backup(file, { root }))
  const restored = new Uint8Array(await readFile(saved!))
  expect(Array.from(restored)).toEqual(Array.from(bytes))
  await rm(dir, { recursive: true, force: true })
})

test("同一毫秒内连续备份不会互相覆盖", async () => {
  const { dir, root, file } = await setup("v0")
  const a = await Effect.runPromise(backup(file, { root }))
  const b = await Effect.runPromise(backup(file, { root }))
  expect(a).not.toBe(b)
  const entries = await Effect.runPromise(list(file, { root }))
  expect(entries.length).toBe(2)
  const names = await readdir(path.dirname(a!))
  expect(names.length).toBeGreaterThanOrEqual(2)
  await rm(dir, { recursive: true, force: true })
})
