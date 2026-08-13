/**
 * build-marketplace.mjs — 构建 gyc 插件市场内容
 *
 * 对 marketplace/plugins/* 下每个插件执行 npm pack，产物输出到 marketplace/pkg/，
 * 并生成 marketplace/index.json（PluginEntry 数组，与 src/gyccode/plugin/marketplace.ts 的 schema 对齐）。
 *
 * 用法：bun scripts/build-marketplace.mjs
 * 产物：marketplace/index.json + marketplace/pkg/<name>-<version>.tgz
 */
import { execSync } from "node:child_process"
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const PLUGINS_DIR = join(ROOT, "marketplace", "plugins")
const PKG_DIR = join(ROOT, "marketplace", "pkg")
const INDEX_FILE = join(ROOT, "marketplace", "index.json")

// 重建 pkg 目录，避免残留旧版本
rmSync(PKG_DIR, { recursive: true, force: true })
mkdirSync(PKG_DIR, { recursive: true })

const entries = []

for (const dir of readdirSync(PLUGINS_DIR, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue
  const pluginDir = join(PLUGINS_DIR, dir.name)
  const pkgPath = join(pluginDir, "package.json")
  if (!existsSync(pkgPath)) {
    console.warn(`[跳过] ${dir.name}：无 package.json`)
    continue
  }

  const pkg = JSON.parse(readFileSync(pkgPath, "utf8"))
  if (!pkg.name || !pkg.version) {
    console.warn(`[跳过] ${dir.name}：缺少 name/version`)
    continue
  }

  // npm pack 输出 tgz 到 pkg 目录
  execSync(`npm pack --pack-destination "${PKG_DIR}"`, {
    cwd: pluginDir,
    stdio: ["ignore", "ignore", "inherit"],
  })

  // 市场约定：pkg/<name>/<version>.tgz（与 marketplace.ts 的 install URL 对齐）
  const tarball = join(PKG_DIR, `${pkg.name}-${pkg.version}.tgz`)
  const targetDir = join(PKG_DIR, pkg.name)
  mkdirSync(targetDir, { recursive: true })
  renameSync(tarball, join(targetDir, `${pkg.version}.tgz`))

  entries.push({
    name: pkg.name,
    version: pkg.version,
    description: pkg.description ?? "",
    author: pkg.author ?? "gyccode",
    repository: pkg.repository,
    keywords: pkg.keywords ?? [],
  })
  console.log(`[打包] ${pkg.name}@${pkg.version}`)
}

entries.sort((a, b) => a.name.localeCompare(b.name))
writeFileSync(INDEX_FILE, JSON.stringify(entries, null, 2) + "\n", "utf8")
console.log(`\n[完成] ${entries.length} 个插件 → marketplace/index.json`)
console.log(`       tgz 位于 marketplace/pkg/（${readdirSync(PKG_DIR).length} 个）`)
console.log("部署：将 marketplace/ 目录整体托管为静态站点（如 GitHub Pages / Cloudflare Pages / 自建），")
console.log("      线上地址：guyongcheng2026.github.io/gyc-code/（deploy-pages.yml 自动部署）")
