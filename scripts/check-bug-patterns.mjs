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
// C. 空 catch 回调         —— .catch(() => {}) / .catch(function(){})，
//                            与 A 同源但形态不同，A 的正则拦不到。
//                            2026-10-05：src/tui/app.tsx 曾积累 13 处，
//                            其中崩溃日志写入失败被静默吞掉，事后完全无法排查。
import { readFileSync, readdirSync, statSync } from "fs"
import { join, extname } from "path"

// 确认过是"尽力而为的清理、失败无害"的空 catch，允许存在
const EMPTY_CATCH_ALLOW = new Set([
  "src/gyccode/mcp/transport-ws.ts", // socket.terminate()/send() 收尾阶段，失败无害
  "src/core/oauth/page.ts", // 模板串内的浏览器 JS（try{window.close()}catch(e){}），非 TS 控制流
])
// src/tui/app.tsx 曾整文件豁免，导致空 catch 可无限累积。
// 现改为：该文件内每一处空 catch 都必须自带「为何可忽略」的注释，
// 否则本检查照拦。豁免清单不再是文件级，而是靠上面的注释约定放行。

const CHECK_EXTS = new Set([".ts", ".tsx"])
const SKIP_DIRS = new Set(["node_modules", "dist", "gen", ".gen", "generated", "webapp"])
// 测试文件里的清理类空 catch（临时文件 unlink 等）无害，不作要求
const isTestFile = (p) => /\.test\.tsx?$/.test(p)

/**
 * 对源码文本跑全部规则，返回命中描述数组。
 *
 * 抽成纯函数是为了让 scripts/check-bug-patterns.test.ts 能直接驱动，
 * 不必真的往仓库里塞违规样例文件。
 */
export function checkSource(text, options = {}) {
  const hits = []
  const skipEmptyCatch = options.skipEmptyCatch === true
  const lines = text.split("\n")

  // A. 空 catch（单行 catch {} 或 catch (e) {}）
  if (!skipEmptyCatch) {
    // 对整段文本匹配而不是逐行：正则里的 \s 本身就能跨换行，逐行匹配会让
    // `catch (e) {\n}` 这种跨行空 catch 漏检。注释不会被 \s 吃掉，
    // 因此 `catch {\n  // 说明\n}` 依旧不算空 catch，语义与原来一致。
    for (const m of text.matchAll(/\bcatch\s*(\([^)]*\))?\s*\{\s*\}/g)) {
      const lineNo = text.slice(0, m.index).split("\n").length
      hits.push(`empty catch 吞错（失败被静默忽略）@${lineNo}`)
    }
  }

  // C. 空 catch 回调：.catch(() => {}) / .catch(function () {})
  // 与 A 同源但形态不同，A 的正则拦不到。2026-10-05：src/tui/app.tsx 曾积累
  // 13 处，其中崩溃日志写入失败被静默吞掉，事后完全无法排查。
  if (!skipEmptyCatch) {
    const patterns = [
      /\.catch\s*\(\s*\(\s*\)\s*=>\s*\{\s*\}\s*\)/g,
      /\.catch\s*\(\s*function\s*\([^)]*\)\s*\{\s*\}\s*\)/g,
    ]
    for (const re of patterns) {
      for (const m of text.matchAll(re)) {
        const lineNo = text.slice(0, m.index).split("\n").length
        // 排除 `//` 单行注释内的误报（如 "// 错误被 .catch(() => {})" 这种注释）
        const lineStart = text.lastIndexOf("\n", m.index) + 1
        const lineText = text.slice(lineStart, text.indexOf("\n", m.index) === -1 ? text.length : text.indexOf("\n", m.index))
        if (lineText.trimStart().startsWith("//")) continue
        hits.push(`空 catch 回调：promise 失败被静默忽略 @${lineNo}`)
      }
    }
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
      hits.push(`空壳自递归函数 ${name}() 只会调用自己（必然栈溢出/永不返回）@${i + 1}`)
    }
    i = end
  }
  return hits
}

function checkFile(path) {
  let text
  try {
    text = readFileSync(path, "utf-8")
  } catch {
    return []
  }
  // 测试文件里的清理类空 catch（临时文件 unlink 等）无害，不作要求；
  // 文件级豁免清单见 EMPTY_CATCH_ALLOW。
  const skipEmptyCatch = isTestFile(path) || EMPTY_CATCH_ALLOW.has(path.replace(/\\/g, "/"))
  return checkSource(text, { skipEmptyCatch }).map((h) => `${path}:${h}`)
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

// 本文件既是 CLI（pre-commit 调用）也是可被 import 的模块（供 .test.ts 驱动）。
// 被 import 时不执行下面的扫描逻辑。
if (import.meta.main) {
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
}
