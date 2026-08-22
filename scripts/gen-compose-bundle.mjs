// Generates src/gyccode/skill/compose/bundle.gen.ts from the compose skill bundle.
// Run: node scripts/gen-compose-bundle.mjs
import fs from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, "..")
const bundleDir = path.join(root, "src", "gyccode", "skill", "compose", ".bundle")
const outFile = path.join(root, "src", "gyccode", "skill", "compose", "bundle.gen.ts")

function walkDir(base, rel, out) {
  const fullPath = rel ? path.join(base, rel) : base
  for (const entry of fs.readdirSync(fullPath, { withFileTypes: true })) {
    const relPath = rel ? `${rel}/${entry.name}` : entry.name
    if (entry.isDirectory()) walkDir(base, relPath, out)
    else out[relPath] = fs.readFileSync(path.join(fullPath, entry.name), "utf8")
  }
}

function jsString(value) {
  return JSON.stringify(value).replace(/\u2028/g, "\\u2028").replace(/\u2029/g, "\\u2029")
}

const result = {}
for (const entry of fs.readdirSync(bundleDir, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  const files = {}
  walkDir(path.join(bundleDir, entry.name), "", files)
  if (Object.keys(files).length > 0) result[entry.name] = files
}

const lines = [
  "// Generated file — do not edit by hand.",
  "// Source: src/gyccode/skill/compose/.bundle (run `node scripts/gen-compose-bundle.mjs` to regenerate).",
  "",
  "export interface ComposeBundleEntry {",
  "  readonly [relPath: string]: string",
  "}",
  "",
  `export const COMPOSE_BUNDLE: Record<string, ComposeBundleEntry> = ${jsString(result)}`,
  "",
]

fs.writeFileSync(outFile, lines.join("\n"), "utf8")
console.log(`Generated ${outFile}`)
console.log(`  skills: ${Object.keys(result).length}`)
const total = Object.values(result).reduce((sum, files) => sum + Object.values(files).join("").length, 0)
console.log(`  bytes: ${total}`)