# OpenCode 2.0 内核迁移（阶段 1：Bun → Node 运行时）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 gyc-code 构建产物能在纯 Node 运行时下直接运行（不 spawn Bun），根治 Bun 常驻内存回收不稳定导致的"吃内存"问题——这是 opencode 2.0 解决 2GB+ 内存的核心手段。

**Architecture:** gyc-code 已在 `src/core/package.json` 用条件导出（`imports` 字段）为 sqlite/pty/fff 三层做了 `bun`/`node` 双实现（`#sqlite`→sqlite.bun|node.ts 等）。本阶段只做"表面去 Bun"：替换 16 处 `Bun.*` 调用（stringWidth×9、file/write×4、stdin×2、hash×1），令 `build.mjs` 可产出 Node 目标产物，`bin/gyc` 在 Node 下直跑 dist。Bun 保留为开发/构建/测试工具（阶段 2 再迁移测试运行器与默认运行时）。

**Tech Stack:** Bun（开发/构建/测试）、Node ≥22.5（目标运行时，`node:sqlite` 要求）、`string-width`（新增，替代 Bun.stringWidth）、effect/unstable/sql、drizzle-orm、@opentui/solid。

**前置条件**（已核实）：Node v25.9.0；`node:sqlite` 可用；`src/core/package.json` 条件导出已就位；bin/gyc 已有 Node 分支（当前 spawn Bun 借道）；`build.mjs` 当前 `target:"bun"`、`conditions:["browser"]`。

---

### Task 0: Spike——验证 Node 目标构建可行性

**Covers:** 阶段 1 前提验证（T5 成败关键）

**Files:**
- Test: `dist/`（临时产物，验证后删除）

- [ ] **Step 1: 用 bun build 试产 Node 目标**

```bash
bun build ./src/gyccode/index.ts --target node --outdir ./dist-spike --external "@opentui/core-*" --conditions browser --define GYCCODE_VERSION:'"0.0.1"' 2>&1 | Select-Object -Last 20
```

- [ ] **Step 2: 验证产物能否被 Node 解析（仅解析，不完整启动）**

```bash
node -e "import('file://' + process.cwd() + '/dist-spike/index.js').then(()=>console.log('NODE IMPORT OK')).catch(e=>{console.error('NODE IMPORT FAIL', e.message); process.exit(1)})"
```

- [ ] **Step 3: 判定**

Expected: 若 import 成功 → 继续 T1-T8。若失败（如 @opentui/solid 依赖 browser 条件解析、`node:sqlite` 语法等）→ 记录错误，将 T5 改为"保留 bun build 产物 + Node 侧用外部化包"方案，先向用户报告再继续。

- [ ] **Step 4: 清理 spike 产物**

```bash
Remove-Item -LiteralPath ./dist-spike -Recurse -Force
```

---

### Task 1: 新增 displayWidth 工具，替换 9 处 Bun.stringWidth

**Files:**
- Create: `src/core/util/display-width.ts`
- Test: `src/core/util/display-width.test.ts`
- Modify: `src/tui/prompt/display.ts:7`、`src/gyccode/cli/cmd/run/session.shared.ts`（71,82,83,94,96）、`src/gyccode/cli/cmd/run/prompt.shared.ts`（105,139,150）

- [ ] **Step 1: 安装 string-width 依赖**

```bash
bun add string-width
```

- [ ] **Step 2: 写失败测试**（对比 Bun.stringWidth，保证替换语义一致）

```ts
// src/core/util/display-width.test.ts
import { describe, expect, it } from "bun:test"
import { displayWidth } from "./display-width"

const cases = ["", "abc", "中文", "中文 a", "🚀", "\x1b[31mred\x1b[0m", "a\tb", "！"]
describe("displayWidth", () => {
  it("matches Bun.stringWidth on representative inputs", () => {
    for (const s of cases) {
      expect(displayWidth(s), JSON.stringify(s)).toBe(Bun.stringWidth(s))
    }
  })
})
```

- [ ] **Step 3: 运行验证失败**

Run: `bun test ./src/core/util/display-width.test.ts` → Expected: FAIL（`displayWidth` not defined）

- [ ] **Step 4: 实现**

```ts
// src/core/util/display-width.ts
import stringWidth from "string-width"

/** 显示宽度（CJK/emoji 计 2），与 Bun.stringWidth 语义一致。 */
export const displayWidth = (s: string): number => stringWidth(s)
```

- [ ] **Step 5: 运行验证通过**

Run: `bun test ./src/core/util/display-width.test.ts` → Expected: PASS（若某例与 Bun.stringWidth 不一致，以 string-width 为准并在测试中标注差异，告知用户）

- [ ] **Step 6: 替换 9 处调用**

3 个文件中 `Bun.stringWidth(x)` → `displayWidth(x)`，并补 `import { displayWidth } from "../../core/util/display-width"`（相对路径按文件实际层级调整：display.ts 在 src/tui/prompt/，session.shared.ts 与 prompt.shared.ts 在 src/gyccode/cli/cmd/run/）。替换后删除 `Bun.` 残留。

- [ ] **Step 7: 验证 + 提交**

Run: `bun test ./src/core/util/display-width.test.ts; bun test ./src/tui ./src/gyccode/cli/cmd/run` → Expected: 全绿
```bash
git add src/core/util/display-width.ts src/core/util/display-width.test.ts package.json bun.lock src/tui/prompt/display.ts src/gyccode/cli/cmd/run/session.shared.ts src/gyccode/cli/cmd/run/prompt.shared.ts
git commit -m "refactor: replace Bun.stringWidth with displayWidth (string-width)"
```

---

### Task 2: persistence.ts 去 Bun.file/Bun.write（4 处）

**Files:**
- Modify: `src/tui/util/persistence.ts`
- Test: `src/tui/util/persistence.test.ts`

- [ ] **Step 1: 写失败测试**

```ts
// src/tui/util/persistence.test.ts
import { mkdtempSync, readdirSync, rmSync } from "fs"
import { tmpdir } from "os"
import { join } from "path"
import { afterAll, beforeAll, describe, expect, it } from "bun:test"
import { readJson, readText, writeJsonAtomic, writeText } from "./persistence"

const dir = mkdtempSync(join(tmpdir(), "gyc-persist-"))
const file = join(dir, "a.txt")

describe("persistence", () => {
  afterAll(() => rmSync(dir, { recursive: true, force: true }))
  it("writeText + readText round-trip", async () => {
    await writeText(file, "你好")
    expect(await readText(file)).toBe("你好")
  })
  it("writeJsonAtomic + readJson round-trip, no temp leftovers", async () => {
    await writeJsonAtomic(file, { a: 1, b: "x" })
    expect(await readJson<{ a: number; b: string }>(file)).toEqual({ a: 1, b: "x" })
    expect(readdirSync(dir).length).toBe(1)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `bun test ./src/tui/util/persistence.test.ts` → Expected: FAIL（原实现 Bun.file 仍可用会 PASS——此时应先运行确认当前实现可测，再进入实现）

- [ ] **Step 3: 实现（替换 Bun.file/Bun.write）**

```ts
// src/tui/util/persistence.ts（完整文件）
import path from "path"
import { appendFile, mkdir, readFile, rename, rm, writeFile } from "fs/promises"

export async function readText(filePath: string) {
  return readFile(filePath, "utf8")
}

export async function readJson<T>(filePath: string) {
  return JSON.parse(await readFile(filePath, "utf8")) as T
}

export async function writeText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await writeFile(filePath, content)
}

export async function appendText(filePath: string, content: string) {
  await mkdir(path.dirname(filePath), { recursive: true })
  await appendFile(filePath, content)
}

export async function writeJsonAtomic(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true })
  const temporary = `${filePath}.${process.pid}.${crypto.randomUUID()}.tmp`
  await writeFile(temporary, JSON.stringify(value)).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
  await rename(temporary, filePath).catch(async (error) => {
    await rm(temporary, { force: true }).catch(() => undefined)
    throw error
  })
}
```

- [ ] **Step 4: 运行验证通过**

Run: `bun test ./src/tui/util/persistence.test.ts` → Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/tui/util/persistence.ts src/tui/util/persistence.test.ts
git commit -m "refactor: drop Bun.file/Bun.write in persistence (node:fs/promises)"
```

---

### Task 3: 新增 readStdin 工具，替换 2 处 Bun.stdin

**Files:**
- Create: `src/core/util/read-stdin.ts`
- Test: `src/core/util/read-stdin.test.ts`
- Modify: `src/gyccode/cli/cmd/tui.ts:60`、`src/gyccode/cli/cmd/run.ts:416`

- [ ] **Step 1: 写失败测试**（spawn 子进程注入 stdin 验证）

```ts
// src/core/util/read-stdin.test.ts
import { execFileSync } from "child_process"
import { describe, expect, it } from "bun:test"

const url = "file://" + process.cwd().replace(/\\/g, "/") + "/read-stdin.ts"
const script = `
import { readStdin } from "${url}"
process.stdout.write(await readStdin())
`
describe("readStdin", () => {
  it("reads piped utf8 stdin to end", () => {
    const out = execFileSync(process.execPath, ["-e", script], { input: "你好\nworld" })
    expect(out.toString()).toBe("你好\nworld")
  })
  it("returns empty string for empty stdin", () => {
    const out = execFileSync(process.execPath, ["-e", script], { input: "" })
    expect(out.toString()).toBe("")
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `bun test ./src/core/util/read-stdin.test.ts` → Expected: FAIL（`readStdin` not defined）

- [ ] **Step 3: 实现**

```ts
// src/core/util/read-stdin.ts
/** 读取整个 stdin 为 UTF-8 文本（Bun.stdin.text() 的 Node 兼容替代）。 */
export function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = ""
    process.stdin.setEncoding("utf8")
    process.stdin.on("data", (chunk) => (data += chunk))
    process.stdin.on("end", () => resolve(data))
    process.stdin.on("error", reject)
  })
}
```

- [ ] **Step 4: 运行验证通过**

Run: `bun test ./src/core/util/read-stdin.test.ts` → Expected: PASS

- [ ] **Step 5: 替换 2 处**

`tui.ts:60` 与 `run.ts:416` 的 `await Bun.stdin.text()` → `await readStdin()`，各文件补 `import { readStdin } from "../../../core/util/read-stdin"`（按实际层级调整）。

- [ ] **Step 6: 验证 + 提交**

Run: `bun test ./src/core/util/read-stdin.test.ts` → Expected: PASS
```bash
git add src/core/util/read-stdin.ts src/core/util/read-stdin.test.ts src/gyccode/cli/cmd/tui.ts src/gyccode/cli/cmd/run.ts
git commit -m "refactor: replace Bun.stdin with readStdin (node stream)"
```

---

### Task 4: 替换 discovery.ts 的 Bun.hash（1 处）

**Files:**
- Create: `src/core/util/hash.ts`
- Test: `src/core/util/hash.test.ts`
- Modify: `src/core/skill/discovery.ts:113`

- [ ] **Step 1: 写失败测试**

```ts
// src/core/util/hash.test.ts
import { describe, expect, it } from "bun:test"
import { hashString } from "./hash"

describe("hashString", () => {
  it("is deterministic", () => {
    expect(hashString("abc")).toBe(hashString("abc"))
  })
  it("differs for different inputs", () => {
    expect(hashString("abc")).not.toBe(hashString("abd"))
  })
  it("is 16 hex chars", () => {
    expect(hashString("x")).toMatch(/^[0-9a-f]{16}$/)
  })
})
```

- [ ] **Step 2: 运行验证失败**

Run: `bun test ./src/core/util/hash.test.ts` → Expected: FAIL（`hashString` not defined）

- [ ] **Step 3: 实现**

```ts
// src/core/util/hash.ts
import { createHash } from "node:crypto"

/** 确定性字符串摘要（Bun.hash 的 Node 替代，用于缓存键/目录名）。 */
export function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16)
}
```

- [ ] **Step 4: 运行验证通过**

Run: `bun test ./src/core/util/hash.test.ts` → Expected: PASS

- [ ] **Step 5: 替换 discovery.ts:113**

`Bun.hash(base).toString(16)` → `hashString(base)`，补 import。

- [ ] **Step 6: 验证 + 提交**

Run: `bun test ./src/core/util/hash.test.ts ./src/core/skill` → Expected: PASS（skill 缓存目录名变化属预期，缓存重建可接受）
```bash
git add src/core/util/hash.ts src/core/util/hash.test.ts src/core/skill/discovery.ts
git commit -m "refactor: replace Bun.hash with hashString (node:crypto)"
```

---

### Task 5: build.mjs 支持 Node 目标

**Files:**
- Modify: `build.mjs`
- Test: 手工验证（构建 + Node 启动冒烟）

- [ ] **Step 1: 修改 build.mjs 支持运行时切换**

```js
// build.mjs 顶部增加：
const runtime = process.env.GYC_RUNTIME ?? "node"

// build({...}) 内：
  target: runtime === "node" ? "node" : "bun",
  conditions: runtime === "node" ? ["node", "browser"] : ["browser"],
```

- [ ] **Step 2: Node 目标构建**

Run: `$env:GYC_RUNTIME="node"; bun run build`
Expected: 构建成功，`dist/index.js` 生成

- [ ] **Step 3: Node 启动冒烟**

Run: `node dist/index.js --help`
Expected: 正常输出帮助或进入界面（若 T0 spike 已确认 import OK，此处应通过；失败则回到 Task 0 记录的问题）

- [ ] **Step 4: 回退 Bun 目标仍可用**

Run: `$env:GYC_RUNTIME="bun"; bun run build; bun dist/index.js --help`
Expected: 正常（Bun 目标不回归）

- [ ] **Step 5: 提交**

```bash
git add build.mjs
git commit -m "build: support node target via GYC_RUNTIME (opencode2-style node runtime)"
```

---

### Task 6: engines 与依赖声明更新

**Files:**
- Modify: `package.json`

- [ ] **Step 1: 更新 engines**

`"node": ">=18.0.0"` → `"node": ">=22.5.0"`（`node:sqlite` 要求；sqlite.node.ts 已使用）

- [ ] **Step 2: 提交**

```bash
git add package.json
git commit -m "chore: bump engines.node to >=22.5 for node:sqlite"
```

---

### Task 7: bin/gyc 纯 Node 直跑 dist

**Files:**
- Modify: `bin/gyc`

- [ ] **Step 1: 修改 Node 分支为直接 import dist**

```js
async function main() {
  if (typeof Bun === "undefined") {
    // Node runtime: import the Node-target dist bundle directly.
    if (existsSync(distEntry)) {
      await import(pathToFileURL(distEntry).href)
      return
    }
    // No dist yet: fall back to spawning Bun on TS source (dev).
    const candidates = [
      process.env.GYC_BUN,
      "C:\\Program Files\\nodejs\\bun.exe",
      path.join(process.env.USERPROFILE || "", ".bun", "bin", "bun.exe"),
    ].filter(Boolean)
    const bun = candidates.find((c) => existsSync(c)) || "bun"
    spawnBun(bun, ["--smol", "run", "--preload", preload, "--conditions=browser", srcEntry, ...process.argv.slice(2)])
    return
  }
  // ... 原有 Bun 分支不变
}
```
顶部补 `const { pathToFileURL } = require("url")`。

- [ ] **Step 2: 冒烟验证（Node 直跑）**

Run: `Remove-Item dist -Recurse -Force; $env:GYC_RUNTIME="node"; bun run build; node bin/gyc --help`
Expected: 正常输出（证明 Node 下不 spawn Bun、直接跑 dist）

- [ ] **Step 3: Bun 分支不回归**

Run: `bun bin/gyc --help`
Expected: 正常

- [ ] **Step 4: 提交**

```bash
git add bin/gyc
git commit -m "feat: run dist directly under Node (no Bun spawn)"
```

---

### Task 8: 整体验证

**Files:**
- Test: 全量回归

- [ ] **Step 1: 全量单测**

Run: `bun test`
Expected: 全绿（若个别测试依赖 Bun 行为，记录差异并评估）

- [ ] **Step 2: Node 直跑冒烟**

Run: `$env:GYC_RUNTIME="node"; bun run build; node bin/gyc --version`
Expected: 正常输出版本号

- [ ] **Step 3: 内存基线记录**

Run: 启动 gyc 会话 1 分钟，记录 Node 下 RSS 峰值，对比迁移前 Bun 基线（写回 `docs/EVALUATION-2026-08-14-opencode2-内存升级评估.md` 阶段 0/2 段落）

- [ ] **Step 4: 总结报告**

按 AGENTS.md 四步铁律输出阶段 1 总结（总结/归纳/学习/进化），更新评估文档与工作记录。

---

## T0 实测结果与计划修订（2026-08-14 执行后追加）

**T0 判定：Node 目标构建可行。** `bun build --target node` 成功，但揭示原计划未覆盖的 2 类 Bun 依赖，已修订如下：

### 实测发现

1. **4 处 `from "bun"`（非 bun: 前缀）**：原计划未列出。已解决：
   - `src/tui/component/prompt/autocomplete.tsx:2`、`src/gyccode/cli/cmd/run/footer.prompt.tsx:8`：`pathToFileURL` → `node:url`
   - `src/tui/component/dialog-status.tsx:2`：`fileURLToPath` → `node:url`
   - `src/gyccode/session/message-v2.ts:35`：`SystemError` 类型 → `NodeJS.ErrnoException`（3 处用法一并替换）
2. **2 处 `from "bun:"`（非测试代码）**：原计划未覆盖，需适配层：
   - `src/tui/editor-zed.ts:1`：`bun:sqlite`（读 Zed 数据库，3 个只读查询函数）
   - `src/tui/terminal-win32.ts:1`：`bun:ffi`（8 个 kernel32 控制台函数，4 个导出功能）
   - （其余 69 处 `bun:test` 属测试运行器，阶段 2 处理）
3. **Node 无内置 FFI、无 `node:win32`；bun 不支持 `node:sqlite`** → 必须用条件导出适配层（沿用 `#sqlite`/`#pty`/`#fff` 既有模式）。
4. **koffi 3.1.5 已装并验证**：Windows x64 prebuilt，`load/func` + C 原型 + `_Out_` + 单元素数组方式调 kernel32 成功（GetConsoleOutputCP=936、GetStdHandle、GetConsoleMode、FlushConsoleInputBuffer 均可用）。作为 Node 分支 FFI 后端。

### 新增任务

### Task 1A: zed-sqlite 适配层（editor-zed.ts 去 bun:sqlite）

**Files:**
- Create: `src/tui/zed-sqlite.bun.ts`（bun:sqlite 实现）、`src/tui/zed-sqlite.node.ts`（node:sqlite 实现）、`src/tui/zed-sqlite.ts`（接口类型）
- Modify: `src/core/package.json`（imports 加 `#zed-sqlite` 条件）、`src/tui/editor-zed.ts`（改用适配层）

- [ ] **Step 1: 定义接口 + 双实现**

```ts
// src/tui/zed-sqlite.ts（接口）
export interface ZedDb {
  query(sql: string): { all(params?: Record<string, unknown>): unknown[]; get(params?: Record<string, unknown>): unknown }
  close(): void
}
export interface ZedDbFactory { open(path: string): ZedDb }
```

```ts
// src/tui/zed-sqlite.bun.ts
import { Database } from "bun:sqlite"
import type { ZedDb, ZedDbFactory } from "./zed-sqlite"
export const zedSqlite: ZedDbFactory = {
  open(path) {
    const db = new Database(path, { readonly: true })
    return {
      query(sql) {
        return { all: (p) => db.query(sql).all(p), get: (p) => db.query(sql).get(p) }
      },
      close: () => db.close(),
    }
  },
}
```

```ts
// src/tui/zed-sqlite.node.ts
import { DatabaseSync } from "node:sqlite"
import type { ZedDb, ZedDbFactory } from "./zed-sqlite"
export const zedSqlite: ZedDbFactory = {
  open(path) {
    const db = new DatabaseSync(path, { readOnly: true })
    return {
      query(sql) {
        return { all: (p) => db.prepare(sql).all(p), get: (p) => db.prepare(sql).get(p) }
      },
      close: () => db.close(),
    }
  },
}
```

- [ ] **Step 2: 条件导出**

`src/core/package.json` 的 imports 增加：
```json
"#zed-sqlite": {
  "bun": "../tui/zed-sqlite.bun.ts",
  "node": "../tui/zed-sqlite.node.ts",
  "default": "../tui/zed-sqlite.bun.ts"
}
```

- [ ] **Step 3: editor-zed.ts 改用适配层**

3 个查询函数中 `new Database(dbPath, { readonly: true })` → `zedSqlite.open(dbPath)`，`db.query(sql).all/get(params)` → `zedDb.query(sql).all/get(params)`，`db?.close()` 不变；删除 `import { Database } from "bun:sqlite"`，改为 `import { zedSqlite } from "#zed-sqlite"`。

- [ ] **Step 4: 验证**

Run: `bun test`（editor-zed 相关无单测则跑全量 + tsc）→ 确认无 `bun:sqlite` 残留：`rg -n 'bun:sqlite' src --glob '!*.test.ts'` 为空

- [ ] **Step 5: 提交**

```bash
git add src/tui/zed-sqlite.ts src/tui/zed-sqlite.bun.ts src/tui/zed-sqlite.node.ts src/core/package.json src/tui/editor-zed.ts
git commit -m "refactor: zed sqlite via conditional adapter (#zed-sqlite, bun:sqlite/node:sqlite)"
```

### Task 1B: win32-kernel 适配层（terminal-win32.ts 去 bun:ffi）

**Files:**
- Create: `src/tui/win32-kernel.bun.ts`（bun:ffi 实现）、`src/tui/win32-kernel.node.ts`（koffi 实现）、`src/tui/win32-kernel.ts`（接口）
- Modify: `src/core/package.json`（imports 加 `#win32-kernel`）、`src/tui/terminal-win32.ts`（改用适配层）

- [ ] **Step 1: 定义接口（对齐 terminal-win32 现有 8 个符号）**

```ts
// src/tui/win32-kernel.ts
export interface Win32Kernel {
  GetStdHandle(n: number): number
  GetConsoleMode(h: number, out: number[]): number
  SetConsoleMode(h: number, mode: number): number
  FlushConsoleInputBuffer(h: number): number
  SetConsoleOutputCP(cp: number): number
  GetConsoleOutputCP(): number
  SetConsoleInputCP(cp: number): number
  GetConsoleInputCP(): number
}
export interface Win32KernelLoader { load(): Win32Kernel | null }
```

- [ ] **Step 2: bun 实现（bun:ffi，逻辑照搬 terminal-win32 现有 kernel() 函数）**

```ts
// src/tui/win32-kernel.bun.ts
import { dlopen, ptr } from "bun:ffi"
import type { Win32Kernel, Win32KernelLoader } from "./win32-kernel"
export const win32KernelLoader: Win32KernelLoader = {
  load() {
    try {
      const k = dlopen("kernel32.dll", {
        GetStdHandle: { args: ["i32"], returns: "ptr" },
        GetConsoleMode: { args: ["ptr", "ptr"], returns: "i32" },
        SetConsoleMode: { args: ["ptr", "u32"], returns: "i32" },
        FlushConsoleInputBuffer: { args: ["ptr"], returns: "i32" },
        SetConsoleOutputCP: { args: ["u32"], returns: "i32" },
        GetConsoleOutputCP: { args: [], returns: "u32" },
        SetConsoleInputCP: { args: ["u32"], returns: "i32" },
        GetConsoleInputCP: { args: [], returns: "u32" },
      })
      const modeBuf = new Uint32Array(1)
      return {
        GetStdHandle: (n) => k.symbols.GetStdHandle(n),
        GetConsoleMode: (h, out) => { const r = k.symbols.GetConsoleMode(h, ptr(modeBuf)); out[0] = modeBuf[0]!; return r },
        SetConsoleMode: (h, m) => k.symbols.SetConsoleMode(h, m),
        FlushConsoleInputBuffer: (h) => k.symbols.FlushConsoleInputBuffer(h),
        SetConsoleOutputCP: (cp) => k.symbols.SetConsoleOutputCP(cp),
        GetConsoleOutputCP: () => k.symbols.GetConsoleOutputCP(),
        SetConsoleInputCP: (cp) => k.symbols.SetConsoleInputCP(cp),
        GetConsoleInputCP: () => k.symbols.GetConsoleInputCP(),
      }
    } catch { return null }
  },
}
```

- [ ] **Step 3: node 实现（koffi，已验证 API）**

```ts
// src/tui/win32-kernel.node.ts
import koffi from "koffi"
import type { Win32Kernel, Win32KernelLoader } from "./win32-kernel"
export const win32KernelLoader: Win32KernelLoader = {
  load() {
    try {
      const lib = koffi.load("kernel32.dll")
      const GetStdHandle = lib.func("void * GetStdHandle(int32_t nStdHandle)")
      const GetConsoleMode = lib.func("int32_t __stdcall GetConsoleMode(void * h, _Out_ uint32_t * mode)")
      const SetConsoleMode = lib.func("int32_t __stdcall SetConsoleMode(void * h, uint32_t mode)")
      const FlushConsoleInputBuffer = lib.func("int32_t __stdcall FlushConsoleInputBuffer(void * h)")
      const SetConsoleOutputCP = lib.func("int32_t __stdcall SetConsoleOutputCP(uint32_t cp)")
      const GetConsoleOutputCP = lib.func("uint32_t __stdcall GetConsoleOutputCP()")
      const SetConsoleInputCP = lib.func("int32_t __stdcall SetConsoleInputCP(uint32_t cp)")
      const GetConsoleInputCP = lib.func("uint32_t __stdcall GetConsoleInputCP()")
      const modeOut = [0]
      return {
        GetStdHandle: (n) => GetStdHandle(n),
        GetConsoleMode: (h, out) => { const r = GetConsoleMode(h, modeOut); out[0] = modeOut[0]!; return r },
        SetConsoleMode: (h, m) => SetConsoleMode(h, m),
        FlushConsoleInputBuffer: (h) => FlushConsoleInputBuffer(h),
        SetConsoleOutputCP: (cp) => SetConsoleOutputCP(cp),
        GetConsoleOutputCP: () => GetConsoleOutputCP(),
        SetConsoleInputCP: (cp) => SetConsoleInputCP(cp),
        GetConsoleInputCP: () => GetConsoleInputCP(),
      }
    } catch { return null }
  },
}
```

- [ ] **Step 4: 条件导出**

`src/core/package.json` imports 增加：
```json
"#win32-kernel": {
  "bun": "../tui/win32-kernel.bun.ts",
  "node": "../tui/win32-kernel.node.ts",
  "default": "../tui/win32-kernel.bun.ts"
}
```

- [ ] **Step 5: terminal-win32.ts 改用适配层**

删除 `import { dlopen, ptr } from "bun:ffi"`，改 `import { win32KernelLoader } from "#win32-kernel"`；`load()` 函数改为 `k32 = win32KernelLoader.load()`；`k32!.symbols.GetConsoleOutputCP()` → `k32.GetConsoleOutputCP()`，`GetConsoleMode(handle, ptr(buf))` → `GetConsoleMode(handle, buf)`，其余符号访问同步去除 `.symbols`。

- [ ] **Step 6: 验证 + 提交**

Run: `bun test` 全绿；`node -e "import('#win32-kernel').then(...)"` 无法直接验证条件，用 `bun build --target node` 后确认产物无 `bun:ffi` 残留
```bash
git add src/tui/win32-kernel.ts src/tui/win32-kernel.bun.ts src/tui/win32-kernel.node.ts src/core/package.json src/tui/terminal-win32.ts package.json bun.lock
git commit -m "refactor: win32 kernel via conditional adapter (#win32-kernel, bun:ffi/koffi)"
```

### 任务编号修订

- T5（build.mjs）Step 1 的 `conditions`：Node 目标须为 `["node", "browser"]`（T0 已实测确认，缺 `node` 会落到 bun 条件、产物含 `bun:sqlite`）。
- T1-T4 任务内容不变，编号顺延后执行顺序：T1 → T1A → T1B → T2 → T3 → T4 → T5 → T6 → T7 → T8。

---

## 自检记录（Self-Review）

- **Spec 覆盖**：Task 0-8 覆盖阶段 1 全部目标（去 16 处 Bun API、Node 目标构建、bin 直跑、engines、验证）。评估文档"剩余迁移成本表"的每一项均有对应任务。
- **占位符扫描**：所有替换点均已核实真实行号与上下文（T1 9 处、T2 4 处、T3 2 处、T4 1 处）；无 TBD/TODO。
- **类型一致性**：`displayWidth`/`readStdin`/`hashString` 命名在测试与实现间一致；`GYC_RUNTIME` 环境变量在 T5/T7/T8 一致；`pathToFileURL` 在 T7 引入。
- **遗留项（阶段 2，本计划不做）**：测试运行器迁移（bun test→node --test/vitest）、默认运行时切 Node 的安装分发、常驻服务模式评估、`@tsconfig/bun`→`@tsconfig/node22`、`Bun.$`（plugin/index.ts:164 已有守卫，Node 下安全，不改）。
