// 最终审查发现的三处缺陷的回归测试。
//
// 1. archive / restore 漏了 provenance 闸门——谷总手写或已钉住的技能会被自动流程搬走。
// 2. create 继承陈旧用量条目——目录已删但 .usage.json 还在时，新技能会继承
//    pinned / origin=user，此后每次改写都被无声拒绝。
// 3. 回滚只删文件不删目录——create 回滚留下的空技能目录会让同名技能再也 create 不出来。

import { afterEach, beforeEach, describe, expect, it } from "bun:test"
import { mkdtemp, rm, stat } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { make } from "./skill-store"
import { appendEntry, readLedger, rollbackEntry } from "./ledger"
import { readUsage, recordCreated, setPinned } from "./usage"
import { skillDir } from "./paths"

let root: string

beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "gyc-review-fixes-"))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

async function exists(target: string): Promise<boolean> {
  return stat(target).then(
    () => true,
    () => false,
  )
}

describe("provenance 闸门覆盖归档与恢复", () => {
  it("拒绝归档 origin 为 user 的技能", async () => {
    const store = make(root)
    await store.create({ name: "hand-written", description: "d", body: "b", sessionId: "s" })
    // 把归属改成谷总手写：此后任何自动流程都不该再动它
    await recordCreated(root, "hand-written", "user")

    const result = await store.archive({ name: "hand-written", sessionId: "s", reason: "auto" })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.reason).toBe("not-writable")
    expect(await exists(skillDir(root, "hand-written"))).toBe(true)
  })

  it("拒绝归档已钉住的技能", async () => {
    const store = make(root)
    await store.create({ name: "pinned-skill", description: "d", body: "b", sessionId: "s" })
    await setPinned(root, "pinned-skill", true)

    const result = await store.archive({ name: "pinned-skill", sessionId: "s", reason: "auto" })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.reason).toBe("not-writable")
    expect(await exists(skillDir(root, "pinned-skill"))).toBe(true)
  })

  it("拒绝恢复已钉住的技能", async () => {
    const store = make(root)
    await store.create({ name: "pinned-restore", description: "d", body: "b", sessionId: "s" })
    await store.archive({ name: "pinned-restore", sessionId: "s", reason: "manual" })
    await setPinned(root, "pinned-restore", true)

    const result = await store.restore({ name: "pinned-restore", sessionId: "s" })

    expect(result.ok).toBe(false)
    expect(result.ok ? undefined : result.reason).toBe("not-writable")
  })

  it("自建且未钉住的技能仍可正常归档与恢复", async () => {
    const store = make(root)
    await store.create({ name: "normal-skill", description: "d", body: "b", sessionId: "s" })

    const archived = await store.archive({ name: "normal-skill", sessionId: "s", reason: "manual" })
    expect(archived.ok).toBe(true)

    const restored = await store.restore({ name: "normal-skill", sessionId: "s" })
    expect(restored.ok).toBe(true)
    expect(await exists(skillDir(root, "normal-skill"))).toBe(true)
  })
})

describe("create 不继承陈旧用量条目", () => {
  it("残留的 pinned 条目不会让新技能变成只读", async () => {
    // 制造中间态：.usage.json 有条目、磁盘上却没有对应目录
    await recordCreated(root, "recycled-name", "user")
    await setPinned(root, "recycled-name", true)
    expect(await exists(skillDir(root, "recycled-name"))).toBe(false)

    const store = make(root)
    const created = await store.create({ name: "recycled-name", description: "d", body: "b", sessionId: "s" })
    expect(created.ok).toBe(true)

    const entry = (await readUsage(root))["recycled-name"]
    expect(entry?.origin).toBe("agent")
    expect(entry?.pinned).toBe(false)

    // 关键：新技能必须能被立即改写，而不是被旧条目拖成 not-writable
    await store.read("recycled-name")
    const patched = await store.patch({ name: "recycled-name", body: "b2", sessionId: "s" })
    expect(patched.ok).toBe(true)
  })

  it("残留的 archived 状态不会让新技能永久停留在 archived", async () => {
    await recordCreated(root, "archived-name", "agent")
    const { setState } = await import("./usage")
    await setState(root, "archived-name", "archived")

    const store = make(root)
    const created = await store.create({ name: "archived-name", description: "d", body: "b", sessionId: "s" })

    expect(created.ok).toBe(true)
    expect((await readUsage(root))["archived-name"]?.state).toBe("active")
  })
})

describe("回滚清理空目录", () => {
  it("回滚 create 后同名技能可以重新创建", async () => {
    const store = make(root)
    await store.create({ name: "rolled-back", description: "d", body: "b", sessionId: "s" })
    const ledger = await readLedger(root)
    const createEntry = ledger.find((item) => item.action === "create")
    expect(createEntry).toBeDefined()

    await rollbackEntry(root, createEntry!.id)

    expect(await exists(skillDir(root, "rolled-back"))).toBe(false)

    // 关键：空目录若残留，这里会拿到 already-exists
    const recreated = await store.create({ name: "rolled-back", description: "d2", body: "b2", sessionId: "s" })
    expect(recreated.ok).toBe(true)
  })

  it("回滚 write_file 会收走新建的支持文件及其空目录", async () => {
    const store = make(root)
    await store.create({ name: "support-rollback", description: "d", body: "b", sessionId: "s" })
    await store.writeSupportFile({
      name: "support-rollback",
      filePath: "references/note.md",
      content: "x",
      sessionId: "s",
    })

    const ledger = await readLedger(root)
    const writeEntry = ledger.find((item) => item.action === "write_file")
    await rollbackEntry(root, writeEntry!.id)

    expect(await exists(path.join(skillDir(root, "support-rollback"), "references"))).toBe(false)
    // 技能本身还在（before 里有 SKILL.md，会被写回）
    expect(await exists(path.join(skillDir(root, "support-rollback"), "SKILL.md"))).toBe(true)
  })

  it("回滚不会误删其他文件", async () => {
    const store = make(root)
    await store.create({ name: "keep-others", description: "d", body: "b", sessionId: "s" })
    await store.writeSupportFile({
      name: "keep-others",
      filePath: "references/kept.md",
      content: "keep me",
      sessionId: "s",
    })

    const ledgerBefore = await readLedger(root)
    const createEntry = ledgerBefore.find((item) => item.action === "create")
    await rollbackEntry(root, createEntry!.id)

    // 回滚的是 create，reference 是在其后新增的、没记在那条账目里，必须原样保留
    expect(await exists(path.join(skillDir(root, "keep-others"), "references", "kept.md"))).toBe(true)
  })
})
