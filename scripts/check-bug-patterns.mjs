// 高频缺陷模式检查（第 5 轮 bug 扫描沉淀的复发防线）
// 用法:
//   bun scripts/check-bug-patterns.mjs           检查整个 src
//   bun scripts/check-bug-patterns.mjs <file...> 检查指定文件
// 检出任一命中时退出码 1，输出 文件:行号。
//
// 当前覆盖（宁缺毋滥，只收实锤踩过的坑）:
// A. 空 catch 吞错        —— catch {} / catch (e) {} 且块内无任何语句
// B. 空壳自递归函数        —— 函数体只有一句 return <自己>(...)，必然栈溢出
//                            （形如重命名/合并产生的 getMemoryDir(){return getMemoryDir()}）
import { readFileSync, readdirSync, statSync } from "fs"
import { join, extname } from "path"

// 确认过是"尽力而为的清理、失败无害"的空 catch，允许存在
const EMPTY_CATCH_ALLOW = new Set([
  "src/gyccode/mcp/transport-ws.ts", // socket.terminate()/send() 收尾阶段，失败无害
  "src/tui/app.tsx", // 关停/降级路径 best-effort（flush/destroy/gc/stats/safe-mode），失败无害
  "src/core/oauth/page.ts", // 模板串内的浏览器 JS（try{window.close()}catch(e){}），非 TS 控制流
])

const CHECK_EXTS = new Set([".ts", ".tsx"])
const SKIP_DIRS = new Set(["node_modules", "dist", "gen", ".gen", "generated", "webapp"])
// 测试文件里的清理类空 catch（临时文件 unlink 等）无害，不作要求
const isTestFile = (p) => /\.test\.tsx?$/.test(p)

function checkFile(path) {
  const hits = []
  let text
  try {
    text = readFileSync(path, "utf-8")
  } catch {
    return hits
  }
  const lines = text.split("\n")

  // A. 空 catch（单行 catch {} 或 catch (e) {}）
  if (!isTestFile(path) && !EMPTY_CATCH_ALLOW.has(path.replace(/\\/g, "/"))) {
    lines.forEach((line, i) => {
      if (/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/.test(line)) {
        hits.push(`${path}:${i + 1} empty catch 吞错（失败被静默忽略）`)
      }
    })
  }

  // B. 空壳自递归：function NAME(...) { return NAME(...) }，中间只有空白
  const decl = /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/
  for (let i = 0; i < lines.length; i++) {
    const m = decl.exec(lines[i])
    if (!m) continue
    const name = m[1]
    // 收集函数体：从声明行起，做花括号配对
    let depth = 0
    let started = false
    const body = []
    let end = i
    for (let j = i; j < lines.length && j - i < 60; j++) {
      const l = lines[j]
      for (const ch of l) {
        if (ch === "{") { depth++; started = true }
        else if (ch === "}") depth--
      }
      body.push(l)
      end = j
      if (started && depth <= 0) break
    }
    if (body.length === 0) continue
    const bodyText = body.join("\n")
    const onlySelfReturn = new RegExp(
      `^\\s*(?:export\\s+)?(?:async\\s+)?function\\s+${name}\\s*\\([^)]*\\)\\s*\\{\\s*return\\s+${name}\\s*\\([\\s\\S]*\\)\\s*;?\\s*\\}\\s*$`,
    )
    if (onlySelfReturn.test(bodyText)) {
      hits.push(`${path}:${i + 1} 空壳自递归函数 ${name}() 只会调用自己（必然栈溢出/永不返回）`)
    }
    i = end
  }
  return hits
}

function walk(dir, acc = []) {
  for (const ent of readdirSync(dir, { withFileTypes: true })) {
    if (ent.name.startsWith(".")) continue
    const p = join(dir, ent.name)
    if (ent.isDirectory()) {
      if (SKIP_DIRS.has(ent.name)) continue
      walk(p, acc)
    } else if (CHECK_EXTS.has(extname(ent.name))) {
      acc.push(p)
    }
  }
  return acc
}

const args = process.argv.slice(2)
const files = args.length
  ? args.filter((f) => { try { return statSync(f).isFile() } catch { return false } })
  : walk("src")

const hits = files.flatMap((f) => checkFile(f))
if (hits.length) {
  console.error(`\n[check-bug-patterns] 检出 ${hits.length} 处高危模式（禁止提交）：`)
  for (const h of hits) console.error(`  ${h}`)
  process.exit(1)
}
console.log(`[check-bug-patterns] ${files.length} 个文件检查通过`)
