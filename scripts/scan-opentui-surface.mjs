// scan-opentui-surface：扫描 src/tui 对 @opentui 的依赖面（只读，M0 交付物）。
//
// 目的：把「要替代 opentui 到底要补什么」从人工盘点变成可重复执行的脚本。
// 替代计划每个里程碑结束跑一次，`@opentui` 引用文件数必须单调下降；M8 用
// `--fail-on-import` 作为剥离门禁。
//
// 口径（重要，勿改而不注明）：
//   - 计数是**文本级正则**，不是 AST。属性用 `name=` 匹配（JSX 写法），
//     因此对象字面量 `{ flexGrow: 1 }` 不计入；个别 `const flexGrow = ...`
//     变量声明会被误计，属已知噪声。
//   - intrinsic 只认 opentui 组件目录里登记的 21 个标签名
//     （node_modules/@opentui/solid/src/elements/catalogue.d.ts:31-53）。
//   - 测试文件计入（14 处 testRender 属真实迁移成本），但在输出里单列。
//
// 用法：
//   node scripts/scan-opentui-surface.mjs                 # 人类可读报告
//   node scripts/scan-opentui-surface.mjs --json          # 机器可读（CI 比对）
//   node scripts/scan-opentui-surface.mjs --include-fallback  # 把 fallback 目录也计入
//   node scripts/scan-opentui-surface.mjs --fail-on-import    # 存在 @opentui 引用即退出码 1
import { readdirSync, readFileSync } from "node:fs"
import { join, relative, sep } from "node:path"

const ROOT = process.cwd()
const TUI_DIR = join(ROOT, "src", "tui")

const argv = process.argv.slice(2)
const asJson = argv.includes("--json")
const includeFallback = argv.includes("--include-fallback")
const failOnImport = argv.includes("--fail-on-import")

// opentui 组件目录登记的全部 intrinsic（顺序无关，匹配时按长度降序）
const INTRINSICS = [
  "box",
  "text",
  "input",
  "select",
  "textarea",
  "ascii_font",
  "tab_select",
  "scrollbox",
  "code",
  "diff",
  "line_number",
  "markdown",
  "image",
  "span",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "br",
  "a",
]

// 布局/盒模型/文本/滚动/编辑器属性白名单：来自
// Renderable.d.ts:29-87、Box.d.ts:6-23、TextBufferRenderable.d.ts:10-22、
// ScrollBox.d.ts:18-32、EditBufferRenderable.d.ts:26-45。
const ATTRIBUTES = [
  // 尺寸与盒模型
  "width",
  "height",
  "minWidth",
  "minHeight",
  "maxWidth",
  "maxHeight",
  "margin",
  "marginX",
  "marginY",
  "marginTop",
  "marginRight",
  "marginBottom",
  "marginLeft",
  "padding",
  "paddingX",
  "paddingY",
  "paddingTop",
  "paddingRight",
  "paddingBottom",
  "paddingLeft",
  "gap",
  "rowGap",
  "columnGap",
  // flex
  "flexGrow",
  "flexShrink",
  "flexBasis",
  "flexDirection",
  "flexWrap",
  "alignItems",
  "alignSelf",
  "justifyContent",
  // 定位与合成
  "position",
  "top",
  "right",
  "bottom",
  "left",
  "zIndex",
  "overflow",
  "opacity",
  "visible",
  "buffered",
  "live",
  // 边框与背景
  "border",
  "borderStyle",
  "borderColor",
  "customBorderChars",
  "backgroundColor",
  "focusedBorderColor",
  "title",
  "titleColor",
  "titleAlignment",
  "bottomTitle",
  "bottomTitleAlignment",
  "shouldFill",
  // 文本
  "fg",
  "bg",
  "attributes",
  "wrapMode",
  "textAlign",
  "truncate",
  "tabIndicator",
  "tabIndicatorColor",
  "selectable",
  "selectionBg",
  "selectionFg",
  "content",
  "streaming",
  "conceal",
  "drawUnstyledText",
  "filetype",
  "syntaxStyle",
  "internalBlockMode",
  "tableOptions",
  "showLineNumbers",
  "diff",
  "view",
  // 滚动
  "scrollTop",
  "scrollLeft",
  "scrollX",
  "scrollY",
  "scrollAcceleration",
  "scrollbarOptions",
  "verticalScrollbarOptions",
  "horizontalScrollbarOptions",
  "stickyScroll",
  "stickyStart",
  "viewportCulling",
  "contentOptions",
  // 编辑器
  "placeholder",
  "placeholderColor",
  "textColor",
  "focusedTextColor",
  "cursorColor",
  "cursorStyle",
  "showCursor",
  "scrollMargin",
  "scrollSpeed",
  "selectionOccupancy",
  // 事件
  "onMouse",
  "onMouseDown",
  "onMouseUp",
  "onMouseMove",
  "onMouseDrag",
  "onMouseDragEnd",
  "onMouseDrop",
  "onMouseOver",
  "onMouseOut",
  "onMouseScroll",
  "onPaste",
  "onKeyDown",
  "onSizeChange",
  "onContentChange",
  "onCursorChange",
  "onSubmit",
  "onInput",
]

// 应用层 API / hooks（@opentui/solid/src/elements/hooks.d.ts:2-38、
// extras.d.ts:11-41、reconciler.d.ts:5、@opentui/keymap）
const APIS = [
  "useRenderer",
  "useTerminalDimensions",
  "useKeyboard",
  "usePaste",
  "useSelectionHandler",
  "useTimeline",
  "onResize",
  "onFocus",
  "onBlur",
  "Portal",
  "Dynamic",
  "createDynamic",
  "createSlot",
  "testRender",
  "KeymapProvider",
  "useKeymap",
  "useKeymapSelector",
  "useBindings",
  "dispatchCommand",
]

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue
      if (!includeFallback && relative(TUI_DIR, full).split(sep)[0] === "fallback") continue
      out.push(...walk(full))
      continue
    }
    if (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) out.push(full)
  }
  return out
}

function countAll(regex, text) {
  let n = 0
  for (const _ of text.matchAll(regex)) n += 1
  return n
}

// 备选分支按长度降序，避免 `border` 抢先匹配 `borderStyle` 这类前缀关系
// （回溯虽能兜住，但显式排序让口径不依赖引擎行为）
const longestFirst = (names) => [...names].sort((a, b) => b.length - a.length).join("|")
const intrinsicRe = new RegExp(`<(${longestFirst(INTRINSICS)})(?=[\\s/>])`, "g")
const attributeRe = new RegExp(`\\b(${longestFirst(ATTRIBUTES)})\\s*=`, "g")
const apiRe = new RegExp(`\\b(${longestFirst(APIS)})\\s*\\(`, "g")
const importRe = /@opentui\/(core|solid|keymap)/g

const files = walk(TUI_DIR)
const intrinsicCounts = new Map()
const attributeCounts = new Map()
const apiCounts = new Map()
const importFiles = []
const importByPackage = new Map()
let totalLines = 0
let testFiles = 0

for (const file of files) {
  const text = readFileSync(file, "utf8")
  totalLines += text.split("\n").length
  const rel = relative(ROOT, file).split(sep).join("/")
  if (/\.test\.tsx?$/.test(file)) testFiles += 1

  const imports = [...text.matchAll(importRe)]
  if (imports.length > 0) {
    importFiles.push(rel)
    for (const m of imports) {
      const pkg = `@opentui/${m[1]}`
      importByPackage.set(pkg, (importByPackage.get(pkg) ?? 0) + 1)
    }
  }

  for (const m of text.matchAll(intrinsicRe)) {
    intrinsicCounts.set(m[1], (intrinsicCounts.get(m[1]) ?? 0) + 1)
  }
  for (const m of text.matchAll(attributeRe)) {
    attributeCounts.set(m[1], (attributeCounts.get(m[1]) ?? 0) + 1)
  }
  for (const m of text.matchAll(apiRe)) {
    apiCounts.set(m[1], (apiCounts.get(m[1]) ?? 0) + 1)
  }
}

const byCountDesc = (map) =>
  [...map.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))

const report = {
  scope: {
    root: "src/tui",
    includeFallback,
    files: files.length,
    testFiles,
    lines: totalLines,
  },
  opentuiImports: {
    files: importFiles.length,
    total: [...importByPackage.values()].reduce((a, b) => a + b, 0),
    byPackage: Object.fromEntries(byCountDesc(importByPackage)),
    fileList: importFiles.sort(),
  },
  intrinsics: Object.fromEntries(byCountDesc(intrinsicCounts)),
  attributes: Object.fromEntries(byCountDesc(attributeCounts)),
  apis: Object.fromEntries(byCountDesc(apiCounts)),
}

if (asJson) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log("[scan-opentui-surface] 扫描范围：src/tui" + (includeFallback ? "（含 fallback）" : "（不含 fallback）"))
  console.log(`  文件 ${report.scope.files}（其中测试 ${report.scope.testFiles}）· 行数 ${report.scope.lines}`)
  console.log("")
  console.log(`[1] @opentui 引用：${report.opentuiImports.files} 个文件 / ${report.opentuiImports.total} 处`)
  for (const [pkg, n] of byCountDesc(importByPackage)) console.log(`    ${pkg.padEnd(22)} ${n}`)
  console.log("")
  console.log("[2] intrinsic 用量")
  for (const [name, n] of byCountDesc(intrinsicCounts)) console.log(`    <${name}>`.padEnd(24) + n)
  console.log("")
  console.log("[3] 属性用量 Top 30")
  for (const [name, n] of byCountDesc(attributeCounts).slice(0, 30)) console.log(`    ${name.padEnd(22)} ${n}`)
  console.log("")
  console.log("[4] 应用层 API 用量")
  for (const [name, n] of byCountDesc(apiCounts)) console.log(`    ${name.padEnd(22)} ${n}`)
  if (report.opentuiImports.files > 0) {
    console.log("")
    console.log("[5] 引用文件清单（M8 剥离门禁：本清单必须为空）")
    for (const f of report.opentuiImports.fileList) console.log(`    ${f}`)
  }
}

if (failOnImport && report.opentuiImports.files > 0) {
  console.error(
    `[scan-opentui-surface] 失败：仍有 ${report.opentuiImports.files} 个文件引用 @opentui（--fail-on-import）`,
  )
  process.exit(1)
}
