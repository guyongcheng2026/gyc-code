import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { skillsRoot, usagePath } from "./paths"
import {
  bumpPatch,
  bumpUse,
  bumpView,
  isWritable,
  readUsage,
  recordCreated,
  setPinned,
  setState,
  type SkillUsageEntry,
} from "./usage"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gyc-usage-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** 播种账本文件：先把 skills/ 建出来，否则 writeFile 会因为父目录缺失抛 ENOENT。 */
async function seedUsage(content: string): Promise<void> {
  await mkdir(skillsRoot(root), { recursive: true })
  await writeFile(usagePath(root), content, "utf-8")
}

describe("readUsage", () => {
  it("文件缺失时返回空表而不是抛错", async () => {
    expect(await readUsage(root)).toEqual({})
  })

  it("文件损坏时返回空表而不是抛错", async () => {
    await seedUsage("{ 这不是 JSON")
    expect(await readUsage(root)).toEqual({})
  })

  it("JSON 是数组或标量时返回空表", async () => {
    await seedUsage("[1,2,3]\n")
    expect(await readUsage(root)).toEqual({})
  })

  it("字段缺失或类型错误的条目被补默认值，其余条目照常保留", async () => {
    await seedUsage(
      JSON.stringify({
        "pdf-export": { origin: "agent", state: "active", pinned: false, useCount: 3 },
        broken: { origin: "外星人", state: 9, useCount: "x" },
        "not-an-object": 42,
      }) + "\n",
    )
    const table = await readUsage(root)
    expect(table["pdf-export"]).toEqual({
      origin: "agent",
      state: "active",
      pinned: false,
      useCount: 3,
      viewCount: 0,
      patchCount: 0,
      createdAt: 0,
      lastActivityAt: 0,
    })
    expect(table.broken?.origin).toBe("agent")
    expect(table.broken?.state).toBe("active")
    expect(table.broken?.useCount).toBe(0)
    expect(table["not-an-object"]).toBeUndefined()
  })
})

describe("记录与计数", () => {
  it("recordCreated 建账并落盘为以换行结尾的 JSON", async () => {
    const entry = await recordCreated(root, "pdf-export")
    expect(entry.origin).toBe("agent")
    expect(entry.state).toBe("active")
    expect(entry.pinned).toBe(false)
    expect(entry.useCount).toBe(0)
    expect(entry.createdAt).toBeGreaterThan(0)

    const raw = await readFile(usagePath(root), "utf-8")
    expect(raw.endsWith("\n")).toBe(true)
    expect(JSON.parse(raw)["pdf-export"].origin).toBe("agent")
  })

  it("recordCreated 支持标记为谷总手工创建", async () => {
    const entry = await recordCreated(root, "pdf-export", "user")
    expect(entry.origin).toBe("user")
    expect(isWritable(entry)).toBe(false)
  })

  it("重复 recordCreated 不重置已有计数与 createdAt", async () => {
    const first = await recordCreated(root, "pdf-export")
    await bumpUse(root, "pdf-export")
    const again = await recordCreated(root, "pdf-export", "user")
    expect(again.useCount).toBe(1)
    expect(again.createdAt).toBe(first.createdAt)
    expect(again.origin).toBe("user")
  })

  it("bumpView / bumpUse / bumpPatch 各自累加并刷新最后活动时间", async () => {
    await recordCreated(root, "pdf-export")
    await bumpView(root, "pdf-export")
    await bumpView(root, "pdf-export")
    const afterUse = await bumpUse(root, "pdf-export")
    const afterPatch = await bumpPatch(root, "pdf-export")

    expect(afterUse.viewCount).toBe(2)
    expect(afterUse.useCount).toBe(1)
    expect(afterPatch.patchCount).toBe(1)
    expect(afterPatch.lastActivityAt).toBeGreaterThanOrEqual(afterPatch.createdAt)

    const table = await readUsage(root)
    expect(table["pdf-export"]?.useCount).toBe(1)
  })

  it("对未建账的技能计数会先补建条目", async () => {
    const entry = await bumpUse(root, "cache-warmer")
    expect(entry.useCount).toBe(1)
    expect(entry.origin).toBe("agent")
  })

  it("非法技能名不写盘，直接返回一次性的内存结果", async () => {
    const entry = await recordCreated(root, "../escape")
    expect(entry.state).toBe("active")
    expect(await readUsage(root)).toEqual({})
  })
})

describe("生命周期", () => {
  it("setState 与 setPinned 落盘生效", async () => {
    await recordCreated(root, "pdf-export")
    const archived = await setState(root, "pdf-export", "archived")
    expect(archived.state).toBe("archived")
    const pinned = await setPinned(root, "pdf-export", true)
    expect(pinned.pinned).toBe(true)

    const table = await readUsage(root)
    expect(table["pdf-export"]?.state).toBe("archived")
    expect(table["pdf-export"]?.pinned).toBe(true)
  })

  it("isWritable 只认非钉住的 agent 产物", () => {
    const base: SkillUsageEntry = {
      origin: "agent",
      state: "active",
      pinned: false,
      useCount: 0,
      viewCount: 0,
      patchCount: 0,
      createdAt: 0,
      lastActivityAt: 0,
    }
    expect(isWritable(base)).toBe(true)
    expect(isWritable({ ...base, origin: "user" })).toBe(false)
    expect(isWritable({ ...base, pinned: true })).toBe(false)
  })
})

describe("并发与容错", () => {
  it("并发计数不丢更新（模块级队列串行化）", async () => {
    await recordCreated(root, "pdf-export")
    await Promise.all([
      ...Array.from({ length: 20 }, () => bumpUse(root, "pdf-export")),
      ...Array.from({ length: 10 }, () => bumpView(root, "pdf-export")),
      ...Array.from({ length: 5 }, () => bumpPatch(root, "pdf-export")),
      ...Array.from({ length: 3 }, (_, i) => recordCreated(root, `skill-${i}`)),
    ])

    const table = await readUsage(root)
    expect(table["pdf-export"]?.useCount).toBe(20)
    expect(table["pdf-export"]?.viewCount).toBe(10)
    expect(table["pdf-export"]?.patchCount).toBe(5)
    expect(Object.keys(table).sort()).toEqual([
      "pdf-export",
      "skill-0",
      "skill-1",
      "skill-2",
    ])
  })

  it("目录不可创建时静默降级，不把异常抛给调用方", async () => {
    await writeFile(path.join(root, "blocked"), "x", "utf-8")
    // 用一个「父路径是普通文件」的 root 触发写入失败
    const blockedRoot = path.join(root, "blocked")
    const entry = await recordCreated(blockedRoot, "pdf-export")
    expect(entry.origin).toBe("agent")
    expect(await readUsage(blockedRoot)).toEqual({})
  })
})
