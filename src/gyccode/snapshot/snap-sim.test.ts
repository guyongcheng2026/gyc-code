import { describe, expect, it, beforeAll, afterAll } from "bun:test"
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

/**
 * snap-sim：快照子系统压测资产（BUG-REVIEW-2026-08-14-round3 两轮待办闭环）。
 *
 * 4 场景全部在真实 git 仓库上实测，复刻 src/gyccode/snapshot/index.ts 的
 * git 调用结构（--git-dir 分离 + --work-tree + 判变更双命令 + write-tree 短路 +
 * gc --auto 阈值），验证修复收益：
 *   1. 1000 文件仓库首次 add+write-tree 基线耗时
 *   2. 有变更 vs 无变更 step 耗时（write-tree 短路省进程收益）
 *   3. loose 对象随 step 增长率与 gc --auto 阈值触发机制
 *   4. 全量 gc vs auto gc（no-op/触发）实际耗时与 loose 数对比
 *
 * 实测发现（git 2.47.1.windows.1）：
 *   1. gc --auto 触发阈值会把 gc.auto 向上取整到 256 的倍数（DIV_ROUND_UP(limit,256)*256）
 *      ——默认 gc.auto=6700 实际触发阈值 6912。
 *   2. 新版 too_many_loose_objects() 只采样单个 objects/xx 子目录再 ×256 外推：
 *      301 loose 分布在 180 个子目录（最密 6 个）时外推 6×256=1536，gc.auto=512 仍会触发；
 *      no-op 场景需用大阈值（如 69632，要求单目录 ≥272 个对象才触发）。
 * 场景 3/4 均以该实测语义设计断言。
 * 注意：Windows 上 git 进程冷启动约 1-2s，本资产全量运行约 3 分钟，
 * 属预期（压测资产）；需通过 `bun test src/gyccode/snapshot/snap-sim.test.ts` 显式运行。
 */

const TEST_TIMEOUT = 150_000

interface GitResult {
  readonly code: number
  readonly stdout: string
  readonly stderr: string
}

interface Repo {
  readonly worktree: string
  readonly gitdir: string
}

const gitPrefix = (repo: Repo): readonly string[] => ["--git-dir", repo.gitdir, "--work-tree", repo.worktree]

function runGit(args: readonly string[], repo: Repo, opts?: { readonly env?: Record<string, string> }): GitResult {
  const result = Bun.spawnSync(["git", ...args], {
    cwd: repo.worktree,
    env: { ...process.env, ...opts?.env },
    stdout: "pipe",
    stderr: "pipe",
  })
  return {
    code: result.exitCode,
    stdout: result.stdout.toString("utf8"),
    stderr: result.stderr.toString("utf8"),
  }
}

function countLoose(repo: Repo): number {
  const result = runGit([...gitPrefix(repo), "count-objects", "-v"], repo)
  const matched = result.stdout.match(/count:\s*(\d+)/)
  return matched ? Number(matched[1]) : 0
}

async function writeFiles(repo: Repo, count: number, prefix = "file", concurrency = 100): Promise<void> {
  for (let offset = 0; offset < count; offset += concurrency) {
    const batch: Promise<void>[] = []
    const upper = Math.min(offset + concurrency, count)
    for (let index = offset; index < upper; index++) {
      batch.push(writeFile(path.join(repo.worktree, `${prefix}-${index}.txt`), `content-${prefix}-${index}\n`))
    }
    await Promise.all(batch)
  }
}

async function initRepo(root: string, name: string): Promise<Repo> {
  const worktree = path.join(root, `${name}-work`)
  const gitdir = path.join(root, `${name}-git`)
  await mkdir(worktree, { recursive: true })
  await mkdir(gitdir, { recursive: true })
  const repo: Repo = { worktree, gitdir }
  // 复刻 snapshot track() 首次初始化（GIT_DIR/GIT_WORK_TREE + 调优 config）
  runGit(["init"], repo, { env: { GIT_DIR: gitdir, GIT_WORK_TREE: worktree } })
  // 直接写 config 文件，避免 7 次 git config 进程（Windows 冷启动 ~2s/次）
  const config = [
    "[core]",
    "\trepositoryformatversion = 0",
    "\tfilemode = false",
    "\tbare = false",
    "\tlogallrefupdates = true",
    "\tautocrlf = false",
    "\tlongpaths = true",
    "\tsymlinks = true",
    "\tfsmonitor = false",
    "\tuntrackedCache = true",
    "[feature]",
    "\tmanyFiles = true",
    "[index]",
    "\tversion = 4",
    "\tthreads = true",
    "",
  ].join("\n")
  await writeFile(path.join(gitdir, "config"), config)
  return repo
}

describe("snap-sim 快照压测（4 场景）", () => {
  let root: string

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), "snap-sim-"))
  }, TEST_TIMEOUT)

  afterAll(async () => {
    await rm(root, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
  }, TEST_TIMEOUT)

  it("场景1：1000 文件仓库首次 add+write-tree 基线耗时", async () => {
    const repo = await initRepo(root, "s1")
    await writeFiles(repo, 1000)

    let start = performance.now()
    const addResult = runGit([...gitPrefix(repo), "add", "--all"], repo)
    const addMs = performance.now() - start
    expect(addResult.code).toBe(0)

    start = performance.now()
    const treeResult = runGit([...gitPrefix(repo), "write-tree"], repo)
    const writeTreeMs = performance.now() - start
    expect(treeResult.code).toBe(0)
    expect(treeResult.stdout.trim()).toMatch(/^[0-9a-f]{40}$/)

    console.log(
      `[snap-sim] 场景1: 1000 文件 add=${addMs.toFixed(1)}ms write-tree=${writeTreeMs.toFixed(1)}ms 合计=${(addMs + writeTreeMs).toFixed(1)}ms`,
    )
    // 合理性护栏：write-tree 单独不应超过 5s（真实机器通常 <1s）
    expect(writeTreeMs).toBeLessThan(5000)
  }, TEST_TIMEOUT)

  it("场景2：有变更 vs 无变更 step 耗时（write-tree 短路收益）", async () => {
    const repo = await initRepo(root, "s2")
    await writeFiles(repo, 100)

    // 预热：建立索引与首个 tree
    expect(runGit([...gitPrefix(repo), "add", "--all"], repo).code).toBe(0)
    expect(runGit([...gitPrefix(repo), "write-tree"], repo).code).toBe(0)

    // 复刻 snapshot add() 判变更的两个 git 进程
    const changed = [...gitPrefix(repo), "diff-files", "--name-only", "-z", "--", "."]
    const untracked = [...gitPrefix(repo), "ls-files", "--full-name", "--others", "--exclude-standard", "-z", "--", "."]

    const runs = 5
    let unchangedTotal = 0
    let changedTotal = 0
    for (let index = 0; index < runs; index++) {
      // 无变更轮：判变更后短路，不启动 write-tree（track 的 lastTreeHash 路径）
      let start = performance.now()
      runGit(changed, repo)
      runGit(untracked, repo)
      unchangedTotal += performance.now() - start

      // 有变更轮：判变更 + add + write-tree（完整路径）
      await writeFile(path.join(repo.worktree, "file-0.txt"), `changed-${index}\n`)
      start = performance.now()
      runGit(changed, repo)
      runGit(untracked, repo)
      runGit([...gitPrefix(repo), "add", "--all"], repo)
      runGit([...gitPrefix(repo), "write-tree"], repo)
      changedTotal += performance.now() - start
    }

    const unchangedAvg = unchangedTotal / runs
    const changedAvg = changedTotal / runs
    console.log(
      `[snap-sim] 场景2: 无变更(短路)平均=${unchangedAvg.toFixed(1)}ms 有变更(完整)平均=${changedAvg.toFixed(1)}ms 每 step 省=${(changedAvg - unchangedAvg).toFixed(1)}ms`,
    )
    expect(unchangedAvg).toBeLessThan(changedAvg)
  }, TEST_TIMEOUT)

  it("场景3：loose 对象随 step 增长率与 gc --auto 阈值触发", async () => {
    const repo = await initRepo(root, "s3")
    // gc.auto=1 → 实际触发阈值向上取整为 256（DIV_ROUND_UP(1,256)*256）
    const autoThreshold = 256
    runGit(["--git-dir", repo.gitdir, "config", "gc.auto", "1"], repo)
    runGit(["--git-dir", repo.gitdir, "config", "gc.autoDetach", "false"], repo)

    // 初始 200 文件：~201 loose（200 blob + 1 tree），低于 256 不触发
    await writeFiles(repo, 200)
    runGit([...gitPrefix(repo), "add", "--all"], repo)
    runGit([...gitPrefix(repo), "write-tree"], repo)
    const collected: number[] = [countLoose(repo)]

    // 3 批 × 20 新文件：每批 +20 blob + 1 tree = +21 loose
    for (let index = 1; index <= 3; index++) {
      await writeFiles(repo, 20, `batch-${index}`)
      runGit([...gitPrefix(repo), "add", "--all"], repo)
      runGit([...gitPrefix(repo), "write-tree"], repo)
      collected.push(countLoose(repo))
    }
    const points = collected

    const before = countLoose(repo)
    // 模拟 snapshot cleanup：gc --auto（此时 loose 已超 256，应触发 repack）
    const gcResult = runGit([...gitPrefix(repo), "gc", "--auto", "--prune=7.days"], repo)
    const after = countLoose(repo)
    expect(gcResult.code).toBe(0)
    console.log(`[snap-sim] 场景3: loose 增长=${points.join("→")}（每批 20 文件 +21） gc前=${before} gc后=${after}`)
    // 增长验证：loose 单调增长
    expect(points[points.length - 1]).toBeGreaterThan(points[0])
    // 触发验证：超过取整阈值 256 后 gc --auto 真正 repack 使 loose 回落
    expect(before).toBeGreaterThan(autoThreshold)
    expect(after).toBeLessThan(before)
  }, TEST_TIMEOUT)

  it("场景4：全量 gc vs auto gc（no-op/触发）实际耗时与 loose 数对比", async () => {
    const repo = await initRepo(root, "s4")
    let looseRound = 0
    const syncLoose = async () => {
      looseRound++
      await writeFiles(repo, 300, `round-${looseRound}`, 150)
      runGit([...gitPrefix(repo), "add", "--all"], repo)
      runGit([...gitPrefix(repo), "write-tree"], repo)
    }

    // 全量 gc：无条件重写对象库（~301 loose → 0）
    await syncLoose()
    const looseBeforeFull = countLoose(repo)
    let start = performance.now()
    expect(runGit([...gitPrefix(repo), "gc"], repo).code).toBe(0)
    const fullGcMs = performance.now() - start
    const looseAfterFull = countLoose(repo)

    // no-op：gc.auto=69632（256×272），采样外推需单目录 ≥272 个对象才触发；
    // 301 loose 分布在 180 个子目录（最密 ≤6），外推 6×256=1536 < 69632 → 不 repack
    runGit(["--git-dir", repo.gitdir, "config", "gc.auto", "69632"], repo)
    runGit(["--git-dir", repo.gitdir, "config", "gc.autoDetach", "false"], repo)
    await syncLoose()
    const looseBeforeNoop = countLoose(repo)
    start = performance.now()
    expect(runGit([...gitPrefix(repo), "gc", "--auto", "--prune=7.days"], repo).code).toBe(0)
    const autoNoopMs = performance.now() - start
    const looseAfterNoop = countLoose(repo)

    // 触发：gc.auto=1（外推 ≥256 即触发，即单目录 ≥1 个对象），602 loose 必触发 repack
    runGit(["--git-dir", repo.gitdir, "config", "gc.auto", "1"], repo)
    await syncLoose()
    const looseBeforeTrigger = countLoose(repo)
    start = performance.now()
    expect(runGit([...gitPrefix(repo), "gc", "--auto", "--prune=7.days"], repo).code).toBe(0)
    const autoTriggerMs = performance.now() - start
    const looseAfterTrigger = countLoose(repo)

    console.log(
      `[snap-sim] 场景4: 全量 gc=${fullGcMs.toFixed(1)}ms(loose ${looseBeforeFull}→${looseAfterFull}) | auto no-op=${autoNoopMs.toFixed(1)}ms(loose ${looseBeforeNoop}→${looseAfterNoop}) | auto 触发=${autoTriggerMs.toFixed(1)}ms(loose ${looseBeforeTrigger}→${looseAfterTrigger})`,
    )
    // 耗时：大阈值内 no-op 显著快于全量 gc（repack 是主要成本）
    expect(autoNoopMs).toBeLessThan(fullGcMs)
    // 机制：阈值内不 repack（loose 不变）；超阈值真正 repack（loose 回落）
    expect(looseAfterNoop).toBe(looseBeforeNoop)
    expect(looseAfterTrigger).toBeLessThan(looseBeforeTrigger)
  }, TEST_TIMEOUT)
})
