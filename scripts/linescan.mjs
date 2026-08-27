// 行数口径统计（常驻）：gyc-code 代码包各口径行数
// 用法：bun scripts/linescan.mjs
// 口径：
//   代码包总量   = src 下 TS/TSX 全部（当前事实口径）
//   人工维护核心 = 代码包总量 - gen 生成物 - 测试
import { readdirSync, statSync, readFileSync } from "node:fs"
import { join } from "node:path"

function scan(root) {
  const files = []
  const stack = [root]
  while (stack.length) {
    const c = stack.pop()
    for (const e of readdirSync(c, { withFileTypes: true })) {
      const p = join(c, e.name)
      if (e.isDirectory()) {
        if (e.name.includes("node_modules") || e.name === ".git" || e.name === ".codebuddy" || e.name === "dist") continue
        stack.push(p)
      } else if (/\.(ts|tsx)$/.test(e.name)) {
        files.push(p)
      }
    }
  }
  return files
}

const files = scan("src")
const sum = (arr) => arr.reduce((a, b) => a + b, 0)
const lines = (f) => readFileSync(f, "utf8").split(/\r?\n/).length - 1

const isGen = (f) => f.split(/[\\/]/).includes("gen")
const isTest = (f) => /\.(test|spec)\.(ts|tsx)$/.test(f)

const total = files.map(lines)
const gen = files.filter(isGen).map(lines)
const test = files.filter((f) => !isGen(f) && isTest(f)).map(lines)

const byTop = {}
for (const f of files) {
  const top = f.split(/[\\/]/)[1]
  byTop[top] = (byTop[top] || 0) + lines(f)
}

console.log("=== gyc-code 行数口径（scripts/linescan.mjs）===")
console.log("代码包总量（src TS/TSX）:      ", sum(total).toLocaleString(), "行 /", files.length, "文件")
console.log("  - gen 生成物:                ", sum(gen).toLocaleString(), "行 /", files.filter(isGen).length, "文件")
console.log("  - 测试:                      ", sum(test).toLocaleString(), "行 /", files.filter((f) => !isGen(f) && isTest(f)).length, "文件")
console.log("人工维护核心（总-gen-测试）:    ", (sum(total) - sum(gen) - sum(test)).toLocaleString(), "行")
console.log("")
console.log("=== 按顶层目录 ===")
for (const [k, v] of Object.entries(byTop).sort((a, b) => b[1] - a[1])) console.log(String(v).padStart(8), k)