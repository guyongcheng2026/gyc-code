import { afterEach, describe, expect, it } from "bun:test"
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { blobsDir, ledgerPath, skillDir } from "./paths"
import { appendEntry, readLedger, rollbackEntry, sha256, snapshotSkill } from "./ledger"

let root: string

async function makeRoot(): Promise<string> {
  root = await mkdtemp(path.join(tmpdir(), "gyc-ledger-"))
  return root
}

afterEach(async () => {
  if (root !== undefined) await rm(root, { recursive: true, force: true })
})

/** 在临时技能目录下写一个文件，自动补齐父目录。 */
async function putSkillFile(skill: string, relPath: string, content: string): Promise<string> {
  const file = path.join(skillDir(root, skill), relPath)
  await mkdir(path.dirname(file), { recursive: true })
  await writeFile(file, content, "utf-8")
  return file
}

async function listBlobs(): Promise<string[]> {
  try {
    return (await readdir(blobsDir(root))).sort()
  } catch {
    return []
  }
}

describe("sha256", () => {
  it("相同内容稳定得到同一摘要", () => {
    expect(sha256("技能正文")).toBe(sha256("技能正文"))
    expect(sha256("技能正文")).toMatch(/^[0-9a-f]{64}$/)
  })

  it("不同内容得到不同摘要", () => {
    expect(sha256("甲")).not.toBe(sha256("乙"))
  })
})

describe("snapshotSkill", () => {
  it("递归列出全部文件并给出 sha256，内容落进 .blobs", async () => {
    await makeRoot()
    await putSkillFile("pdf-export", "SKILL.md", "v1")
    await putSkillFile("pdf-export", "references/note.md", "参考")
    await putSkillFile("pdf-export", "scripts/run.sh", "echo hi")

    const snaps = await snapshotSkill(root, "pdf-export")
    expect(snaps.map((s) => s.path)).toEqual(["SKILL.md", "references/note.md", "scripts/run.sh"])
    const byPath = new Map(snaps.map((s) => [s.path, s.sha256]))
    expect(byPath.get("SKILL.md")).toBe(sha256("v1"))
    expect(byPath.get("references/note.md")).toBe(sha256("参考"))

    const blobs = await listBlobs()
    expect(blobs).toHaveLength(3)
    for (const s of snaps) {
      expect(blobs).toContain(s.sha256)
      expect(await readFile(path.join(blobsDir(root), s.sha256), "utf-8")).toBe(
        await readFile(path.join(skillDir(root, "pdf-export"), s.path), "utf-8"),
      )
    }
  })

  it("技能目录不存在时返回空数组而不是抛错", async () => {
    await makeRoot()
    expect(await snapshotSkill(root, "no-such-skill")).toEqual([])
  })

  it("相同内容只落一份 blob（内容寻址）", async () => {
    await makeRoot()
    await putSkillFile("dup-content", "a.txt", "同一份内容")
    await putSkillFile("dup-content", "nested/b.txt", "同一份内容")
    await putSkillFile("dup-content", "c.txt", "另一份内容")

    const snaps = await snapshotSkill(root, "dup-content")
    expect(snaps).toHaveLength(3)
    expect(new Set(snaps.map((s) => s.sha256)).size).toBe(2)
    expect(await listBlobs()).toHaveLength(2)
  })
})

describe("appendEntry", () => {
  it("每次追加一行 JSONL，字段齐全且时间戳是 ISO 格式", async () => {
    await makeRoot()
    const first = await appendEntry(root, {
      actor: "agent",
      action: "create",
      skill: "pdf-export",
      sessionId: "sess-1",
      before: [],
      after: [{ path: "SKILL.md", sha256: sha256("v1") }],
    })
    const second = await appendEntry(root, {
      actor: "curator",
      action: "patch",
      skill: "pdf-export",
      sessionId: "sess-2",
      before: [{ path: "SKILL.md", sha256: sha256("v1") }],
      after: [{ path: "SKILL.md", sha256: sha256("v2") }],
    })
    expect(first).toMatch(/^[0-9a-f]{12}$/)
    expect(second).not.toBe(first)

    const lines = (await readFile(ledgerPath(root), "utf-8")).split("\n").filter((l) => l.length > 0)
    expect(lines).toHaveLength(2)

    const parsed = JSON.parse(lines[0] as string)
    expect(parsed.id).toBe(first)
    expect(parsed.actor).toBe("agent")
    expect(parsed.action).toBe("create")
    expect(parsed.skill).toBe("pdf-export")
    expect(parsed.evidence.sessionId).toBe("sess-1")
    expect(parsed.before).toEqual([])
    expect(parsed.after).toEqual([{ path: "SKILL.md", sha256: sha256("v1") }])
    expect(new Date(parsed.ts).toISOString()).toBe(parsed.ts)

    expect(JSON.parse(lines[1] as string).evidence.sessionId).toBe("sess-2")
  })

  it("账本不可写时吞掉异常，仍然返回 id", async () => {
    await makeRoot()
    // 把账本路径先建成目录，写入必然失败
    await mkdir(ledgerPath(root), { recursive: true })
    const id = await appendEntry(root, {
      actor: "agent",
      action: "write_file",
      skill: "pdf-export",
      sessionId: "sess-3",
      before: [],
      after: [],
    })
    expect(id).toMatch(/^[0-9a-f]{12}$/)
    expect(await readLedger(root)).toEqual([])
  })
})

describe("readLedger", () => {
  it("坏行跳过，好行照常保留", async () => {
    await makeRoot()
    // 构造顺序即语义：先把坏行写进账本，再往后追加两条好条目。
    // 若反过来（先 append 再覆写文件），覆写会把先前那条冲掉，测的就不是「坏行跳过」了。
    await mkdir(path.dirname(ledgerPath(root)), { recursive: true })
    await writeFile(
      ledgerPath(root),
      [
        "{ 这不是 JSON",
        "42",
        "",
        '{"id":"half-baked"}',
      ].join("\n") + "\n",
      "utf-8",
    )
    await appendEntry(root, {
      actor: "agent",
      action: "create",
      skill: "pdf-export",
      sessionId: "sess-good",
      before: [],
      after: [],
    })
    await appendEntry(root, {
      actor: "agent",
      action: "archive",
      skill: "pdf-export",
      sessionId: "sess-good-2",
      before: [],
      after: [],
    })

    // 盘上此刻应是 3 条非空坏行（非 JSON、裸数字、半截条目）+ 1 条空行 + 2 条好行；
    // 先确认坏行真的落盘了，这样后面断言 2 条才是在验证「坏行被跳过」，而非「坏行压根不存在」。
    const lines = (await readFile(ledgerPath(root), "utf-8"))
      .split("\n")
      .filter((line) => line.trim().length > 0)
    expect(lines).toHaveLength(5)

    const entries = await readLedger(root)
    expect(entries).toHaveLength(2)
    expect(entries.map((e) => e.evidence.sessionId)).toEqual(["sess-good", "sess-good-2"])
  })

  it("账本缺失时返回空数组", async () => {
    await makeRoot()
    expect(await readLedger(root)).toEqual([])
  })
})

describe("rollbackEntry", () => {
  it("把内容恢复成 before，并删掉该次变更新建的文件", async () => {
    await makeRoot()
    const skillMd = await putSkillFile("pdf-export", "SKILL.md", "v1")
    const noteMd = await putSkillFile("pdf-export", "references/note.md", "参考")

    const before = await snapshotSkill(root, "pdf-export")
    await writeFile(skillMd, "v2", "utf-8")
    const newFile = await putSkillFile("pdf-export", "scripts/new.sh", "echo new")
    const after = await snapshotSkill(root, "pdf-export")

    const id = await appendEntry(root, {
      actor: "agent",
      action: "patch",
      skill: "pdf-export",
      sessionId: "sess-rollback",
      before,
      after,
    })

    // 再往后继续漂移，回滚应把它们一并抹掉
    await writeFile(skillMd, "v3", "utf-8")
    await writeFile(noteMd, "改坏了", "utf-8")
    await putSkillFile("pdf-export", "scripts/another.sh", "echo another")

    await rollbackEntry(root, id)

    expect(await readFile(skillMd, "utf-8")).toBe("v1")
    expect(await readFile(noteMd, "utf-8")).toBe("参考")
    // after 有、before 没有的文件属于该次变更新建，必须被删掉
    await expect(stat(newFile)).rejects.toThrow()
    // after 之后才出现的文件不在账本视野内，回滚不负责清掉
    expect(await stat(path.join(skillDir(root, "pdf-export"), "scripts/another.sh"))).toBeTruthy()
  })

  it("找不到 id 时必须抛错（唯一 fail-closed 操作）", async () => {
    await makeRoot()
    await appendEntry(root, {
      actor: "agent",
      action: "create",
      skill: "pdf-export",
      sessionId: "sess-x",
      before: [],
      after: [],
    })
    await expect(rollbackEntry(root, "0123456789ab")).rejects.toThrow()
  })
})
