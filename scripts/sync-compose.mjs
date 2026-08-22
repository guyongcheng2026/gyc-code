// Compose 技能包同步检查/同步脚本。
// 用法：
//   node scripts/sync-compose.mjs <source-bundle-dir> [--check|--apply]
// 默认 --check：对比源目录与本地 .bundle，输出差异清单，有差异时退出码 1。
// --apply：将源目录内容覆盖同步到本地 .bundle，并提示重新生成 bundle.gen.ts。
import fs from "node:fs"
import path from "node:path"
import crypto from "node:crypto"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const bundleDir = path.resolve(root, "src", "gyccode", "skill", "compose", ".bundle")

function walkDir(base, rel, out) {
  const fullPath = rel ? path.join(base, rel) : base
  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walkDir(base, relPath, out)
    else out[relPath] = fs.readFileSync(path.join(fullPath, entry.name), "utf8")
  }
}

function snapshot(dir) {
  const files = {}
  walkDir(dir, "", files)
  return files
}

function sha256(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex")
}

function resolveIn(dir, relPath) {
  const target = path.resolve(dir, ...relPath.split("/"))
  const prefix = dir.endsWith(path.sep) ? dir : dir + path.sep
  if (!target.startsWith(prefix)) throw new Error(`unsafe path: ${relPath}`)
  return target
}

const sourceDir = process.argv[2]
const mode = process.argv[3] === "--apply" ? "apply" : "check"

if (!sourceDir || !fs.existsSync(sourceDir)) {
  console.error("usage: node scripts/sync-compose.mjs <source-bundle-dir> [--check|--apply]")
  console.error(`  source dir: ${sourceDir ?? "(missing)"}`)
  process.exit(2)
}

const source = snapshot(sourceDir)
const local = snapshot(bundleDir)

const allNames = new Set([...Object.keys(source), ...Object.keys(local)])
const onlySource = []
const onlyLocal = []
const changed = []

for (const name of [...allNames].sort()) {
  if (!(name in local)) onlySource.push(name)
  else if (!(name in source)) onlyLocal.push(name)
  else if (sha256(source[name]) !== sha256(local[name])) changed.push(name)
}

console.log(`source : ${sourceDir}`)
console.log(`local  : ${bundleDir}`)
console.log(`files  : source=${Object.keys(source).length} local=${Object.keys(local).length}`)
if (onlySource.length) console.log(`only in source : ${onlySource.join(", ")}`)
if (onlyLocal.length) console.log(`only in local  : ${onlyLocal.join(", ")} (kept, local-only)`)
if (changed.length) console.log(`changed        : ${changed.join(", ")}`)

if (mode === "apply") {
  for (const name of [...onlySource, ...changed]) {
    fs.mkdirSync(path.dirname(resolveIn(bundleDir, name)), { recursive: true })
    fs.writeFileSync(resolveIn(bundleDir, name), source[name], "utf8")
    console.log(`updated: ${name}`)
  }
  if (onlySource.length || changed.length) {
    console.log("done. remember to run: node scripts/gen-compose-bundle.mjs")
  } else {
    console.log("in sync, nothing to apply.")
  }
  process.exit(0)
}

if (onlySource.length || changed.length) {
  console.log("DRIFT DETECTED (exit 1)")
  process.exit(1)
}
console.log("in sync")
