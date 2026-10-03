import { describe, expect, test } from "bun:test"
import { mkdtemp, mkdir, writeFile, readFile, rm, copyFile } from "node:fs/promises"
import { existsSync, readFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * 本测试在 mkdtemp 临时目录里真跑 git，完整复刻 src/gyccode/snapshot/index.ts 中
 * track() 的 git init/config 段（index.ts:361-382）、seed() 的 alternates 段
 * （index.ts:232-267），以及 commit() / history() / revertToCommit()
 * （index.ts:611-701）的 git 命令序列，用于验证"任务结束自动快照"接线所依赖的
 * 底层语义：commit 返回 hash、history 可列出、revert 可还原、空 commit 返回 undefined。
 *
 * 绝不触碰仓库根目录的 git，全部操作发生在临时影子仓库里。
 */

// 照抄 index.ts:75 的 TASK_REF
const TASK_REF = "refs/gyc/task"
// 照抄 index.ts:78 的 FIELD_SEP
const FIELD_SEP = "\u001f"

type GitResult = { code: number; text: string; stderr: string }

async function gitRun(args: string[], opts: { cwd?: string; env?: Record<string, string>; stdin?: string } = {}) {
  const proc = Bun.spawn(["git", ...args], {
    cwd: opts.cwd,
    env: { ...process.env, ...opts.env } as Record<string, string>,
    stdin: opts.stdin === undefined ? "ignore" : new TextEncoder().encode(opts.stdin),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, text: stdout, stderr } satisfies GitResult
}

/**
 * 建立影子仓库：
 * - source：模拟用户真实仓库，提供 objects 供 alternates 共享（对应 seed() 里的 source）
 * - gitdir + worktree：gyc 自己的影子仓库（不碰 HEAD、不动用户分支）
 */
async function createShadowRepo() {
  const root = await mkdtemp(path.join(tmpdir(), "gyc-snap-auto-"))
  const worktree = path.join(root, "work")
  const source = path.join(root, "source")
  const gitdir = path.join(root, "shadow-git")
  await mkdir(worktree)
  await mkdir(source)

  // 隔离系统/全局 gitconfig，保证 commit-tree 有确定的身份且不读用户配置
  const globalConfig = path.join(root, "gitconfig")
  await writeFile(globalConfig, "")
  const ident = {
    GIT_CONFIG_GLOBAL: globalConfig,
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "gyc-test",
    GIT_AUTHOR_EMAIL: "gyc-test@localhost",
    GIT_COMMITTER_NAME: "gyc-test",
    GIT_COMMITTER_EMAIL: "gyc-test@localhost",
  }

  // 造源仓库（用于 seed() 的 alternates 与 index 复制）
  await gitRun(["init", "-q"], { cwd: source, env: ident })
  await gitRun(["config", "user.email", "gyc-test@localhost"], { cwd: source })
  await gitRun(["config", "user.name", "gyc-test"], { cwd: source })
  await writeFile(path.join(source, "base.txt"), "base\n")
  await gitRun(["add", "-A"], { cwd: source, env: ident })
  await gitRun(["commit", "-q", "-m", "base"], { cwd: source, env: ident })

  // —— 以下照抄 track()（index.ts:361-382）：ensureDir → git init → 一串 config → seed()
  await mkdir(gitdir, { recursive: true })
  await gitRun(["init"], { env: { ...ident, GIT_DIR: gitdir, GIT_WORK_TREE: worktree } })
  const cfg = (key: string, value: string) =>
    gitRun(["--git-dir", gitdir, "config", key, value], { env: ident })
  await cfg("core.autocrlf", "false")
  await cfg("core.longpaths", "true")
  await cfg("core.symlinks", "true")
  await cfg("core.fsmonitor", "false")
  await cfg("feature.manyFiles", "true")
  await cfg("index.version", "4")
  await cfg("index.threads", "true")
  await cfg("core.untrackedCache", "true")

  // —— 以下照抄 seed()（index.ts:232-267）：共享源仓库 objects（及其自身 alternates）
  const sourceObjects = path.join(source, ".git", "objects")
  await mkdir(path.join(gitdir, "objects", "info"), { recursive: true })
  await writeFile(path.join(gitdir, "objects", "info", "alternates"), sourceObjects + "\n")
  // 复用源仓库索引是 best-effort，缺失就跳过（与 seed() 中 Effect.catch 一致）
  const sourceIndex = path.join(source, ".git", "index")
  if (existsSync(sourceIndex)) await copyFile(sourceIndex, path.join(gitdir, "index"))

  const g = (cmd: string[]) => ["--git-dir", gitdir, "--work-tree", worktree, ...cmd]

  const alternatesFile = path.join(gitdir, "objects", "info", "alternates")

  // 对应 track() → add() + write-tree
  const track = async () => {
    const added = await gitRun(g(["add", "-A", "--", "."]), { cwd: worktree, env: ident })
    const tree = await gitRun(g(["write-tree"]), { cwd: worktree, env: ident })
    if (added.code !== 0 || tree.code !== 0) return undefined
    return tree.text.trim()
  }

  // 对应 commit()/revertToCommit() 里 add() 的"是否有变更"判定：
  // 暂存后的 tree 与 TASK_REF 指向的 tree 不同即视为有变更。
  const changed = async () => {
    const added = await gitRun(g(["add", "-A", "--", "."]), { cwd: worktree, env: ident })
    if (added.code !== 0) return false
    const tree = await gitRun(g(["write-tree"]), { cwd: worktree, env: ident })
    if (tree.code !== 0) return false
    const ref = await gitRun(g(["rev-parse", "--verify", "--quiet", `${TASK_REF}^{tree}`]), {
      cwd: worktree,
      env: ident,
    })
    return ref.code !== 0 || ref.text.trim() !== tree.text.trim()
  }

  // 对应 commit()（index.ts:611-655）：commit-tree + update-ref TASK_REF，不动 HEAD
  const commit = async (message: string) => {
    const text = message.trim()
    if (!text) return undefined
    if (!(await changed())) return undefined
    const tree = await gitRun(g(["write-tree"]), { cwd: worktree, env: ident })
    if (tree.code !== 0) return undefined
    const head = await gitRun(g(["rev-parse", "--verify", "--quiet", TASK_REF]), { cwd: worktree, env: ident })
    const parent = head.code === 0 ? head.text.trim() : undefined
    const created = await gitRun(g(["commit-tree", tree.text.trim()]), {
      cwd: worktree,
      env: ident,
      stdin: text,
    })
    if (created.code !== 0) return undefined
    const hash = created.text.trim()
    await gitRun(g(["update-ref", TASK_REF, hash, ...(parent ? [parent] : [])]), { cwd: worktree, env: ident })
    return hash
  }

  // 对应 history()（index.ts:657-679）
  const history = async (limit: number) => {
    const n = Math.min(Math.max(1, Math.floor(limit)), 200)
    const result = await gitRun(g(["log", `-${n}`, "--reverse", `--pretty=format:%H%x1f%s%x1f%ct`, TASK_REF]), {
      cwd: worktree,
      env: ident,
    })
    if (result.code !== 0) return [] as { hash: string; message: string; time: number }[]
    return result.text
      .split("\n")
      .filter(Boolean)
      .map((line) => {
        const [hash, msg, time] = line.split(FIELD_SEP)
        return { hash: hash ?? "", message: msg ?? "", time: Number(time ?? 0) * 1000 }
      })
      .filter((row) => row.hash !== "")
  }

  // 对应 revertToCommit()（index.ts:681-701）：只 checkout 工作区与索引
  const revertToCommit = async (hash: string) => {
    const verify = await gitRun(g(["cat-file", "-e", `${hash}^{commit}`]), { cwd: worktree, env: ident })
    if (verify.code !== 0) return
    if (!(await changed())) return
    await gitRun(g(["checkout", hash, "--", "."]), { cwd: worktree, env: ident })
  }

  const cleanup = () => rm(root, { recursive: true, force: true })

  return { root, worktree, gitdir, alternatesFile, track, commit, history, revertToCommit, cleanup }
}

describe("snapshot 任务结束自动快照（真跑 git）", () => {
  test("写入并 track 后 commit 返回真实 hash，history 能列出该 hash 与 message", async () => {
    const repo = await createShadowRepo()
    try {
      expect(existsSync(repo.alternatesFile)).toBe(true)

      await writeFile(path.join(repo.worktree, "a.txt"), "hello\n")
      const tree = await repo.track()
      expect(typeof tree).toBe("string")
      expect((tree as string).length).toBe(40)

      const hash = await repo.commit("任务结束自动快照")
      expect(hash).toBeDefined()
      expect(typeof hash).toBe("string")
      expect(hash as string).toMatch(/^[0-9a-f]{40}$/)

      const rows = await repo.history(10)
      expect(rows.length).toBe(1)
      expect(rows[0]!.hash).toBe(hash as string)
      expect(rows[0]!.message).toBe("任务结束自动快照")
      expect(rows[0]!.time).toBeGreaterThan(0)
    } finally {
      await repo.cleanup()
    }
  })

  test("revertToCommit 后文件内容还原到该 commit 的状态", async () => {
    const repo = await createShadowRepo()
    try {
      await writeFile(path.join(repo.worktree, "a.txt"), "v1\n")
      await repo.track()
      const hash = (await repo.commit("v1")) as string
      expect(hash).toBeDefined()

      await writeFile(path.join(repo.worktree, "a.txt"), "v2-broken\n")
      await repo.track()
      expect(await readFile(path.join(repo.worktree, "a.txt"), "utf8")).toBe("v2-broken\n")

      await repo.revertToCommit(hash)
      expect(await readFile(path.join(repo.worktree, "a.txt"), "utf8")).toBe("v1\n")
    } finally {
      await repo.cleanup()
    }
  })

  test("空 message 的 commit 返回 undefined", async () => {
    const repo = await createShadowRepo()
    try {
      await writeFile(path.join(repo.worktree, "a.txt"), "x\n")
      await repo.track()
      expect(await repo.commit("   ")).toBeUndefined()
      expect(await repo.history(10)).toEqual([])
    } finally {
      await repo.cleanup()
    }
  })

  test("工作区无变更时 commit 返回 undefined（不会产生空快照）", async () => {
    const repo = await createShadowRepo()
    try {
      await writeFile(path.join(repo.worktree, "a.txt"), "x\n")
      await repo.track()
      expect(await repo.commit("首拍")).toBeDefined()
      // 第二次调用时 diff-files 为空，走 commit() 的 no changes 分支
      expect(await repo.commit("无变更重复拍")).toBeUndefined()
      const rows = await repo.history(10)
      expect(rows.length).toBe(1)
    } finally {
      await repo.cleanup()
    }
  })

  test("主循环任务收尾处调用了 commitTaskEnd（接线回归保护）", async () => {
    // 能力曾经「有 API 无调用方」：这里直接锁住 prompt.ts 里的接线行，防止又被摘掉。
    const source = readFileSync(path.join(import.meta.dir, "..", "session", "prompt.ts"), "utf8")
    expect(source).toMatch(/yield\* snapshot\.commitTaskEnd\(/)
    // commitTaskEnd 必须复用 commit 的完整语义（空 message / 无变更不产生空提交）
    const indexSource = readFileSync(path.join(import.meta.dir, "index.ts"), "utf8")
    expect(indexSource).toMatch(/commitTaskEnd:\s*commit,/)
  })
})