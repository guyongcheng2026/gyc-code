// 技能存储的两道闸门单测：provenance 白名单 + read-before-write。
// 一律使用 mkdtemp 造的临时 root，绝不让测试碰到真实的技能目录。
import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { readLedger } from "./ledger"
import { archiveRoot, skillDir, skillFile } from "./paths"
import { make } from "./skill-store"
import { readUsage, recordCreated, setPinned } from "./usage"

const roots: string[] = []

/** 每个用例一个全新临时 root；afterEach 统一清理。 */
async function freshRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "gyc-store-"))
  roots.push(root)
  return root
}

afterEach(async () => {
  const pending = roots.splice(0)
  await Promise.all(pending.map((root) => rm(root, { recursive: true, force: true })))
})

async function exists(target: string): Promise<boolean> {
  try {
    await stat(target)
    return true
  } catch {
    return false
  }
}

async function archivedNames(root: string): Promise<string[]> {
  try {
    const entries = await readdir(archiveRoot(root), { withFileTypes: true })
    return entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    return []
  }
}

describe("learning/skill-store create 与 SKILL.md 格式", () => {
  it("create 合法名 → ok，SKILL.md 带 frontmatter，用量账本 origin 为 agent", async () => {
    const root = await freshRoot()
    const store = make(root)

    const result = await store.create({
      name: "pdf-export",
      description: "把文档导出为 PDF",
      body: "第一步：确认输入文件。",
      sessionId: "s-1",
    })
    expect(result).toEqual({ ok: true })

    const raw = await readFile(skillFile(root, "pdf-export"), "utf-8")
    expect(raw.startsWith("---\n")).toBe(true)
    expect(raw).toContain("name: pdf-export\n")
    expect(raw).toContain("description: 把文档导出为 PDF\n")
    expect(raw).toContain("第一步：确认输入文件。")

    const info = await store.read("pdf-export")
    expect(info?.name).toBe("pdf-export")
    expect(info?.description).toBe("把文档导出为 PDF")
    expect(info?.body).toBe("第一步：确认输入文件。")
    expect(info?.files).toEqual(["SKILL.md"])

    const usage = await readUsage(root)
    expect(usage["pdf-export"]?.origin).toBe("agent")
    expect(usage["pdf-export"]?.state).toBe("active")

    expect(await store.list()).toEqual(["pdf-export"])
  })

  it("create 非法名 fix-1234 → invalid-name", async () => {
    const root = await freshRoot()
    const store = make(root)

    const result = await store.create({
      name: "fix-1234",
      description: "一次性修复速记",
      body: "不该沉淀",
      sessionId: "s-1",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("invalid-name")
    expect(await exists(skillDir(root, "fix-1234"))).toBe(false)
  })

  it("create 已存在的技能 → already-exists", async () => {
    const root = await freshRoot()
    const store = make(root)
    const first = await store.create({
      name: "cache-warmup",
      description: "预热缓存",
      body: "正文",
      sessionId: "s-1",
    })
    expect(first).toEqual({ ok: true })

    const second = await store.create({
      name: "cache-warmup",
      description: "另一个描述",
      body: "另一份正文",
      sessionId: "s-2",
    })
    expect(second.ok).toBe(false)
    if (!second.ok) expect(second.reason).toBe("already-exists")

    const raw = await readFile(skillFile(root, "cache-warmup"), "utf-8")
    expect(raw).toContain("预热缓存")
  })
})

describe("learning/skill-store 闸门一：provenance 白名单", () => {
  it("patch 手写/外部安装（未登记）的技能 → not-writable", async () => {
    const root = await freshRoot()
    const store = make(root)
    await mkdir(skillDir(root, "hand-written"), { recursive: true })
    await writeFile(
      skillFile(root, "hand-written"),
      "---\nname: hand-written\ndescription: 手写的\n---\n\n正文\n",
      "utf-8",
    )

    // 未登记的技能同样能被列出来与读到，但改写必须被挡
    expect(await store.list()).toEqual(["hand-written"])
    expect((await store.read("hand-written"))?.description).toBe("手写的")

    const result = await store.patch({
      name: "hand-written",
      body: "偷改",
      sessionId: "s-1",
    })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("not-writable")

    const raw = await readFile(skillFile(root, "hand-written"), "utf-8")
    expect(raw).toContain("正文")
    expect(raw).not.toContain("偷改")
  })

  it("patch origin 为 user 或已被钉住的技能 → not-writable", async () => {
    const root = await freshRoot()
    const store = make(root)
    for (const name of ["curated-by-gyc", "pinned-skill"]) {
      await store.create({ name, description: "描述", body: "正文", sessionId: "s-1" })
    }
    await recordCreated(root, "curated-by-gyc", "user")
    await setPinned(root, "pinned-skill", true)

    for (const name of ["curated-by-gyc", "pinned-skill"]) {
      await store.read(name)
      const result = await store.patch({ name, body: "新的正文", sessionId: "s-1" })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe("not-writable")
    }
  })
})

describe("learning/skill-store 闸门二：read-before-write", () => {
  it("patch 刚 create 的技能但未先 read → read-before-write", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "note-taking", description: "记笔记", body: "旧正文", sessionId: "s-1" })

    const result = await store.patch({ name: "note-taking", body: "新正文", sessionId: "s-1" })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe("read-before-write")

    const raw = await readFile(skillFile(root, "note-taking"), "utf-8")
    expect(raw).toContain("旧正文")
  })

  it("先 read 再 patch → ok，正文更新，patchCount 为 1", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "note-taking", description: "记笔记", body: "旧正文", sessionId: "s-1" })
    expect(await store.read("note-taking")).toBeDefined()

    const result = await store.patch({ name: "note-taking", body: "新正文", sessionId: "s-1" })
    expect(result).toEqual({ ok: true })

    const info = await store.read("note-taking")
    expect(info?.body).toBe("新正文")
    expect(info?.description).toBe("记笔记")
    expect((await readUsage(root))["note-taking"]?.patchCount).toBe(1)
  })

  it("patch 只给 body → description 保持原值", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({
      name: "note-taking",
      description: "记笔记的固定描述",
      body: "第一版",
      sessionId: "s-1",
    })
    await store.read("note-taking")

    const result = await store.patch({ name: "note-taking", body: "第二版", sessionId: "s-1" })
    expect(result).toEqual({ ok: true })

    const info = await store.read("note-taking")
    expect(info?.description).toBe("记笔记的固定描述")
    expect(info?.body).toBe("第二版")

    // patch 未提供 description 且正文都被改过时，依然保持原值而非清空
    const again = await store.patch({ name: "note-taking", body: "", sessionId: "s-1" })
    expect(again).toEqual({ ok: true })
    expect((await store.read("note-taking"))?.description).toBe("记笔记的固定描述")
  })
})

describe("learning/skill-store 支持文件", () => {
  it("writeSupportFile 新建 references/x.md（未先读）→ ok，内容正确", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "api-notes", description: "接口笔记", body: "正文", sessionId: "s-1" })

    const result = await store.writeSupportFile({
      name: "api-notes",
      filePath: "references/x.md",
      content: "# 参考\n细节",
      sessionId: "s-1",
    })
    expect(result).toEqual({ ok: true })

    const target = path.join(skillDir(root, "api-notes"), "references", "x.md")
    expect(await readFile(target, "utf-8")).toBe("# 参考\n细节")
    expect((await store.read("api-notes"))?.files).toEqual(["SKILL.md", "references/x.md"])
    expect((await readUsage(root))["api-notes"]?.patchCount).toBe(1)
  })

  it("writeSupportFile 路径逃逸或指向 SKILL.md → invalid-support-path", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "api-notes", description: "接口笔记", body: "正文", sessionId: "s-1" })

    for (const filePath of ["references/../../secret.md", "../outside.md", "SKILL.md", "assets/a.md"]) {
      const result = await store.writeSupportFile({
        name: "api-notes",
        filePath,
        content: "越界内容",
        sessionId: "s-1",
      })
      expect(result.ok).toBe(false)
      if (!result.ok) expect(result.reason).toBe("invalid-support-path")
    }
    expect(await exists(path.join(root, "secret.md"))).toBe(false)
    expect(await exists(path.join(skillDir(root, "api-notes"), "SKILL.md"))).toBe(true)
  })

  it("writeSupportFile 覆盖已存在文件前必须 readSupportFile → read-before-write", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "api-notes", description: "接口笔记", body: "正文", sessionId: "s-1" })
    const first = await store.writeSupportFile({
      name: "api-notes",
      filePath: "references/x.md",
      content: "第一版",
      sessionId: "s-1",
    })
    expect(first).toEqual({ ok: true })

    const blocked = await store.writeSupportFile({
      name: "api-notes",
      filePath: "references/x.md",
      content: "第二版",
      sessionId: "s-1",
    })
    expect(blocked.ok).toBe(false)
    if (!blocked.ok) expect(blocked.reason).toBe("read-before-write")
    expect(
      await readFile(path.join(skillDir(root, "api-notes"), "references", "x.md"), "utf-8"),
    ).toBe("第一版")

    expect(await store.readSupportFile("api-notes", "references/x.md")).toBe("第一版")
    const allowed = await store.writeSupportFile({
      name: "api-notes",
      filePath: "references/x.md",
      content: "第二版",
      sessionId: "s-1",
    })
    expect(allowed).toEqual({ ok: true })
    expect(
      await readFile(path.join(skillDir(root, "api-notes"), "references", "x.md"), "utf-8"),
    ).toBe("第二版")
  })
})

describe("learning/skill-store 归档与恢复", () => {
  it("archive → 技能目录消失、归档区出现、usage 状态为 archived", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "old-flow", description: "旧流程", body: "正文", sessionId: "s-1" })

    const result = await store.archive({ name: "old-flow", sessionId: "s-1", reason: "被新流程取代" })
    expect(result).toEqual({ ok: true })

    expect(await exists(skillDir(root, "old-flow"))).toBe(false)
    const names = await archivedNames(root)
    expect(names).toHaveLength(1)
    expect(names[0]?.startsWith("old-flow-")).toBe(true)
    expect((await readUsage(root))["old-flow"]?.state).toBe("archived")
    expect(await store.list()).toEqual([])
  })

  it("archive 后 restore → 技能目录回来、状态为 active", async () => {
    const root = await freshRoot()
    const store = make(root)
    await store.create({ name: "old-flow", description: "旧流程", body: "正文", sessionId: "s-1" })
    await store.archive({ name: "old-flow", sessionId: "s-1", reason: "暂时收起" })

    const result = await store.restore({ name: "old-flow", sessionId: "s-1" })
    expect(result).toEqual({ ok: true })

    expect(await exists(skillFile(root, "old-flow"))).toBe(true)
    expect(await archivedNames(root)).toEqual([])
    expect((await readUsage(root))["old-flow"]?.state).toBe("active")
    expect((await store.read("old-flow"))?.body).toBe("正文")
  })

  it("archive / restore 找不到目标 → not-found", async () => {
    const root = await freshRoot()
    const store = make(root)

    const missing = await store.archive({ name: "no-such-skill", sessionId: "s-1", reason: "无" })
    expect(missing.ok).toBe(false)
    if (!missing.ok) expect(missing.reason).toBe("not-found")

    const noBackup = await store.restore({ name: "no-such-skill", sessionId: "s-1" })
    expect(noBackup.ok).toBe(false)
    if (!noBackup.ok) expect(noBackup.reason).toBe("not-found")
  })
})

describe("learning/skill-store 记账", () => {
  it("每次成功变更都在 .ledger.jsonl 留一条，action 正确", async () => {
    const root = await freshRoot()
    const store = make(root)

    expect(await readLedger(root)).toHaveLength(0)

    await store.create({ name: "ledger-demo", description: "记账演示", body: "第一版", sessionId: "s-1" })
    let entries = await readLedger(root)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.action).toBe("create")
    expect(entries[0]?.before).toEqual([])
    expect(entries[0]?.after.map((snap) => snap.path)).toEqual(["SKILL.md"])

    await store.read("ledger-demo")
    await store.patch({ name: "ledger-demo", body: "第二版", sessionId: "s-1" })
    entries = await readLedger(root)
    expect(entries).toHaveLength(2)
    expect(entries[1]?.action).toBe("patch")

    await store.writeSupportFile({
      name: "ledger-demo",
      filePath: "references/x.md",
      content: "支持文件",
      sessionId: "s-1",
    })
    entries = await readLedger(root)
    expect(entries).toHaveLength(3)
    expect(entries[2]?.action).toBe("write_file")
    expect(entries[2]?.after.map((snap) => snap.path)).toEqual(["SKILL.md", "references/x.md"])

    await store.archive({ name: "ledger-demo", sessionId: "s-1", reason: "演示归档" })
    entries = await readLedger(root)
    expect(entries).toHaveLength(4)
    expect(entries[3]?.action).toBe("archive")

    await store.restore({ name: "ledger-demo", sessionId: "s-1" })
    entries = await readLedger(root)
    expect(entries).toHaveLength(5)
    expect(entries[4]?.action).toBe("restore")

    // 被拒绝的操作不留账：换一个本轮从未读过的技能，触发 read-before-write
    // （ledger-demo 上面已 read 过，readMark 命中，patch 不会被拒）
    await store.create({ name: "gate-demo", description: "闸门演示", body: "第一版", sessionId: "s-1" })
    entries = await readLedger(root)
    expect(entries).toHaveLength(6)
    expect(entries[5]?.action).toBe("create")

    const rejected = await store.patch({ name: "gate-demo", body: "第三版", sessionId: "s-1" })
    expect(rejected.ok).toBe(false)
    if (!rejected.ok) expect(rejected.reason).toBe("read-before-write")
    expect(await readLedger(root)).toHaveLength(6)
  })
})
