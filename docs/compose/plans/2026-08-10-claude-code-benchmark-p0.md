# P0 阶段实施计划：Claude Code 三指标对标改进（第一批）

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../reports/claude-code-benchmark-p0.md)


> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 完成 P0 阶段 4 项改进：记忆自动提取接线（S4）、read-before-write 强制（H1）、prompt cache 字节级稳定（C1）、token budget 续跑接线（C2）。

**Architecture:** 4 项均为对 gyc-cli 主循环/工具层的增量增强。P0-1 新增 extraction-runner 模块并接入 runLoop；P0-2 扩展 read-cache 状态跟踪并在 write/edit 工具强制检查；P0-3 在 message-v2 序列化层引入截断决策冻结（模块级缓存）；P0-4 将 token-budget.ts 死代码接线到主循环停止判定。

**Tech Stack:** TypeScript, effect 4.0, Bun 1.3.14, bun:test, drizzle/sqlite

**Spec:** `docs/compose/specs/2026-08-10-claude-code-benchmark-design.md`（[S3] 的 P0-1/P0-2/P0-3/P0-4）

---

## 文件结构

- Create: `src/gyccode/memory/extraction-runner.ts` — 记忆提取 runner（可注入 extractor）
- Test: `src/gyccode/memory/extraction-runner.test.ts`
- Modify: `src/gyccode/session/prompt.ts` — runLoop 接线提取（每 3 轮异步触发）
- Modify: `src/core/v1/config/config.ts` — 新增 `memory.extraction` 配置字段
- Modify: `src/gyccode/tool/read-cache.ts` — 新增已读状态跟踪
- Modify: `src/gyccode/tool/read.ts` — 读取成功后 markRead
- Modify: `src/gyccode/tool/write.ts` — 已存在文件未读则报错
- Modify: `src/gyccode/tool/edit.ts` — 编辑前强制已读检查
- Modify: `src/gyccode/session/message-v2.ts` — aggregateToolCaps 决策冻结
- Test: `src/gyccode/session/message-v2.cache.test.ts`
- Modify: `src/gyccode/session/token-budget.ts` — 新增续跑判定函数
- Test: `src/gyccode/session/token-budget.test.ts`

---

### Task 1: read-cache 已读状态跟踪（P0-2 基础）

**Covers:** [S3-P0-2]

**Files:**
- Modify: `src/gyccode/tool/read-cache.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/gyccode/tool/read-cache.test.ts`：

```ts
import { expect, test } from "bun:test"
import { ReadCache } from "./read-cache"

test("hasRead is false for unseen file, true after markRead", () => {
  const cache = ReadCache()
  expect(cache.hasRead("C:/proj/a.ts")).toBe(false)
  cache.markRead("C:/proj/a.ts")
  expect(cache.hasRead("C:/proj/a.ts")).toBe(true)
})

test("set() also marks the file as read", () => {
  const cache = ReadCache()
  cache.set("C:/proj/b.ts", "content", { mtime: new Date(), size: 7, type: "File" })
  expect(cache.hasRead("C:/proj/b.ts")).toBe(true)
})

test("invalidate clears content but keeps read state", () => {
  const cache = ReadCache()
  cache.markRead("C:/proj/c.ts")
  cache.invalidate("C:/proj/c.ts")
  expect(cache.get("C:/proj/c.ts")).toBeUndefined()
  expect(cache.hasRead("C:/proj/c.ts")).toBe(true)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/gyccode/tool/read-cache.test.ts`
Expected: FAIL — `cache.hasRead is not a function`

- [ ] **Step 3: 实现**

修改 `src/gyccode/tool/read-cache.ts`：

```ts
// Simple in-memory read cache for file contents

export const FILE_UNCHANGED_STUB = "<file unchanged>"

const MAX_ENTRIES = 200

export type StatLike = {
  mtime?: Date
  size?: number
  type?: string
}

/**
 * Shared singleton maps. All callers share the same underlying maps, so the
 * cache (and the read-state set) is effectively a singleton across tools.
 */
const map = new Map<string, { content: string; stat: StatLike | typeof FILE_UNCHANGED_STUB }>()
const readSet = new Set<string>()

export const ReadCache = () => {
  return {
    get(filepath: string) {
      return map.get(filepath)
    },
    getStat(filepath: string) {
      const entry = map.get(filepath)
      return entry?.stat as StatLike | typeof FILE_UNCHANGED_STUB | undefined
    },
    set(filepath: string, content: string, stat: StatLike | typeof FILE_UNCHANGED_STUB) {
      if (map.size >= MAX_ENTRIES && !map.has(filepath)) {
        const oldest = map.keys().next().value
        if (oldest !== undefined) map.delete(oldest)
      }
      map.set(filepath, { content, stat })
      readSet.add(filepath)
    },
    invalidate(filepath: string) {
      map.delete(filepath)
    },
    /** True when the file was read (or written) in this process/session. */
    hasRead(filepath: string) {
      return readSet.has(filepath)
    },
    /** Record that the file has been read in this session. */
    markRead(filepath: string) {
      readSet.add(filepath)
    },
  }
}
```

注意：把 `map` 从函数闭包移到模块顶层，`readSet` 同层——保证所有 `ReadCache()` 调用共享同一实例（原有行为）并共享已读状态。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/gyccode/tool/read-cache.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 提交**

```bash
git add src/gyccode/tool/read-cache.ts src/gyccode/tool/read-cache.test.ts
git commit -m "feat(tool): track read state in read-cache for read-before-write"
```

---

### Task 2: read 工具成功后 markRead（P0-2 基础）

**Covers:** [S3-P0-2]

**Files:**
- Modify: `src/gyccode/tool/read.ts`

- [ ] **Step 1: 实现（无新测试，read 工具已有行为测试面）**

在 `src/gyccode/tool/read.ts` 的文件读取路径（`readCache.set(...)` 处，约 line 402）之前加 `readCache.markRead(filepath)`。同时在 file-unchanged 桩返回分支（约 line 264 缓存命中）也 `markRead(filepath)`（因为读到过）。目录读取不 markRead。

修改点：
1. cache-hit 分支（`return { title, output: FILE_UNCHANGED_STUB, ... }`）前：`readCache.markRead(filepath)`
2. 文件读取成功 `readCache.set(...)` 前：`readCache.markRead(filepath)`

- [ ] **Step 2: 类型检查**

Run: `bun tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 提交**

```bash
git add src/gyccode/tool/read.ts
git commit -m "feat(tool): mark files as read after successful Read tool calls"
```

---

### Task 3: write/edit 强制 read-before-write（H1）

**Covers:** [S3-P0-2]

**Files:**
- Modify: `src/gyccode/tool/write.ts`
- Modify: `src/gyccode/tool/edit.ts`
- Test: `src/gyccode/tool/read-before-write.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/gyccode/tool/read-before-write.test.ts`，测试 read-cache 与"已读"语义（工具级强制逻辑在 execute 内，测试 read-cache 状态即可；工具级集成靠 tsc + 手动核对）：

```ts
import { expect, test } from "bun:test"
import { ReadCache, FILE_UNCHANGED_STUB } from "./read-cache"

test("read-before-write guard state: set then invalidate keeps read=true", () => {
  const cache = ReadCache()
  cache.set("/tmp/rw.ts", "x", { mtime: new Date(), size: 1, type: "File" })
  cache.invalidate("/tmp/rw.ts")
  expect(cache.hasRead("/tmp/rw.ts")).toBe(true)
})

test("write of a new file needs no prior read; existing file needs read", () => {
  const cache = ReadCache()
  // Simulate the guard: a file that exists but was never read must be rejected.
  cache.invalidate("/tmp/existing.ts")
  expect(cache.hasRead("/tmp/existing.ts")).toBe(false)
  // After read (stub) it is allowed.
  cache.markRead("/tmp/existing.ts")
  expect(cache.hasRead("/tmp/existing.ts")).toBe(true)
})

test("FILE_UNCHANGED_STUB is exported for tool reuse", () => {
  expect(FILE_UNCHANGED_STUB).toBe("<file unchanged>")
})
```

- [ ] **Step 2: 运行测试确认通过（此测试基于 Task 1 的 read-cache，应先通过）**

Run: `bun test src/gyccode/tool/read-before-write.test.ts`
Expected: PASS

- [ ] **Step 3: write.ts 实现强制检查**

在 `src/gyccode/tool/write.ts` 的 execute 中，`const exists = yield* fs.existsSafe(filepath)` 之后加：

```ts
const exists = yield* fs.existsSafe(filepath)
if (exists && !readCache.hasRead(filepath)) {
  throw new Error(
    `File has not been read in this session: ${filepath}. Read it first with the read tool to confirm current content before writing.`,
  )
}
```

- [ ] **Step 4: edit.ts 实现强制检查**

在 `src/gyccode/tool/edit.ts` 的 execute 中，读取文件内容（stat）后、diff 匹配前加：

```ts
if (!readCache.hasRead(filepath)) {
  throw new Error(
    `File has not been read in this session: ${filepath}. Read it first with the read tool before editing.`,
  )
}
```

注意定位到 edit 读取当前文件内容的实际位置（在 execute 内文件路径确定后）。

- [ ] **Step 5: 类型检查 + 相关测试**

Run: `bun tsc --noEmit`
Run: `bun test src/gyccode/tool/read-cache.test.ts src/gyccode/tool/read-before-write.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/gyccode/tool/write.ts src/gyccode/tool/edit.ts src/gyccode/tool/read-before-write.test.ts
git commit -m "feat(tool): enforce read-before-write in write/edit tools"
```

---

### Task 4: token-budget 续跑判定函数（C2 基础）

**Covers:** [S3-P0-4]

**Files:**
- Modify: `src/gyccode/session/token-budget.ts`
- Test: `src/gyccode/session/token-budget.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/gyccode/session/token-budget.test.ts`：

```ts
import { expect, test } from "bun:test"
import { parseTokenBudget, parseTokenBudgetNL, checkTokenBudget, budgetContinuationMessage } from "./token-budget"

test("parseTokenBudget parses numeric + suffix", () => {
  expect(parseTokenBudget("+500k")).toBe(500_000)
  expect(parseTokenBudget("2m")).toBe(2_000_000)
  expect(parseTokenBudget("150000")).toBe(150_000)
  expect(parseTokenBudget("not a budget")).toBeNull()
})

test("parseTokenBudgetNL parses natural language", () => {
  expect(parseTokenBudgetNL("use 2M tokens please")).toBe(2_000_000)
  expect(parseTokenBudgetNL("limit to 500k tokens")).toBe(500_000)
  expect(parseTokenBudgetNL("+500k")).toBe(500_000)
  expect(parseTokenBudgetNL("hello world")).toBeNull()
})

test("checkTokenBudget continues under threshold, stops at completion", () => {
  // budget 100k, used 50k (< 90%) -> continue
  expect(checkTokenBudget({ budget: 100_000, used: 50_000, continuations: 0, lastIncrement: 0 }).action).toBe("continue")
  // used 95k (>= 90%) -> complete
  expect(checkTokenBudget({ budget: 100_000, used: 95_000, continuations: 0, lastIncrement: 0 }).action).toBe("complete")
  // diminishing returns: 3+ continuations and increment < 500 -> complete
  expect(
    checkTokenBudget({ budget: 100_000, used: 60_000, continuations: 3, lastIncrement: 200 }).action,
  ).toBe("complete")
})

test("budgetContinuationMessage includes progress percentage", () => {
  const msg = budgetContinuationMessage(0.5)
  expect(msg).toContain("50%")
  expect(msg).toContain("Keep working")
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/gyccode/session/token-budget.test.ts`
Expected: FAIL — `checkTokenBudget`/`budgetContinuationMessage` not exported

- [ ] **Step 3: 实现**

在 `src/gyccode/session/token-budget.ts` 末尾追加：

```ts
export const BUDGET_COMPLETION_THRESHOLD = 0.9
export const BUDGET_DIMINISHING_THRESHOLD = 500
export const BUDGET_DIMINISHING_MIN_CONTINUATIONS = 3

export interface BudgetState {
  /** Total token budget target from the user instruction. */
  budget: number
  /** Tokens consumed toward the budget so far. */
  used: number
  /** Number of continuation turns injected so far. */
  continuations: number
  /** Token increment of the most recent continuation turn. */
  lastIncrement: number
}

export type BudgetAction = "continue" | "complete"

export function checkTokenBudget(state: BudgetState): { action: BudgetAction } {
  const pct = state.used / state.budget
  if (pct < BUDGET_COMPLETION_THRESHOLD) return { action: "continue" }
  if (
    state.continuations >= BUDGET_DIMINISHING_MIN_CONTINUATIONS &&
    state.lastIncrement < BUDGET_DIMINISHING_THRESHOLD
  ) {
    return { action: "complete" }
  }
  return { action: "complete" }
}

export function budgetContinuationMessage(pct: number): string {
  const percent = Math.round(pct * 100)
  return `Stopped at ${percent}% of token target. Keep working — do not summarize. Continue the task until the token budget is used or the work is complete.`
}
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/gyccode/session/token-budget.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 提交**

```bash
git add src/gyccode/session/token-budget.ts src/gyccode/session/token-budget.test.ts
git commit -m "feat(session): add token budget continuation check + message"
```

---

### Task 5: token-budget 接线到主循环（C2）

**Covers:** [S3-P0-4]

**Files:**
- Modify: `src/gyccode/session/prompt.ts`

- [ ] **Step 1: 实现接线**

在 `src/gyccode/session/prompt.ts` 的 runLoop 中：

1. 在 `let resumes = 0` 旁新增 budget 状态：

```ts
let resumes = 0
let budget: { target: number; used: number; continuations: number; lastIncrement: number } | undefined
let budgetParsed = false
```

2. 在停止判定块（`lastAssistant?.finish && !["tool-calls"]...` 的 break 之前）插入 token budget 续跑逻辑。在断言的 else 分支（即将 break 前），先尝试 budget 续跑：

```ts
// Token budget continuation: parse "+500k" / "use 2M tokens" from the
// latest user message; keep the loop running until the budget is consumed.
if (!budgetParsed) {
  budgetParsed = true
  const budgetText = msgs
    .filter((m) => m.info.role === "user")
    .flatMap((m) => m.parts)
    .filter((p) => p.type === "text" && "synthetic" in p && !p.synthetic)
    .map((p) => (p.type === "text" ? p.text : ""))
    .join(" ")
  const target = parseTokenBudgetNL(budgetText)
  if (target) budget = { target, used: 0, continuations: 0, lastIncrement: 0 }
}

if (budget && lastAssistant?.finish && lastAssistant.finish !== "length") {
  const increment = lastFinished?.tokens?.total ?? lastFinished?.tokens?.output ?? 0
  budget.used += increment
  budget.lastIncrement = increment
  const { action } = checkTokenBudget(budget)
  if (action === "continue" && lastUser.id < lastAssistant.id && !hasToolCalls) {
    budget.continuations += 1
    yield* Effect.logInfo("token budget continuation", {
      "session.id": sessionID,
      budget: budget.target,
      used: budget.used,
      continuation: budget.continuations,
    })
    const continueUserMsg: SessionV1.User = {
      id: MessageID.ascending(),
      sessionID,
      time: { created: Date.now() },
      role: "user",
      agent: lastUser.agent,
      model: { providerID: lastUser.model.providerID, modelID: lastUser.model.modelID },
    }
    yield* sessions.updateMessage(continueUserMsg)
    yield* sessions.updatePart({
      type: "text",
      id: PartID.ascending(),
      messageID: continueUserMsg.id,
      sessionID,
      text: budgetContinuationMessage(budget.used / budget.target),
      synthetic: true,
    } satisfies SessionV1.Part)
    continue
  }
}
```

插入位置：在 `if (lastAssistant?.finish && !["tool-calls"]... ) { ... break }` 块的 break 之前（或该块判断为假时）。最稳妥：把 budget 检查放在该 break 块之前——若 `finish` 非 tool-calls 且非 length 且满足 budget 续跑 → continue，否则进入原有 break 块。将 budget 检查插入到 length 续写块之后、break 块之前。

- [ ] **Step 2: 导入 token-budget 函数**

在 prompt.ts 顶部 import：

```ts
import { parseTokenBudgetNL, checkTokenBudget, budgetContinuationMessage } from "./token-budget"
```

- [ ] **Step 3: 类型检查**

Run: `bun tsc --noEmit`
Expected: PASS

- [ ] **Step 4: 相关测试**

Run: `bun test src/gyccode/session/token-budget.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/gyccode/session/prompt.ts
git commit -m "feat(session): wire token budget continuation into runLoop"
```

---

### Task 6: message-v2 截断决策冻结（C1）

**Covers:** [S3-P0-3]

**Files:**
- Modify: `src/gyccode/session/message-v2.ts`
- Test: `src/gyccode/session/message-v2.cache.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/gyccode/session/message-v2.cache.test.ts`。需要构造 parts。由于 `aggregateToolCaps` 未导出，先测试导出后的行为；若不便导出，则通过 `toModelMessages`（导出函数，line 450）测字节级稳定。

采用导出 `aggregateToolCaps` 的方式（最小改动，纯函数）便于单测：

```ts
import { expect, test } from "bun:test"
import { aggregateToolCaps } from "./message-v2"

function toolPart(callID: string, output: string) {
  return {
    type: "tool",
    callID,
    tool: "bash",
    state: { status: "completed", input: {}, output, title: "t", metadata: {}, time: { start: 0, end: 1 } },
  } as any
}

test("aggregateToolCaps returns undefined when under budget", () => {
  const parts = [toolPart("c1", "small output")]
  expect(aggregateToolCaps(parts as any)).toBeUndefined()
})

test("aggregateToolCaps truncates the largest output over budget", () => {
  const big = "x".repeat(80_000)
  const small = "y".repeat(30_000)
  const parts = [toolPart("c1", small), toolPart("c2", big)]
  const caps = aggregateToolCaps(parts as any)
  expect(caps).toBeDefined()
  // total = 110_000 > 100_000; big one must be truncated to ~keep
  const keep = caps!.get("c2")!
  expect(keep).toBeGreaterThanOrEqual(1_024)
  expect(keep).toBeLessThan(80_000)
  // small one stays intact
  expect(caps!.get("c1")).toBe(30_000)
})

test("aggregateToolCaps is deterministic across repeated calls", () => {
  const parts = [toolPart("c1", "y".repeat(30_000)), toolPart("c2", "x".repeat(80_000))]
  const a = aggregateToolCaps(parts as any)
  const b = aggregateToolCaps(parts as any)
  expect(a).toEqual(b)
})

test("aggregateToolCaps freezes decisions: same callID keeps same keep after re-order", () => {
  // First call decides c2 (big) gets truncated.
  const p1 = [toolPart("c1", "y".repeat(30_000)), toolPart("c2", "x".repeat(80_000))]
  const caps1 = aggregateToolCaps(p1 as any)
  const keep2 = caps1!.get("c2")!
  // Second call with the same parts must freeze c2's decision.
  const p2 = [toolPart("c2", "x".repeat(80_000)), toolPart("c1", "y".repeat(30_000))]
  const caps2 = aggregateToolCaps(p2 as any)
  expect(caps2!.get("c2")).toBe(keep2)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/gyccode/session/message-v2.cache.test.ts`
Expected: FAIL — `aggregateToolCaps` not exported (TS/import error)

- [ ] **Step 3: 实现**

在 `src/gyccode/session/message-v2.ts`：

1. 导出 `aggregateToolCaps`（去掉 `function` 前的私有性，加 `export`）。
2. 引入模块级冻结决策缓存：

```ts
/** Frozen truncation decisions keyed by tool callID: once decided, never changed. */
const truncationDecisions = new Map<string, number>()
/** Reset frozen decisions (used by tests). */
export function resetTruncationDecisions(): void {
  truncationDecisions.clear()
}
```

3. 修改 `aggregateToolCaps`：先对已完成且未 compacted 的 tool parts 计算当前长度；若 total 超限，按从大到小截断，但**已冻结的 callID 用其冻结 keep 值且不参与削减**；未冻结的首次截断后写入 `truncationDecisions`。

```ts
function aggregateToolCaps(parts: readonly SessionV1.Part[]) {
  const caps = new Map<string, number>()
  type Entry = { callID: string; length: number; frozen: boolean }
  const entries: Entry[] = []
  let total = 0
  for (const part of parts) {
    if (part.type !== "tool") continue
    if (part.state.status !== "completed" || part.state.time.compacted) continue
    const text = part.state.output
    const frozenKeep = truncationDecisions.get(part.callID)
    const length = frozenKeep !== undefined ? frozenKeep : text.length
    caps.set(part.callID, length)
    total += length
    entries.push({ callID: part.callID, length, frozen: frozenKeep !== undefined })
  }
  if (total <= MAX_AGGREGATED_TOOL_CHARS) return undefined
  let excess = total - MAX_AGGREGATED_TOOL_CHARS
  // Stable deterministic order: ascending callID.
  entries.sort((a, b) => (a.callID < b.callID ? -1 : a.callID > b.callID ? 1 : 0))
  for (const entry of entries) {
    if (excess <= 0) break
    if (entry.frozen) continue // frozen decisions never change
    if (entry.length <= MIN_AGGREGATED_TOOL_KEEP_CHARS) continue
    const keep = Math.max(MIN_AGGREGATED_TOOL_KEEP_CHARS, entry.length - excess)
    if (keep >= entry.length) continue
    caps.set(entry.callID, keep)
    truncationDecisions.set(entry.callID, keep)
    excess -= entry.length - keep
  }
  return caps
}
```

注意：`aggregateToolCaps` 原签名接收 `readonly SessionV1.Part[]`，导出即可。测试用 `as any` 构造 part。

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/gyccode/session/message-v2.cache.test.ts`
Expected: PASS (4 tests)

- [ ] **Step 5: 类型检查 + 回归**

Run: `bun tsc --noEmit`
Run: `bun test src/gyccode/session/message-v2.cache.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/gyccode/session/message-v2.ts src/gyccode/session/message-v2.cache.test.ts
git commit -m "feat(session): freeze tool-result truncation decisions for prompt-cache stability"
```

---

### Task 7: 记忆提取 runner 模块（S4 核心）

**Covers:** [S3-P0-1]

**Files:**
- Create: `src/gyccode/memory/extraction-runner.ts`
- Test: `src/gyccode/memory/extraction-runner.test.ts`

- [ ] **Step 1: 写失败测试**

新建 `src/gyccode/memory/extraction-runner.test.ts`：

```ts
import { expect, test } from "bun:test"
import { Effect } from "effect"
import { runExtraction, type Extractor, type MemorySink } from "./extraction-runner"
import type { HermesMemoryEntry } from "./hermes-bridge"

test("runExtraction extracts, dedupes, and persists new memories", async () => {
  const existing: HermesMemoryEntry[] = [
    { key: "memory_0", value: "User prefers TypeScript.", tags: [] },
  ]
  const extractor: Extractor = () => Effect.succeed(["User prefers TypeScript.", "The project uses bun."])
  const persisted: string[] = []
  const sink: MemorySink = (memories) => {
    persisted.push(...memories)
    return Effect.succeed(memories.length)
  }

  const result = await Effect.runPromise(
    runExtraction({ extractor, sink, existing, conversation: "hello", config: { minTurns: 3, model: "x", maxMemories: 5 } }),
  )

  // Duplicate "User prefers TypeScript." must be filtered; only new one persisted.
  expect(persisted).toEqual(["The project uses bun."])
  expect(result).toEqual(["The project uses bun."])
})

test("runExtraction returns empty when extractor yields nothing new", async () => {
  const extractor: Extractor = () => Effect.succeed([])
  const persisted: string[] = []
  const sink: MemorySink = (memories) => {
    persisted.push(...memories)
    return Effect.succeed(memories.length)
  }
  const result = await Effect.runPromise(
    runExtraction({ extractor, sink, existing: [], conversation: "hi", config: { minTurns: 3, model: "x", maxMemories: 5 } }),
  )
  expect(persisted).toEqual([])
  expect(result).toEqual([])
})

test("runExtraction caps persisted memories to maxMemories", async () => {
  const extractor: Extractor = () => Effect.succeed(["a", "b", "c", "d", "e", "f"])
  const persisted: string[] = []
  const sink: MemorySink = (memories) => {
    persisted.push(...memories)
    return Effect.succeed(memories.length)
  }
  await Effect.runPromise(
    runExtraction({ extractor, sink, existing: [], conversation: "hi", config: { minTurns: 3, model: "x", maxMemories: 3 } }),
  )
  expect(persisted).toHaveLength(3)
})
```

- [ ] **Step 2: 运行测试确认失败**

Run: `bun test src/gyccode/memory/extraction-runner.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: 实现**

新建 `src/gyccode/memory/extraction-runner.ts`：

```ts
import { Effect } from "effect"
import type { HermesMemoryEntry } from "./hermes-bridge"
import { deduplicateMemories } from "./extract"

export interface ExtractionConfig {
  minTurns: number
  model: string
  maxMemories: number
}

export interface ExtractionInput {
  readonly conversation: string
  readonly existing: readonly HermesMemoryEntry[]
  readonly config: ExtractionConfig
}

/** Injected: turns a conversation into candidate memory lines (LLM call). */
export type Extractor = (input: ExtractionInput) => Effect.Effect<string[]>

/** Injected: persists new memories to durable storage. */
export type MemorySink = (memories: readonly string[]) => Effect.Effect<number>

export interface RunOptions {
  readonly extractor: Extractor
  readonly sink: MemorySink
  readonly existing: readonly HermesMemoryEntry[]
  readonly conversation: string
  readonly config: ExtractionConfig
}

/**
 * Run one memory-extraction step: ask the extractor for candidate memories,
 * filter out ones already present (case-insensitive substring), cap to
 * maxMemories, then persist. Pure wrapper — all I/O is injected.
 */
export function runExtraction(options: RunOptions): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const candidates = yield* options.extractor({
      conversation: options.conversation,
      existing: options.existing,
      config: options.config,
    })
    const fresh = candidates.filter((candidate) => deduplicateMemories(options.existing, candidate))
    const capped = fresh.slice(0, options.config.maxMemories)
    if (capped.length > 0) {
      yield* options.sink(capped)
    }
    return capped
  })
}

/** Default sink: persist into the hermes memory file. */
export const hermesMemorySink: MemorySink = (memories) =>
  Effect.promise(async () => {
    const { writeHermesMemoryFile } = await import("./hermes-bridge")
    let count = 0
    for (const content of memories) {
      await writeHermesMemoryFile({ key: `extract_${Date.now()}_${count}`, value: content + "\n" }, true)
      count++
    }
    return count
  })
```

- [ ] **Step 4: 运行测试确认通过**

Run: `bun test src/gyccode/memory/extraction-runner.test.ts`
Expected: PASS (3 tests)

- [ ] **Step 5: 提交**

```bash
git add src/gyccode/memory/extraction-runner.ts src/gyccode/memory/extraction-runner.test.ts
git commit -m "feat(memory): add injectable extraction runner with dedup + cap"
```

---

### Task 8: 记忆提取接线到 runLoop + 配置（S4 接线）

**Covers:** [S3-P0-1]

**Files:**
- Modify: `src/core/v1/config/config.ts`
- Modify: `src/gyccode/session/prompt.ts`

- [ ] **Step 1: config 新增 memory.extraction 字段**

在 `src/core/v1/config/config.ts` 的 `Info` schema 中（`compaction` 字段后）新增：

```ts
memory: Schema.optional(
  Schema.Struct({
    extraction: Schema.optional(
      Schema.Struct({
        enabled: Schema.optional(Schema.Boolean).annotate({
          description: "Enable automatic cross-session memory extraction (default: true)",
        }),
        min_turns: Schema.optional(NonNegativeInt).annotate({
          description: "Extract memories every N turns (default: 3)",
        }),
        model: Schema.optional(Schema.String).annotate({
          description: "Model to use for extraction, e.g. deepseek/deepseek-chat (default: provider small model)",
        }),
        max_memories: Schema.optional(NonNegativeInt).annotate({
          description: "Maximum memories to persist per extraction (default: 5)",
        }),
      }),
    ),
  }),
).annotate({
  description: "Cross-session memory configuration",
}),
```

- [ ] **Step 2: prompt.ts 接线**

在 `src/gyccode/session/prompt.ts` runLoop 的 `step++` 后（title 异步生成之后）插入提取触发：

```ts
// P0-1: automatic cross-session memory extraction every N turns (async, non-blocking).
const memoryCfg = config.memory?.extraction
if (memoryCfg?.enabled !== false && step % (memoryCfg?.min_turns ?? 3) === 0) {
  yield* Effect.gen(function* () {
    const recent = msgs
      .filter((m) => m.info.role === "user")
      .flatMap((m) => m.parts)
      .filter((p): p is SessionV1.TextPart => p.type === "text")
      .map((p) => p.text)
      .join(" ")
      .slice(-2000)
    if (!recent.trim()) return
    const existing = yield* Effect.promise(() => readHermesMemories())
    const extractor: Extractor = ({ conversation, existing: ex, config: cfg }) =>
      Effect.gen(function* () {
        const mdl = cfg.model
          ? yield* getModel(...) // providerID/modelID parse from cfg.model
          : (yield* provider.getSmallModel(lastUser.model.providerID)) ?? (yield* getModel(lastUser.model.providerID, lastUser.model.modelID, sessionID))
        const ag = yield* agents.get("summary") // summary agent: native, hidden, no tools
        if (!ag) return [] as string[]
        const text = yield* llm
          .stream({
            agent: ag,
            user: lastUser,
            system: [],
            small: true,
            tools: {},
            model: mdl,
            sessionID,
            retries: 2,
            messages: [{ role: "user", content: formatExtractionPrompt(conversation, ex) }],
          })
          .pipe(
            Stream.filter(LLMEvent.is.textDelta),
            Stream.map((e) => e.text),
            Stream.mkString,
            Effect.orDie,
          )
        return parseExtractionResult(text)
      })
    const result = yield* runExtraction({
      extractor,
      sink: hermesMemorySink,
      existing,
      conversation: recent,
      config: {
        minTurns: memoryCfg?.min_turns ?? 3,
        model: memoryCfg?.model ?? "",
        maxMemories: memoryCfg?.max_memories ?? 5,
      },
    })
    yield* Effect.logInfo("memory extraction complete", { "session.id": sessionID, count: result.length })
  }).pipe(Effect.ignore, Effect.forkIn(scope))
}
```

导入：`readHermesMemories`（hermes-bridge）、`formatExtractionPrompt`/`parseExtractionResult`（extract）、`runExtraction`/`hermesMemorySink`/`type Extractor`（extraction-runner）。注意 prompt.ts 的 `getModel` 是局部函数（`getModel(providerID, modelID, sessionID)`），提取处复用。

- [ ] **Step 3: 类型检查**

Run: `bun tsc --noEmit`
Expected: PASS（若 getModel 局部签名不匹配，调整解析 cfg.model 的方式——拆 providerID/modelID）

- [ ] **Step 4: 相关测试**

Run: `bun test src/gyccode/memory/extraction-runner.test.ts`
Run: `bun test src/gyccode/benchmark/benchmark.test.ts`
Expected: PASS

- [ ] **Step 5: 提交**

```bash
git add src/core/v1/config/config.ts src/gyccode/session/prompt.ts
git commit -m "feat(session): wire automatic memory extraction into runLoop"
```

---

### Task 9: P0 整体验证

**Covers:** [S6]

- [ ] **Step 1: 全量测试**

Run: `bun test --timeout 60000`
Expected: 全部通过（重点看 read-cache / token-budget / extraction-runner / message-v2.cache）

- [ ] **Step 2: 类型检查**

Run: `bun tsc --noEmit`
Expected: PASS

- [ ] **Step 3: 回归（不触碰未提交的 19 个遗留文件）**

确认 `git status` 中本次改动只涉及计划列出的文件。

- [ ] **Step 4: 完成 P0**

更新 spec 状态：P0-1/P0-2/P0-3/P0-4 完成，进入 P1。

