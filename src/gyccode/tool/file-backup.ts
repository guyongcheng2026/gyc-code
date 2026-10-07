/**
 * P1-4（对标指标 §1.3）：文件级写前备份。
 *
 * 任务级快照（`snapshot/index.ts`）粒度是「一轮任务」，任务中途连续改同一个
 * 文件时只能回到任务开始，回不到「上一次编辑之前」。本模块补的就是这一层：
 * 任何一次落盘前把目标文件的当前字节复制一份，误改后可单文件精确回滚。
 *
 * 为什么不用影子 git 仓库存备份：
 * 1. 影子仓库只在 `vcs === "git"` 且 `snapshot !== false` 时工作，非 git 工程
 *    （以及主动关掉快照的用户）会完全没有备份——恰恰是最需要兜底的情形。
 * 2. 写入备份需要对每个被编辑的文件跑一次 git 子进程（hash-object/commit），
 *    这落在 edit/write 的热路径上；而按路径回滚时仍需另存一份「blob → 原路径」
 *    的索引，git 对象库本身并不提供按路径检索。因此复用 git 并不能省掉元数据存储，
 *    反而多一层进程开销。
 * 3. 影子仓库的索引被 `add()` 持续改写（任务级 patch 语义依赖它），备份写入若
 *    触碰索引会污染任务级回退语义。
 * 故采用独立目录 `Global.Path.data/backup/<projectID>/<hash(worktree)>`，
 * 与 snapshot 目录并列、布局同构，按工作区隔离。
 *
 * 语义约束：全部操作均为 best-effort，任何失败都只记日志、返回空结果，
 * 绝不改变 edit/write/apply_patch/notebook_edit 既有的成功与失败返回契约。
 */

import { Effect } from "effect"
import * as NFS from "node:fs/promises"
import * as path from "node:path"
import { Global } from "@gyccode/core/global"
import { Hash } from "@gyccode/core/util/hash"

/** 单文件保留的备份份数上限，超出后删除最旧的 */
export const DEFAULT_KEEP = 20

/** 默认备份根目录（未显式指定 root 时使用） */
export const DEFAULT_ROOT = path.join(Global.Path.data, "backup")

export interface BackupEntry {
  /** 备份文件的绝对路径 */
  readonly path: string
  /** 备份创建时间（毫秒时间戳） */
  readonly time: number
  /** true 表示「写入前该文件并不存在」，回滚时应删除目标文件 */
  readonly absent: boolean
}

export interface Options {
  /** 备份根目录，默认为 Global.Path.data/backup */
  readonly root?: string
  /** 单文件保留份数，默认为 DEFAULT_KEEP */
  readonly keep?: number
}

/** 按工作区隔离的备份根目录，与 snapshot 目录同构 */
export const backupRoot = (ctx: { project: { id: string }; worktree: string }) =>
  path.join(DEFAULT_ROOT, ctx.project.id, Hash.fast(ctx.worktree))

/** 目标文件在备份库中的目录：用绝对路径哈希定址，避免深层路径与超长路径问题 */
const entryDir = (root: string, file: string) => path.join(root, "files", Hash.fast(path.resolve(file)).slice(0, 32))

/** 文件名以零填充时间戳开头，字典序即时间序 */
const entryName = (time: number, seq: number, absent: boolean) =>
  `${String(time).padStart(16, "0")}-${String(seq).padStart(4, "0")}.${absent ? "absent" : "bak"}`

const io = <A>(op: () => Promise<A>): Effect.Effect<A, unknown> =>
  Effect.tryPromise<A, unknown>({ try: op, catch: (cause) => cause })

/** 判定原始错误是否为「文件不存在」 */
const isNotFound = (err: unknown) =>
  typeof err === "object" && err !== null && (err as { code?: unknown }).code === "ENOENT"

const warn = (message: string, file: string) => Effect.logWarning(message, { file })

const readNames = (dir: string) =>
  io(() => NFS.readdir(dir)).pipe(
    Effect.map((names) => names as string[]),
    Effect.catch(() => Effect.succeed<string[]>([])),
  )

/** 只保留最近的 keep 份，多余的按时间序从最旧开始删除 */
const prune = (dir: string, keep: number) =>
  Effect.gen(function* () {
    const entries = yield* listDir(dir)
    if (entries.length <= keep) return
    for (const entry of entries.slice(0, entries.length - keep)) {
      yield* io(() => NFS.rm(entry.path, { force: true })).pipe(Effect.catch(() => Effect.void))
    }
  })

const listDir = (dir: string) =>
  readNames(dir).pipe(
    Effect.map((names) =>
      names
        .filter((name) => name.endsWith(".bak") || name.endsWith(".absent"))
        .map((name) => {
          const absent = name.endsWith(".absent")
          const stamp = name.split("-")[0] ?? ""
          return {
            path: path.join(dir, name),
            time: Number(stamp) || 0,
            absent,
          } satisfies BackupEntry
        })
        .sort((a, b) => (a.time === b.time ? a.path.localeCompare(b.path) : a.time - b.time)),
    ),
  )

/**
 * 备份库全局容量上限（字节）。
 *
 * `keep` 只约束单文件份数，约束不住总量：文件一旦不再被编辑，它留下的
 * DEFAULT_KEEP 份备份就永久驻留（实测本机 backup/ 已积累 1306 个文件 /
 * 14.1MB，且随编辑量线性增长、无任何清理入口）。
 */
export const DEFAULT_MAX_BYTES = 200 * 1024 * 1024

export interface GlobalOptions {
  /** 备份根目录，默认为 Global.Path.data/backup */
  readonly root?: string
  /** 全局容量上限，默认为 DEFAULT_MAX_BYTES */
  readonly maxBytes?: number
}

export interface GlobalPruneResult {
  /** 删除的备份条数 */
  readonly removed: number
  /** 释放的字节数 */
  readonly freedBytes: number
}

const statOf = (file: string) =>
  io(() => NFS.stat(file)).pipe(Effect.catch(() => Effect.succeed(undefined)))

interface BackupFile {
  readonly path: string
  readonly time: number
  readonly size: number
}

/** 递归遍历备份库，把每个 .bak / .absent 条目记进 entries（就地累积） */
const walkBackups = (dir: string, entries: BackupFile[]): Effect.Effect<void> =>
  Effect.gen(function* () {
    for (const name of yield* readNames(dir)) {
      const full = path.join(dir, name)
      const stat = yield* statOf(full)
      if (stat?.isDirectory()) {
        yield* walkBackups(full, entries)
        continue
      }
      if (!name.endsWith(".bak") && !name.endsWith(".absent")) continue
      entries.push({ path: full, time: Number(name.split("-")[0] ?? "") || 0, size: stat?.size ?? 0 })
    }
  })

/**
 * 收集备份库内全部备份条目，按时间升序。
 *
 * 递归遍历而非按 `root/<project>/<worktree>/files/<hash>` 逐层下钻：`backup()`
 * 允许直接传自定义 root（此时少了 project/worktree 两层），递归对两种布局
 * 都成立。时间戳取自文件名前缀（见 entryName）。
 */
const collectAll = (root: string) =>
  Effect.gen(function* () {
    const entries: BackupFile[] = []
    yield* walkBackups(root, entries)
    return entries.sort((a, b) => a.time - b.time)
  })

/**
 * 全局容量清理：从最旧的备份开始删除，直到备份库总字节落回上限内。
 *
 * 与 `prune` 的单文件语义并存：先按份数裁剪（保证单个文件的历史完整），
 * 再由本函数兜住总量上限。删除失败的条目计入 removed 不影响继续处理。
 */
export const pruneGlobal = (options?: GlobalOptions): Effect.Effect<GlobalPruneResult> =>
  Effect.gen(function* () {
    const maxBytes = options?.maxBytes ?? DEFAULT_MAX_BYTES
    const entries = yield* collectAll(options?.root ?? DEFAULT_ROOT)
    let total = entries.reduce((sum, entry) => sum + entry.size, 0)
    let removed = 0
    let freedBytes = 0
    if (total <= maxBytes) return { removed, freedBytes }
    for (const entry of entries) {
      if (total <= maxBytes) break
      yield* io(() => NFS.rm(entry.path, { force: true })).pipe(Effect.catch(() => Effect.void))
      removed += 1
      freedBytes += entry.size
      total -= entry.size
    }
    yield* Effect.logWarning("备份库超过全局容量上限，已淘汰最旧的备份", {
      removed,
      freedBytes,
      capBytes: maxBytes,
    })
    return { removed, freedBytes }
  }).pipe(Effect.catch(() => Effect.succeed({ removed: 0, freedBytes: 0 })))

// 收集要遍历整个备份库（实测已累积上千文件），落在每次编辑的热路径上会明显
// 拖慢写操作，故按间隔节流，且不阻塞 backup 返回。
let lastGlobalSweep = 0
const GLOBAL_SWEEP_INTERVAL_MS = 10 * 60 * 1000

const sweepGlobalInBackground = (root: string) =>
  Effect.gen(function* () {
    if (Date.now() - lastGlobalSweep < GLOBAL_SWEEP_INTERVAL_MS) return
    lastGlobalSweep = Date.now()
    yield* pruneGlobal({ root }).pipe(Effect.asVoid, Effect.forkDetach)
  })

/**
 * 写前备份：把目标文件当前字节复制到备份库。
 *
 * 文件不存在时记录一条 absent 标记——这样「本次写入创建了新文件」也能回滚
 * （回滚即删除）。返回备份文件路径；失败返回 undefined。
 */
export const backup = (file: string, options?: Options): Effect.Effect<string | undefined> =>
  Effect.gen(function* () {
    const root = options?.root ?? DEFAULT_ROOT
    const dir = entryDir(root, file)
    const existing = yield* readNames(dir)
    yield* io(() => NFS.mkdir(dir, { recursive: true })).pipe(Effect.catch(() => Effect.void))

    const time = Date.now()
    // 同一毫秒内连续写入时按已有文件名顺延序号，避免互相覆盖
    const taken = new Set(existing)
    let seq = 0
    while (taken.has(entryName(time, seq, false)) || taken.has(entryName(time, seq, true))) seq += 1

    // 直接尝试复制来判定文件是否存在，不走 stat/isFile——Bun 的 fs/promises
    // Stats 不保证提供该方法。ENOENT 说明本次写入会创建新文件；其它错误
    // （目录、权限等）视为备份失败，不记录任何标记，避免回滚误删文件。
    const probe = entryName(time, seq, false)
    const copied = yield* io(() => NFS.copyFile(file, path.join(dir, probe))).pipe(
      Effect.as(true),
      Effect.catch((err) => Effect.succeed(isNotFound(err) ? false : undefined)),
    )
    if (copied === undefined) {
      yield* warn("写前备份失败", file)
      return undefined
    }

    const absent = !copied
    const target = path.join(dir, absent ? entryName(time, seq, true) : probe)
    if (absent) {
      yield* io(() => NFS.writeFile(target, "")).pipe(Effect.catch(() => Effect.void))
    }
    yield* prune(dir, options?.keep ?? DEFAULT_KEEP)
    yield* sweepGlobalInBackground(root)
    return target
  }).pipe(Effect.catch(() => Effect.succeed(undefined)))

/** 列出该文件的全部历史备份，按时间升序 */
export const list = (file: string, options?: Options) =>
  listDir(entryDir(options?.root ?? DEFAULT_ROOT, file)).pipe(Effect.catch(() => Effect.succeed<BackupEntry[]>([])))

/**
 * 单文件回滚：恢复到最新一份备份。
 *
 * 最新备份是 absent 标记（本次写入创建了新文件）时删除目标文件，否则把备份
 * 字节写回。无备份或失败返回 false。
 */
export const rollback = (file: string, options?: Options) =>
  Effect.gen(function* () {
    const entries = yield* list(file, options)
    const last = entries.at(-1)
    if (!last) return false
    // 失败必须返回 false：此前两处都是「catch 里记一条日志，然后无条件 return true」，
    // 调用方（file_rollback 工具）据此回报「已回滚」，而文件其实还是改坏的状态。
    // 静默的成功比明确的失败有害得多——用户会以为已经退回干净版本。
    if (last.absent) {
      const removed = yield* io(() => NFS.rm(file, { force: true })).pipe(
        Effect.as(true),
        Effect.catch(() =>
          warn("回滚删除失败", file).pipe(Effect.as(false)),
        ),
      )
      return removed
    }
    const restored = yield* io(() =>
      NFS.mkdir(path.dirname(file), { recursive: true }).then(() => NFS.copyFile(last.path, file)),
    ).pipe(
      Effect.as(true),
      Effect.catch(() => warn("回滚写回失败", file).pipe(Effect.as(false))),
    )
    return restored
  }).pipe(Effect.catch(() => Effect.succeed(false)))
