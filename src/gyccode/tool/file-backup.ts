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
    if (last.absent) {
      yield* io(() => NFS.rm(file, { force: true })).pipe(
        Effect.catch(() => warn("回滚删除失败", file)),
      )
      return true
    }
    yield* io(() =>
      NFS.mkdir(path.dirname(file), { recursive: true }).then(() => NFS.copyFile(last.path, file)),
    ).pipe(Effect.catch(() => warn("回滚写回失败", file)))
    return true
  }).pipe(Effect.catch(() => Effect.succeed(false)))
