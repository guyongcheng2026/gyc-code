// 把 .githooks/ 下的钩子安装进 .git/hooks/（幂等，挂入 postinstall）。
// 背景：core.hooksPath 未配置时 .githooks/ 不生效（2026-08-31 发现 post-commit
// 自动 push/Obsidian 同步一直没跑）。不改 git config（避免覆盖用户/CI 全局配置），
// 采用副本安装：clone 后 npm/bun install 即自动生效。
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync } from "fs"
import { join } from "path"

const root = process.cwd()
const srcDir = join(root, ".githooks")
const dotGit = join(root, ".git")
const hooksDir = join(dotGit, "hooks")

// 发布包（files 不含 .githooks）或非 git 检出（CI tarball）：静默跳过，不阻塞 install
if (!existsSync(srcDir) || !existsSync(dotGit)) process.exit(0)

mkdirSync(hooksDir, { recursive: true })
let installed = 0
for (const name of readdirSync(srcDir)) {
  // 仅安装无扩展名的钩子脚本；忽略 README 等说明文件
  if (name.includes(".")) continue
  const src = join(srcDir, name)
  const dest = join(hooksDir, name)
  try {
    // 幂等：内容相同则跳过
    if (readFileSync(dest, "utf-8") === readFileSync(src, "utf-8")) continue
  } catch {
    // dest 不存在 → 首次安装
  }
  copyFileSync(src, dest)
  installed++
  console.log(`[hooks] 已安装 ${name} -> .git/hooks/${name}`)
}
if (installed === 0) console.log("[hooks] 钩子已是最新")