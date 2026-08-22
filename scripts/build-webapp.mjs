// 构建 src/webapp → dist，并生成内嵌 Web UI 清单 opencode-web-ui.gen.ts
// 清单键为相对路径（不带前导 /，如 "index.html"、"assets/foo.js"），
// 值为相对仓库根的 POSIX 路径（如 "src/webapp/dist/index.html"）；
// 运行时由 shared/ui.ts 向上查找 package.json 定位包根后解析为绝对路径，
// 避免把构建机器的绝对路径（含用户名）硬编码入库导致跨机器失效。
import { build as viteBuild } from "vite"
import { readdirSync, statSync, writeFileSync, mkdirSync } from "node:fs"
import { join, resolve, relative } from "node:path"

const rootDir = resolve(import.meta.dirname, "..")
const webappDir = join(rootDir, "src/webapp")
const distDir = join(webappDir, "dist")
const outFile = join(rootDir, "src/gyccode/server/generated/opencode-web-ui.gen.ts")

// 用 Vite JS API 程序化构建（避免 .bin shim 与 exports 字段限制）。
await viteBuild({ root: webappDir, configFile: join(webappDir, "vite.config.ts") })

function walk(dir) {
  const out = {}
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) Object.assign(out, walk(full))
    else out[relative(distDir, full).split("\\").join("/")] = relative(rootDir, full).split("\\").join("/")
  }
  return out
}

const manifest = walk(distDir)
mkdirSync(join(rootDir, "src/gyccode/server/generated"), { recursive: true })
writeFileSync(
  outFile,
  "// 由 scripts/build-webapp.mjs 生成，勿手改。\nexport default " +
    JSON.stringify(manifest, null, 2) +
    " as Record<string, string>\n",
)
console.log(`webapp manifest written: ${Object.keys(manifest).length} files -> ${outFile}`)
