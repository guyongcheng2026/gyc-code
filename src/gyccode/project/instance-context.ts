import { LocalContext } from "@/util/local-context"
import { realpathSync } from "node:fs"
import { FSUtil } from "@gyccode/core/fs-util"
import type * as Project from "./project"

export interface InstanceContext {
  directory: string
  worktree: string
  project: Project.Info
}

export const context = LocalContext.create<InstanceContext>("instance")

/**
 * Check if a path is within the project boundary.
 * Returns true if path is inside ctx.directory OR ctx.worktree.
 * Paths within the worktree but outside the working directory should not trigger external_directory permission.
 */
export function containsPath(filepath: string, ctx: InstanceContext): boolean {
  // 对父路径及目标路径做 realpath 解析，堵符号链接逃逸：
  // 工作区内的符号链接若指向工作区外，纯词法判定会误认为其在围栏内，
  // 从而绕过 external_directory 权限检查；realpath 后再做包含判定。
  let realDir: string
  try {
    realDir = realpathSync(ctx.directory)
  } catch {
    realDir = ctx.directory
  }
  let realFile: string
  try {
    realFile = realpathSync(filepath)
  } catch {
    realFile = filepath
  }
  if (FSUtil.contains(realDir, realFile)) return true
  // Non-git projects set worktree to "/" which would match ANY absolute path.
  // Skip worktree check in this case to preserve external_directory permissions.
  if (ctx.worktree === "/") return false
  let realWorktree: string
  try {
    realWorktree = realpathSync(ctx.worktree)
  } catch {
    realWorktree = ctx.worktree
  }
  return FSUtil.contains(realWorktree, realFile)
}
