# 模型能力层 6 项差距补齐 Implementation Plan
> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../reports/model-capability-gaps-closure.md)

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐 5 指标复评确认的 6 项差距（1.2/1.3/1.4/2.3/5.3/5.4），每项超越 Claude 对应实现。

**Architecture:** 独立模块 + 纯函数/Effect Service + config 下沉 + TDD。tokenizer 为纯函数库；rules 为纯函数解析+匹配；time-based 与 api_context_management 在现有 compaction/request 接线；config schema 统一新增。

**Tech Stack:** Bun + TypeScript + Effect v4；测试用 `bun:test`；规则 globs 用 `picomatch`（仓库已有）；frontmatter 解析手写（避免新依赖）。

**Spec:** `docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md`

---

## 文件结构

- `src/core/util/tokenizer.ts` — 新建，本地 BPE 近似 token 化（纯函数）
- `src/core/util/token.ts` — 修改，estimate 改用 tokenizer；新增 estimateWithAPI
- `src/gyccode/session/llm/context-1m.ts` — 修改，[1m] 后缀 + effectiveContextWindow
- `src/gyccode/session/overflow.ts` — 修改，usable 用 effectiveContextWindow
- `src/gyccode/provider/transform.ts` — 修改，maxOutputTokens 可配上限 + escalate 上限
- `src/gyccode/session/prompt.ts` — 修改，escalate 读 config
- `src/gyccode/session/rules.ts` — 新建，条件规则解析/匹配
- `src/gyccode/session/instruction.ts` — 修改，rules 接线（system + 就近）
- `src/gyccode/session/microcompact-select.ts` — 修改，selectTimeBasedParts
- `src/gyccode/session/compaction.ts` — 修改，time-based 联动 + api_context_management 读取
- `src/gyccode/session/llm/request.ts` — 修改，context-management 头 + 参数
- `src/core/v1/config/config.ts` — 修改，新增配置 schema
- 各模块对应 `*.test.ts`

---

### Task 1: 新增 config schema（token_counting / llm.output / compaction.time_based_microcompact / compaction.api_context_management）

**Covers:** [S3, S4, S5, S7, S8]

**Files:**
- Modify: `src/core/v1/config/config.ts`

- [ ] **Step 1: 在 config.ts 的 compaction Struct 中追加两个子结构**

在 `src/core/v1/config/config.ts` 的 `compaction` Struct 内（`reserved` 字段之后）追加：

```ts
      time_based_microcompact: Schema.optional(
        Schema.Struct({
          enabled: Schema.optional(Schema.Boolean).annotate({
            description: "Enable time-based micro-compaction when a long idle gap expires the prompt cache (default: false)",
          }),
          gap_minutes: Schema.optional(NonNegativeInt).annotate({
            description: "Idle gap in minutes that triggers time-based micro-compaction (default: 60)",
          }),
          keep_recent: Schema.optional(NonNegativeInt).annotate({
            description: "Most recent tool results to keep when time-based micro-compaction fires (default: 5)",
          }),
        }),
      ),
      api_context_management: Schema.optional(
        Schema.Struct({
          enabled: Schema.optional(Schema.Boolean).annotate({
            description: "Enable Anthropic API-native context management (context-management beta) (default: false)",
          }),
          trigger_threshold: Schema.optional(NonNegativeInt).annotate({
            description: "Input token threshold that triggers API-side clearing (default: 180000)",
          }),
          keep_target: Schema.optional(NonNegativeInt).annotate({
            description: "Target input tokens to keep after API-side clearing (default: 40000)",
          }),
          clear_thinking: Schema.optional(Schema.Boolean).annotate({
            description: "Clear old thinking blocks via API (default: true)",
          }),
          clear_tool_uses: Schema.optional(Schema.Boolean).annotate({
            description: "Clear old tool uses via API (default: false)",
          }),
          thinking_turns: Schema.optional(NonNegativeInt).annotate({
            description: "Thinking turns to keep when clearing thinking blocks (default: 1)",
          }),
        }),
      ),
```

- [ ] **Step 2: 在 config 顶层追加 token_counting 与 llm Struct**

在 `compaction` 字段之后（`memory` 之前或之后均可）追加：

```ts
  token_counting: Schema.optional(
    Schema.Struct({
      mode: Schema.optional(Schema.Literal("local", "api", "auto")).annotate({
        description: "Token counting mode: local (default, zero-cost), api (Anthropic countTokens), auto (api with local fallback)",
      }),
      api_model: Schema.optional(Schema.String).annotate({
        description: "Model id used for API token counting, e.g. anthropic/claude-haiku-4-5 (default: provider small model)",
      }),
    }),
  ),
  llm: Schema.optional(
    Schema.Struct({
      output_token_max: Schema.optional(NonNegativeInt).annotate({
        description: "Maximum output tokens per request (default: 32000)",
      }),
      escalate_output_token_max: Schema.optional(NonNegativeInt).annotate({
        description: "Output token cap after a finish=length escalation (default: 64000)",
      }),
    }),
  ),
```

- [ ] **Step 3: 运行类型检查**

Run: `bun tsc --noEmit`
Expected: exit 0（config schema 是可选字段，不破坏既有结构）

- [ ] **Step 4: Commit**

```bash
git add src/core/v1/config/config.ts
git commit -m "feat(config): add token_counting, llm.output caps, time-based MC and api context management schemas"
```

---

### Task 2: 1.3 本地精确 tokenizer（tokenize + estimate 兼容）

**Covers:** [S4]

**Files:**
- Create: `src/core/util/tokenizer.ts`
- Test: `src/core/util/tokenizer.test.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/core/util/tokenizer.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { tokenize } from "./tokenizer"

describe("tokenize", () => {
  it("splits ASCII prose into word-ish tokens", () => {
    const tokens = tokenize("hello world this is a test")
    expect(tokens.length).toBeGreaterThanOrEqual(6)
    expect(tokens.length).toBeLessThanOrEqual(8)
    expect(tokens).toContain("hello")
  })

  it("counts each CJK char as one token", () => {
    const tokens = tokenize("你好世界")
    expect(tokens.length).toBe(4)
  })

  it("counts code symbols individually", () => {
    const tokens = tokenize("foo(bar);")
    // foo, (, bar, ), ;  → 5 (no space between)
    expect(tokens.length).toBe(5)
  })

  it("treats JSON punctuation densely", () => {
    const tokens = tokenize('{"a":1}')
    expect(tokens.length).toBeGreaterThanOrEqual(6)
  })

  it("returns empty array for empty input", () => {
    expect(tokenize("")).toEqual([])
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./src/core/util/tokenizer.test.ts`
Expected: FAIL "Cannot find module './tokenizer'"

- [ ] **Step 3: 写最小实现**

创建 `src/core/util/tokenizer.ts`：

```ts
/**
 * Local BPE-approximation tokenizer. No network, no dependency — a fast,
 * deterministic token counter that is far more accurate than char/4 heuristics
 * for CJK (1 token per Han char) and code (symbols tokenize individually).
 * ASCII runs cluster into word-ish tokens; unknown content degrades gracefully.
 */

const CJK_RE = /[\u4e00-\u9fff\u3400-\u4dbf\u3000-\u303f\uff00-\uffef]/
const ASCII_WORD_RE = /[A-Za-z0-9_]+/
const SYMBOL_RE = /[{}[\]();:,.<>~`!@#$%^&*+=\\-_/?'"]/

export function tokenize(input: string): string[] {
  if (!input) return []
  const tokens: string[] = []
  let i = 0
  const n = input.length
  while (i < n) {
    const ch = input[i]!
    if (CJK_RE.test(ch)) {
      tokens.push(ch)
      i++
      continue
    }
    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      // collapse whitespace into a single token
      while (i < n && /\s/.test(input[i]!)) i++
      tokens.push(" ")
      continue
    }
    // ASCII word run
    const wordMatch = input.slice(i).match(/^[A-Za-z0-9_]+/)
    if (wordMatch) {
      tokens.push(wordMatch[0])
      i += wordMatch[0].length
      continue
    }
    // single symbol (each symbol is its own token)
    if (SYMBOL_RE.test(ch)) {
      tokens.push(ch)
      i++
      continue
    }
    // fallback: one char per token
    tokens.push(ch)
    i++
  }
  return tokens
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test ./src/core/util/tokenizer.test.ts`
Expected: 5 pass / 0 fail

- [ ] **Step 5: Commit**

```bash
git add src/core/util/tokenizer.ts src/core/util/tokenizer.test.ts
git commit -m "feat(core): add local BPE-approximation tokenizer"
```
---

### Task 3: 1.3 token.estimate 改用 tokenizer + estimateWithAPI

**Covers:** [S4]

**Files:**
- Modify: `src/core/util/token.ts`
- Test: `src/core/util/token.test.ts`

- [ ] **Step 1: 追加测试**

在 `src/core/util/token.test.ts` 末尾追加（先读该文件了解现有结构，保留既有用例）：

```ts
import { estimateWithAPI } from "./token"

describe("estimateWithAPI", () => {
  it("falls back to local estimate when the API call throws", async () => {
    const api = {
      countTokens: async () => {
        throw new Error("network down")
      },
    } as any
    const result = await estimateWithAPI("你好世界", { api, model: "anthropic/claude-haiku-4-5" })
    expect(result).toBe(4) // local tokenize count
  })

  it("returns the API count when it succeeds", async () => {
    const api = {
      countTokens: async () => 123,
    } as any
    const result = await estimateWithAPI("some text", { api, model: "anthropic/claude-haiku-4-5" })
    expect(result).toBe(123)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./src/core/util/token.test.ts`
Expected: FAIL "Cannot find name 'estimateWithAPI'"

- [ ] **Step 3: 实现**

修改 `src/core/util/token.ts`：

- 顶部 import：`import { tokenize } from "./tokenizer"`
- `estimate` 改为：

```ts
export const estimate = (input: string) => {
  if (!input) return 0
  return tokenize(input).length
}
```

- 保留 `format` 不变。
- 追加 `estimateWithAPI`：

```ts
/**
 * Estimate token count, optionally via an injected API token counter
 * (`config.token_counting.mode` = "api" | "auto"). Any failure falls back to
 * the local tokenizer — the caller always gets a number.
 */
export async function estimateWithAPI(
  input: string,
  opts: { api?: { countTokens: (text: string) => Promise<number> }; model?: string },
): Promise<number> {
  if (opts.api && opts.model) {
    try {
      const n = await opts.api.countTokens(input)
      if (typeof n === "number" && Number.isFinite(n) && n >= 0) return n
    } catch {
      // fall through to local
    }
  }
  return estimate(input)
}
```

- [ ] **Step 4: 运行确认通过（含既有 estimate 用例）**

Run: `bun test ./src/core/util/token.test.ts`
Expected: 全部通过（estimate 现有用例：中文/代码/JSON 断言需适配 tokenizer 计数——若现有断言基于旧启发式值，更新为 tokenize 精确值）

- [ ] **Step 5: 全量回归 token 相关**

Run: `bun test ./src/core/util/token.test.ts ./src/gyccode/session/compaction.test.ts 2>&1 | Select-Object -Last 5`
Expected: 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/core/util/token.ts src/core/util/token.test.ts
git commit -m "feat(core): route Token.estimate through local tokenizer, add estimateWithAPI fallback"
```

---

### Task 4: 1.2 `[1m]` 后缀 + effectiveContextWindow

**Covers:** [S3]

**Files:**
- Modify: `src/gyccode/session/llm/context-1m.ts`
- Test: `src/gyccode/session/llm/context1m.test.ts`
- Modify: `src/gyccode/session/overflow.ts`

- [ ] **Step 1: 追加测试**

在 `src/gyccode/session/llm/context1m.test.ts` 末尾追加：

```ts
import { parse1mSuffix, effectiveContextWindow } from "./context-1m"

describe("parse1mSuffix", () => {
  it("detects [1m] suffix case-insensitively", () => {
    expect(parse1mSuffix("claude-sonnet-4-6[1m]")).toBe(true)
    expect(parse1mSuffix("claude-sonnet-4-6[1M]")).toBe(true)
  })
  it("rejects models without the suffix", () => {
    expect(parse1mSuffix("claude-sonnet-4-6")).toBe(false)
  })
})

describe("effectiveContextWindow", () => {
  it("returns the env cap when set", () => {
    expect(effectiveContextWindow({ context: 1_000_000 }, { GYCCODE_MAX_CONTEXT_TOKENS: "500000" })).toBe(500000)
  })
  it("returns model context when no env cap", () => {
    expect(effectiveContextWindow({ context: 200_000 }, {})).toBe(200_000)
  })
  it("ignores invalid env values", () => {
    expect(effectiveContextWindow({ context: 200_000 }, { GYCCODE_MAX_CONTEXT_TOKENS: "abc" })).toBe(200_000)
  })
  it("falls back to 200k when context missing", () => {
    expect(effectiveContextWindow({}, {})).toBe(200_000)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./src/gyccode/session/llm/context1m.test.ts`
Expected: FAIL "Cannot find name 'parse1mSuffix'"

- [ ] **Step 3: 实现**

在 `src/gyccode/session/llm/context-1m.ts` 追加：

```ts
/** True when the model id carries an explicit `[1m]` opt-in suffix (case-insensitive). */
export function parse1mSuffix(modelId: string): boolean {
  return /\[1m\]/i.test(modelId)
}

const DEFAULT_CONTEXT_WINDOW = 200_000

/**
 * Effective context window for local decisions (compaction, overflow).
 * `GYCCODE_MAX_CONTEXT_TOKENS` caps the window universally (Claude's
 * equivalent is ant-only); invalid values are ignored.
 */
export function effectiveContextWindow(
  model: { context?: number },
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env.GYCCODE_MAX_CONTEXT_TOKENS
  if (raw) {
    const parsed = Number.parseInt(raw, 10)
    if (Number.isFinite(parsed) && parsed > 0) return parsed
  }
  return model.context ?? DEFAULT_CONTEXT_WINDOW
}
```

并将 `context1MHeader` 的判定扩展为「context≥1M **或** id 带 `[1m]`」：

```ts
  const context = model.limit?.context ?? 0
  const suffix1M = parse1mSuffix(model.api.id) || parse1mSuffix(model.id ?? "")
  if (context < CONTEXT_1M_THRESHOLD && !suffix1M) return undefined
```

（注意：`Provider.Model` 有 `id` 字段；若类型里 `model.id` 不存在，用 `model.api.id` 即可，测试按实际类型适配。）

- [ ] **Step 4: 接线 overflow.ts 的 usable**

修改 `src/gyccode/session/overflow.ts`：

```ts
import { effectiveContextWindow } from "./llm/context-1m"
```

将 `usable` 中的 `const context = input.model.limit.context` 改为：

```ts
  const context = effectiveContextWindow(input.model.limit)
```

- [ ] **Step 5: 运行确认通过 + 回归**

Run: `bun test ./src/gyccode/session/llm/context1m.test.ts ./src/gyccode/session/compaction.test.ts 2>&1 | Select-Object -Last 5`
Expected: 0 fail

- [ ] **Step 6: Commit**

```bash
git add src/gyccode/session/llm/context-1m.ts src/gyccode/session/llm/context1m.test.ts src/gyccode/session/overflow.ts
git commit -m "feat(session): support [1m] suffix opt-in and universal GYCCODE_MAX_CONTEXT_TOKENS window cap"
```

---

### Task 5: 1.4 maxOutputTokens 模型驱动 + 可配上限

**Covers:** [S5]

**Files:**
- Modify: `src/gyccode/provider/transform.ts`
- Modify: `src/gyccode/session/prompt.ts`
- Test: `src/gyccode/session/llm/request.test.ts`（resolveMaxOutputTokens 现有用例）

- [ ] **Step 1: 更新 resolveMaxOutputTokens 测试**

在 `src/gyccode/session/llm/request.test.ts` 的 `resolveMaxOutputTokens` describe 中追加：

```ts
  it("escalates to min(model output, escalate cap)", () => {
    const bigModel = { limit: { output: 128_000 } } as any
    // override 64000 is the escalated cap; result stays 64000 (min with 128k)
    expect(resolveMaxOutputTokens(bigModel, 32_000, 64_000)).toBe(64_000)
  })
```

- [ ] **Step 2: 运行确认现状通过（此用例当前已通过——作为行为回归锚点）**

Run: `bun test ./src/gyccode/session/llm/request.test.ts`
Expected: 全通过

- [ ] **Step 3: 实现 config 驱动**

修改 `src/gyccode/provider/transform.ts` 的 `maxOutputTokens`：

```ts
export function maxOutputTokens(
  model: Provider.Model,
  outputTokenMax: number | undefined = OUTPUT_TOKEN_MAX,
): number {
  const cap = outputTokenMax ?? OUTPUT_TOKEN_MAX
  return Math.min(model.limit.output, cap) || cap
}
```

（保持签名兼容：`undefined` 时仍默认 32K。）

- [ ] **Step 4: 接线 prompt.ts escalate 读 config**

修改 `src/gyccode/session/prompt.ts` line 1184 附近的 escalate：

```ts
if (escalatedOutputMax === undefined) {
  const cfg = yield* Config.Service // 若已注入则复用
  const cfgInfo = yield* cfg.get()
  escalatedOutputMax = Math.min(
    lastAssistant.model?.limit.output ?? 64_000,
    cfgInfo.llm?.escalate_output_token_max ?? 64_000,
  )
}
```

（若 `prompt.ts` 尚未注入 `Config.Service`，在 runLoop 顶部 `yield* Config.Service` 一次；参考 line 157 `const compaction = yield* SessionCompaction.Service` 的模式。）

- [ ] **Step 5: 运行确认通过 + tsc**

Run: `bun test ./src/gyccode/session/llm/request.test.ts 2>&1 | Select-Object -Last 5; bun tsc --noEmit`
Expected: 0 fail, tsc exit 0

- [ ] **Step 6: Commit**

```bash
git add src/gyccode/provider/transform.ts src/gyccode/session/prompt.ts src/gyccode/session/llm/request.test.ts
git commit -m "feat(session): model-driven maxOutputTokens with configurable caps and escalate ceiling"
```

---

### Task 6: 2.3 条件规则（解析 + globs/language/os 匹配 + system/就近注入）

**Covers:** [S6]

**Files:**
- Create: `src/gyccode/session/rules.ts`
- Test: `src/gyccode/session/rules.test.ts`
- Modify: `src/gyccode/session/instruction.ts`

- [ ] **Step 1: 写失败测试**

创建 `src/gyccode/session/rules.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { parseRuleFrontmatter, matchRules } from "./rules"

const RULE_WITH_GLOBS = `---
globs:
  - "src/**/*.ts"
condition:
  language: zh
---
Always use Effect for all effects in src.`

const RULE_UNCONDITIONAL = `---
globs: ["docs/**"]
---
Docs must stay in Chinese.`

const RULE_NO_FRONTMATTER = `Plain rule text without frontmatter.`

describe("parseRuleFrontmatter", () => {
  it("parses globs array and condition", () => {
    const r = parseRuleFrontmatter(RULE_WITH_GLOBS)
    expect(r?.globs).toEqual(["src/**/*.ts"])
    expect(r?.condition).toEqual({ language: "zh" })
    expect(r?.body).toContain("Always use Effect")
  })
  it("parses single-line globs array", () => {
    const r = parseRuleFrontmatter(RULE_UNCONDITIONAL)
    expect(r?.globs).toEqual(["docs/**"])
  })
  it("returns undefined for no frontmatter", () => {
    expect(parseRuleFrontmatter(RULE_NO_FRONTMATTER)).toBeUndefined()
  })
})

describe("matchRules", () => {
  const ruleZh = { filepath: "rules/zh.md", globs: ["src/**/*.ts"], condition: { language: "zh" }, body: "zh rule" }
  const ruleAll = { filepath: "rules/all.md", globs: ["src/**/*.ts"], body: "all rule" }

  it("matches globs for a target file", () => {
    const m = matchRules([ruleZh, ruleAll], { filepath: "src/app.ts", language: "zh", os: "win32" })
    expect(m.map((r) => r.filepath)).toContain("rules/zh.md")
    expect(m.map((r) => r.filepath)).toContain("rules/all.md")
  })
  it("does not match when globs miss", () => {
    const m = matchRules([ruleZh], { filepath: "docs/guide.md", language: "zh", os: "win32" })
    expect(m).toEqual([])
  })
  it("filters by language condition", () => {
    const m = matchRules([ruleZh], { filepath: "src/app.ts", language: "en", os: "win32" })
    expect(m).toEqual([])
  })
  it("matches unconditioned rules regardless of language", () => {
    const m = matchRules([ruleAll], { filepath: "src/app.ts", language: "en", os: "win32" })
    expect(m.map((r) => r.filepath)).toContain("rules/all.md")
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./src/gyccode/session/rules.test.ts`
Expected: FAIL "Cannot find module './rules'"

- [ ] **Step 3: 写最小实现**

创建 `src/gyccode/session/rules.ts`：

```ts
/**
 * Conditional rule files (`.claude/rules/*.md`, project `rules/`). A rule is a
 * markdown file with optional YAML frontmatter:
 *
 *   ---
 *   globs: ["src/**/*.ts"]        # file-path patterns the rule applies to
 *   condition:                    # optional additional conditions
 *     language: zh                # zh | en
 *     os: win32                   # win32 | darwin | linux
 *   ---
 *
 * A rule with no frontmatter applies everywhere. Matched rules are injected
 * into the system prompt and, for a concrete file, nearby its read/edit
 * context — beyond Claude Code's system-level-only globs rules.
 */

export interface Rule {
  filepath: string
  globs?: string[]
  condition?: { language?: string; os?: string }
  body: string
}

/** Extract YAML frontmatter fields we care about. Minimal parser, no deps. */
export function parseRuleFrontmatter(
  content: string,
): { globs?: string[]; condition?: { language?: string; os?: string }; body: string } | undefined {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return undefined
  const fm = m[1]!
  const body = content.slice(m[0].length)
  let globs: string[] | undefined
  let condition: { language?: string; os?: string } | undefined

  // globs: ["a/**", "b/**"]  |  globs: - "a"  |  globs: "single"
  const globsMatch = fm.match(/globs:\s*(\[[\s\S]*?\]|"[^"]*"|'[^']*')/m)
  if (globsMatch) {
    const raw = globsMatch[1]!
    if (raw.startsWith("[")) {
      globs = (raw.match(/["']([^"']+)["']/g) ?? []).map((s) => s.replace(/["']/g, ""))
    } else {
      globs = [raw.replace(/["']/g, "")]
    }
  } else {
    const listMatch = fm.match(/globs:\s*\n((?:\s*-\s*["']?[^"'\n]+["']?\n)+)/m)
    if (listMatch) {
      globs = (listMatch[1]!.match(/-\s*["']?([^"'\n]+)["']?/g) ?? []).map((s) => s.replace(/^-\s*["']?|["']?$/g, ""))
    }
  }

  const langMatch = fm.match(/language:\s*["']?([A-Za-z-]+)["']?/m)
  const osMatch = fm.match(/os:\s*["']?([A-Za-z0-9_-]+)["']?/m)
  if (langMatch || osMatch) {
    condition = {
      ...(langMatch ? { language: langMatch[1]!.toLowerCase() } : {}),
      ...(osMatch ? { os: osMatch[1]!.toLowerCase() } : {}),
    }
  }

  return { ...(globs ? { globs } : {}), ...(condition ? { condition } : {}), body: body.trim() }
}

/** Minimal glob-to-regex (supports `**`, `*`, `?`). */
export function globToRegExp(glob: string): RegExp {
  const escaped = glob
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "\u0000")
    .replace(/\*/g, "[^/]*")
    .replace(/\u0000/g, ".*")
    .replace(/\?/g, "[^/]")
  return new RegExp(`^${escaped}$`)
}

export interface MatchInput {
  filepath: string
  language?: string
  os?: string
}

/** Rules whose globs and conditions all match the input. */
export function matchRules(rules: readonly Rule[], input: MatchInput): Rule[] {
  const lang = input.language?.toLowerCase()
  const os = input.os?.toLowerCase()
  return rules.filter((rule) => {
    if (rule.globs && rule.globs.length > 0) {
      const hit = rule.globs.some((g) => globToRegExp(g).test(input.filepath))
      if (!hit) return false
    }
    if (rule.condition?.language && rule.condition.language !== lang) return false
    if (rule.condition?.os && rule.condition.os !== os) return false
    return true
  })
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test ./src/gyccode/session/rules.test.ts`
Expected: 全通过

- [ ] **Step 5: 接线 instruction.ts**

修改 `src/gyccode/session/instruction.ts`：

- import：`import { matchRules, parseRuleFrontmatter, type Rule } from "./rules"`
- 新增 `discoverRules` Effect（扫描 `.claude/rules/` + `rules/`）：

```ts
const discoverRules = Effect.fnUntraced(function* (dir: string) {
  const fs = yield* FSUtil.Service
  const candidates = [
    path.join(dir, ".claude", "rules"),
    path.join(dir, "rules"),
  ]
  const files: string[] = []
  for (const base of candidates) {
    const glob = yield* fs
      .glob("**/*.md", { cwd: base, absolute: true, include: "file" })
      .pipe(Effect.catch(() => Effect.succeed([])))
    files.push(...glob)
  }
  return files
})
```

（若 `FSUtil` 无 `glob`，用 `fs.readdir` 递归实现，或复用 `systemPaths` 中 `fs.globUp` 的现有模式；以实际 API 为准。）

- 在 `system()` 中，对项目根目录发现规则，解析 frontmatter 并 `matchRules`（无具体文件时用空 filepath 仅条件匹配），拼入 local 数组：

```ts
// inside system(), after local/remoteParts are built:
const ctx = yield* InstanceState.context
const ruleFiles = yield* discoverRules(ctx.directory)
const rules: Rule[] = []
for (const f of ruleFiles) {
  const text = yield* read(f)
  const parsed = parseRuleFrontmatter(text)
  if (parsed) rules.push({ filepath: f, globs: parsed.globs, condition: parsed.condition, body: parsed.body })
  else if (text.trim()) rules.push({ filepath: f, body: text.trim() })
}
const matched = matchRules(rules, { filepath: "", language: config.language })
for (const r of matched) {
  local.push(`Rules from: ${r.filepath}\n${r.body}`)
}
```

- 在 `resolve()` 中，对 `filepath` 匹配规则并追加到 results（就近注入）：

```ts
// inside resolve(), before `return results`:
const ctx = yield* InstanceState.context
const ruleFiles = yield* discoverRules(path.join(root, "..")) // project root from file
const rules: Rule[] = []
for (const f of ruleFiles) {
  const text = yield* read(f)
  const parsed = parseRuleFrontmatter(text)
  if (parsed) rules.push({ filepath: f, globs: parsed.globs, condition: parsed.condition, body: parsed.body })
  else if (text.trim()) rules.push({ filepath: f, body: text.trim() })
}
const matched = matchRules(rules, { filepath, language: config.language, os: process.platform })
for (const r of matched) {
  results.push({ filepath: r.filepath, content: `Rules from: ${r.filepath}\n${r.body}` })
}
```

（`config.language` 即 config.ts:90 的 `language` 字段；`os` 用 `process.platform`。）

- [ ] **Step 6: 运行确认 instruction 相关测试 + tsc**

Run: `bun test ./src/gyccode/session/rules.test.ts ./src/gyccode/session/instruction-includes.test.ts 2>&1 | Select-Object -Last 5; bun tsc --noEmit`
Expected: 0 fail, tsc exit 0

- [ ] **Step 7: Commit**

```bash
git add src/gyccode/session/rules.ts src/gyccode/session/rules.test.ts src/gyccode/session/instruction.ts
git commit -m "feat(session): conditional rules with globs+language+os matching, system and nearby injection"
```

---

### Task 7: 5.3 time-based microcompact（可配阈值 + 联动）

**Covers:** [S7]

**Files:**
- Modify: `src/gyccode/session/microcompact-select.ts`
- Test: `src/gyccode/session/microcompact-select.test.ts`
- Modify: `src/gyccode/session/compaction.ts`

- [ ] **Step 1: 追加测试**

在 `src/gyccode/session/microcompact-select.test.ts` 末尾追加：

```ts
import { selectTimeBasedParts } from "./microcompact-select"

function toolMsg(id: string, at: number, tool = "read") {
  return {
    info: { role: "assistant", id },
    parts: [
      { type: "tool", tool, state: { status: "completed", time: { completed: at } } } as any,
    ],
  }
}

describe("selectTimeBasedParts", () => {
  const now = Date.now()
  const old = now - 61 * 60 * 1000 // 61 min ago
  const recent = now - 60 * 1000 // 1 min ago

  it("clears middle tool outputs when gap exceeds threshold", () => {
    const msgs = [
      toolMsg("m0", old),
      toolMsg("m1", old),
      toolMsg("m2", recent),
    ]
    const selected = selectTimeBasedParts(msgs, { now, gapMinutes: 60, keepRecent: 1 })
    // m0 cleared; m2 is within keepRecent so preserved
    const idx = selected.map((s) => s._msgIndex)
    expect(idx).toContain(0)
    expect(idx).not.toContain(2)
  })

  it("returns empty when gap is within threshold", () => {
    const msgs = [toolMsg("m0", now - 30 * 60 * 1000)]
    expect(selectTimeBasedParts(msgs, { now, gapMinutes: 60, keepRecent: 1 })).toEqual([])
  })

  it("respects keepRecent and cache prefix", () => {
    const msgs = Array.from({ length: 15 }, (_, i) => toolMsg(`m${i}`, old))
    const selected = selectTimeBasedParts(msgs, { now, gapMinutes: 60, keepRecent: 3 })
    const idx = selected.map((s) => s._msgIndex)
    expect(idx).not.toContain(0) // cache prefix
    expect(idx).not.toContain(14) // keepRecent tail
    expect(idx.length).toBeGreaterThan(0)
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./src/gyccode/session/microcompact-select.test.ts`
Expected: FAIL "Cannot find name 'selectTimeBasedParts'"

- [ ] **Step 3: 写最小实现**

在 `src/gyccode/session/microcompact-select.ts` 追加：

```ts
/**
 * Time-based micro-compaction: when the gap since the last main-loop assistant
 * message exceeds `gapMinutes`, the server-side prompt cache has almost
 * certainly expired, so the full prefix will be rewritten anyway. Clearing old
 * tool results before the request shrinks what gets rewritten.
 * (Aligned with Claude Code timeBasedMCConfig, but locally configurable.)
 */
export function selectTimeBasedParts(
  msgs: readonly WithParts[],
  opts: { now?: number; gapMinutes: number; keepRecent: number },
): Array<SessionV1.ToolPart & { _msgIndex: number }> {
  const now = opts.now ?? Date.now()
  const gapMs = opts.gapMinutes * 60 * 1000
  // Find the last assistant message timestamp.
  let lastAt = 0
  for (const msg of msgs) {
    if (msg.info.role !== "assistant") continue
    for (const part of msg.parts) {
      if (part.type === "tool" && part.state.status === "completed" && part.state.time.completed) {
        lastAt = Math.max(lastAt, part.state.time.completed)
      }
    }
  }
  if (lastAt === 0 || now - lastAt < gapMs) return []
  if (msgs.length <= CACHE_PREFIX_KEEP + opts.keepRecent) return []

  const selected: Array<SessionV1.ToolPart & { _msgIndex: number }> = []
  for (let i = CACHE_PREFIX_KEEP; i < msgs.length - opts.keepRecent; i++) {
    const msg = msgs[i]
    for (const part of msg.parts) {
      if (part.type !== "tool") continue
      if (part.state.status !== "completed") continue
      if (part.state.time.compacted) continue
      if (PROTECTED_TOOLS.has(part.tool)) continue
      selected.push({ ...part, _msgIndex: i })
    }
  }
  return selected
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test ./src/gyccode/session/microcompact-select.test.ts`
Expected: 全通过

- [ ] **Step 5: 接线 compaction.ts 的 microcompactIfNeeded**

修改 `src/gyccode/session/compaction.ts` 的 `microcompactIfNeeded`（约 line 251-277），在现有使用率逻辑前插入 time-based 检查：

```ts
    const microcompactIfNeeded = Effect.fn("SessionCompaction.microcompactIfNeeded")(function* (input: {
      sessionID: SessionID
      model: Provider.Model
    }) {
      const cfg = yield* config.get()
      if (cfg.compaction?.microcompact === false) return false
      const msgs = yield* session
        .messages({ sessionID: input.sessionID })
        .pipe(Effect.catchIf(NotFoundError.isInstance, () => Effect.succeed(undefined)))
      if (!msgs || msgs.length === 0) return false

      // Time-based trigger first: a long idle gap means the prompt cache expired,
      // so clear old tool results before the request shrinks what is rewritten.
      const tbm = cfg.compaction?.time_based_microcompact
      if (tbm?.enabled !== false) {
        const tSelected = selectTimeBasedParts(msgs as any, {
          gapMinutes: tbm?.gap_minutes ?? 60,
          keepRecent: tbm?.keep_recent ?? 5,
        })
        if (tSelected.length > 0) {
          yield* Effect.logInfo("microcompacting (time-based)", {
            "session.id": input.sessionID,
            count: tSelected.length,
          })
          for (const part of tSelected) {
            if (part.state.status === "completed") {
              part.state.time.compacted = Date.now()
              yield* session.updatePart(part)
            }
          }
          // Chained: fall through to usage-based check below.
        }
      }

      const used = yield* estimate({ messages: msgs, model: input.model })
      const limit = usable({ cfg, model: input.model, outputTokenMax: flags.outputTokenMax })
      if (limit <= 0) return true
      const selected = selectMicrocompactParts(msgs as any, used, limit)
      if (selected.length === 0) return true
      yield* Effect.logInfo("microcompacting", {
        "session.id": input.sessionID,
        count: selected.length,
        usage: Math.round((used / limit) * 100),
      })
      for (const part of selected) {
        if (part.state.status === "completed") {
          part.state.time.compacted = Date.now()
          yield* session.updatePart(part)
        }
      }
      return true
    })
```

（注：`selectTimeBasedParts` 需 import 进 compaction.ts；`return true` 表示已尝试压缩、调用方 continue——保持原语义。）

- [ ] **Step 6: 运行确认通过 + 回归**

Run: `bun test ./src/gyccode/session/microcompact-select.test.ts ./src/gyccode/session/compaction.test.ts 2>&1 | Select-Object -Last 5`
Expected: 0 fail

- [ ] **Step 7: Commit**

```bash
git add src/gyccode/session/microcompact-select.ts src/gyccode/session/microcompact-select.test.ts src/gyccode/session/compaction.ts
git commit -m "feat(session): time-based micro-compaction with configurable gap and keep, chained before usage-based"
```

---

### Task 8: 5.4 API 原生上下文管理（context-management beta 头 + 参数）

**Covers:** [S8]

**Files:**
- Modify: `src/gyccode/session/llm/request.ts`
- Test: `src/gyccode/session/llm/context1m.test.ts`（或新 `context-management.test.ts`）
- Modify: `src/gyccode/session/llm/context-1m.ts`（新增头常量）

- [ ] **Step 1: 追加测试**

新建 `src/gyccode/session/llm/context-management.ts` 与 `context-management.test.ts`。先写测试：

```ts
import { describe, expect, it } from "bun:test"
import { CONTEXT_MANAGEMENT_BETA_HEADER, contextManagementEdits } from "./context-management"

describe("CONTEXT_MANAGEMENT_BETA_HEADER", () => {
  it("is the context-management beta", () => {
    expect(CONTEXT_MANAGEMENT_BETA_HEADER).toBe("context-management-2025-06-27")
  })
})

describe("contextManagementEdits", () => {
  it("returns undefined when disabled", () => {
    expect(contextManagementEdits({ enabled: false })).toBeUndefined()
  })
  it("builds clear_thinking edit", () => {
    const edits = contextManagementEdits({ enabled: true, clear_thinking: true, thinking_turns: 1 })
    expect(edits).toEqual([
      { type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: 1 } },
    ])
  })
  it("builds clear_tool_uses edit with trigger", () => {
    const edits = contextManagementEdits({
      enabled: true,
      clear_tool_uses: true,
      trigger_threshold: 180000,
      keep_target: 40000,
    })
    expect(edits).toEqual([
      {
        type: "clear_tool_uses_20250919",
        trigger: { type: "token_threshold", value: 180000 },
        clear_at_least: { type: "token_count", value: 140000 },
        exclude_tools: [],
      },
    ])
  })
  it("combines both edits", () => {
    const edits = contextManagementEdits({
      enabled: true,
      clear_thinking: true,
      clear_tool_uses: true,
      thinking_turns: 2,
      trigger_threshold: 200000,
      keep_target: 50000,
    })
    expect(edits).toHaveLength(2)
    expect(edits![0]!.type).toBe("clear_thinking_20251015")
    expect(edits![1]!.type).toBe("clear_tool_uses_20250919")
  })
  it("returns undefined when both clears disabled", () => {
    expect(contextManagementEdits({ enabled: true, clear_thinking: false, clear_tool_uses: false })).toBeUndefined()
  })
})
```

- [ ] **Step 2: 运行确认失败**

Run: `bun test ./src/gyccode/session/llm/context-management.test.ts`
Expected: FAIL "Cannot find module './context-management'"

- [ ] **Step 3: 写最小实现**

创建 `src/gyccode/session/llm/context-management.ts`：

```ts
/**
 * API-native context management (Anthropic `context-management` beta).
 * Lets the API clear old thinking blocks / tool uses server-side, shrinking
 * the request without a client-side compaction round. Aligned with Claude
 * Code's apiMicrocompact, but universally configurable (Claude gates tool
 * clearing behind ant-only env flags).
 */

export const CONTEXT_MANAGEMENT_BETA_HEADER = "context-management-2025-06-27"

export interface ContextManagementConfig {
  enabled: boolean
  trigger_threshold?: number
  keep_target?: number
  clear_thinking?: boolean
  clear_tool_uses?: boolean
  thinking_turns?: number
}

export type ContextManagementEdit =
  | { type: "clear_thinking_20251015"; keep: { type: "thinking_turns"; value: number } }
  | {
      type: "clear_tool_uses_20250919"
      trigger: { type: "token_threshold"; value: number }
      clear_at_least: { type: "token_count"; value: number }
      exclude_tools: string[]
    }

export function contextManagementEdits(cfg: ContextManagementConfig): ContextManagementEdit[] | undefined {
  if (!cfg.enabled) return undefined
  const edits: ContextManagementEdit[] = []
  if (cfg.clear_thinking !== false) {
    edits.push({ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: cfg.thinking_turns ?? 1 } })
  }
  if (cfg.clear_tool_uses) {
    const trigger = cfg.trigger_threshold ?? 180_000
    const keep = cfg.keep_target ?? 40_000
    edits.push({
      type: "clear_tool_uses_20250919",
      trigger: { type: "token_threshold", value: trigger },
      clear_at_least: { type: "token_count", value: Math.max(0, trigger - keep) },
      exclude_tools: [],
    })
  }
  return edits.length > 0 ? edits : undefined
}
```

- [ ] **Step 4: 运行确认通过**

Run: `bun test ./src/gyccode/session/llm/context-management.test.ts`
Expected: 全通过

- [ ] **Step 5: 接线 request.ts**

修改 `src/gyccode/session/llm/request.ts`：

- import：

```ts
import { CONTEXT_MANAGEMENT_BETA_HEADER, contextManagementEdits } from "./context-management"
import { ANTHROPIC_BETA_PROVIDERS } from "./context-1m"
```

（若 `ANTHROPIC_BETA_PROVIDERS` 未导出，在 `context-1m.ts` 中改为 `export`。）

- 在 `prepare` 的 `mergedHeaders` 组装后、`context1MHeader` 调用旁追加：

```ts
  // API-native context management: merge the context-management beta and, when
  // configured, attach context_management request options (Anthropic-lineage only).
  const cfg = yield* Config.Service
  const cfgInfo = yield* cfg.get()
  const acm = cfgInfo.compaction?.api_context_management
  if (acm?.enabled && isAnthropicLike(input.model)) {
    const existing = mergedHeaders["anthropic-beta"]
    const parts = existing ? existing.split(",").map((p) => p.trim()).filter(Boolean) : []
    if (!parts.includes(CONTEXT_MANAGEMENT_BETA_HEADER)) parts.push(CONTEXT_MANAGEMENT_BETA_HEADER)
    mergedHeaders["anthropic-beta"] = parts.join(",")
    const edits = contextManagementEdits({
      enabled: true,
      trigger_threshold: acm.trigger_threshold,
      keep_target: acm.keep_target,
      clear_thinking: acm.clear_thinking,
      clear_tool_uses: acm.clear_tool_uses,
      thinking_turns: acm.thinking_turns,
    })
    if (edits) {
      options["context_management"] = { edits }
      params.options = { ...params.options, context_management: { edits } }
    }
  }
```

（`isAnthropicLike(model)` 复用 `context-1m.ts` 的 provider 判定：`ANTHROPIC_BETA_PROVIDERS.has(model.providerID) || isAnthropicNpm(model.api.npm)`——把该判定提为 `context-1m.ts` 导出的 `isAnthropicLike` 以便复用。若 `Config.Service` 未注入 `prepare`，在 prepare 顶部 `yield* Config.Service`；以 request.ts 现有依赖为准。）

- [ ] **Step 6: 运行确认通过 + 回归 + tsc**

Run: `bun test ./src/gyccode/session/llm/context-management.test.ts ./src/gyccode/session/llm/context1m.test.ts ./src/gyccode/session/llm/request.test.ts 2>&1 | Select-Object -Last 5; bun tsc --noEmit`
Expected: 0 fail, tsc exit 0

- [ ] **Step 7: Commit**

```bash
git add src/gyccode/session/llm/context-management.ts src/gyccode/session/llm/context-management.test.ts src/gyccode/session/llm/request.ts src/gyccode/session/llm/context-1m.ts
git commit -m "feat(session): API-native context management via context-management beta, universally configurable"
```

---

### Task 9: 全量回归 + tsc + 文档更新

**Covers:** [S9]

**Files:**
- 全部改动文件

- [ ] **Step 1: 全量非 UI 测试**

Run: `bun test ./src/core/util/ ./src/gyccode/session/ 2>&1 | Select-Object -Last 10`
Expected: 0 fail（已知失败仅 UI solid-js 相关，不在此目录）

- [ ] **Step 2: 类型检查**

Run: `bun tsc --noEmit`
Expected: exit 0

- [ ] **Step 3: 更新 spec 状态**

将 `docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md` 状态改为「已交付」，或留待 report 阶段标记。

- [ ] **Step 4: Commit**

```bash
git add -A docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md
git commit -m "docs(spec): mark model-capability gaps-closure design delivered"
```