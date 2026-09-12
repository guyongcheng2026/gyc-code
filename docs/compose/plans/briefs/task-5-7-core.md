# Task 5 / 6 / 7 规格：沉淀提示词、沉淀主流程、触发判定

三个模块都在 `src/gyccode/learning/`，各自带一份 `*.test.ts`。**这三个模块都不做任何 I/O**，所有副作用通过参数注入（与 `src/gyccode/memory/extraction-runner.ts` 的 `Extractor` / `Source`、`dream-runner.ts` 的 `DreamSynthesizer` 同风格）。

---

## Task 5 — `review-prompt.ts`

```ts
export interface ReviewPromptInput {
  /** 本会话的可见文本转录（调用方已截断） */
  readonly transcript: string
  /** 当前技能库里已有的技能名（用于让模型优先改写而不是新建） */
  readonly skills: readonly string[]
  /** 本会话中实际加载过的技能名 */
  readonly loadedSkills: readonly string[]
}

export function buildReviewPrompt(input: ReviewPromptInput): string
```

返回的提示词**必须**包含以下四条硬约束（测试会逐条断言关键词出现）：

1. **要主动** — 多数会话至少应产生一次技能更新；空手而归是错失机会。
2. **优先级阶梯** — ① 改本次已加载的技能 → ② 改已有类级技能 → ③ 往已有技能下加支持文件（`references/` / `templates/` / `scripts/`）→ ④ 才允许新建类级技能。
3. **禁止捕获** — 一次性报错串、环境偶然现象、与本次任务绑定的临时做法。
4. **谷总偏好的归处** — 风格 / 流程偏好应写进治理该类任务的 SKILL.md 正文，而不只是写进记忆。

同时必须交代输出格式：**只输出 JSON 数组，不要任何解释文字或 markdown 代码块**；无动作时输出 `[]`。数组元素形如：

```json
[{ "action": "create", "name": "gateway-ops", "description": "...", "body": "..." }]
```

允许的 `action` 值：`create`（需 `name` / `description` / `body`）、`patch`（需 `name`，可选 `description` / `body`）、`write_file`（需 `name` / `file_path` / `content`；`file_path` 必须以 `references/`、`templates/` 或 `scripts/` 开头）。

把 `skills` 与 `loadedSkills` 渲染进提示词（空数组时给出「当前技能库为空」之类的说明）；把 `transcript` 附在末尾。

**测试要求**：断言四条约束各自的关键词在提示词中出现；断言 `loadedSkills` 中的技能名出现在提示词里；断言 `skills` 为空时提示词有合理表述；断言输出格式约定（`[]` 与 JSON）被写明。

---

## Task 6 — `runner.ts`

```ts
import { Effect } from "effect"

export interface ReviewAction {
  readonly action: "create" | "patch" | "write_file"
  readonly name: string
  readonly description?: string
  readonly body?: string
  readonly file_path?: string
  readonly content?: string
}

export interface ReviewResult {
  readonly created: readonly string[]
  readonly patched: readonly string[]
  readonly wroteFiles: readonly string[]
  readonly rejected: ReadonlyArray<{ name: string; reason: string }>
}

/** 注入：把提示词变成模型输出（LLM 调用）。 */
export type Reviewer = (input: { prompt: string }) => Effect.Effect<string>

export interface RunReviewOptions {
  readonly root: string
  readonly sessionId: string
  readonly transcript: string
  readonly loadedSkills: readonly string[]
  readonly skills: readonly string[]
  readonly reviewer: Reviewer
  readonly maxActions?: number   // 默认 5
}

export function parseActions(raw: string): ReviewAction[]   // 导出以便单测
export function runReview(options: RunReviewOptions): Effect.Effect<ReviewResult>
```

### `parseActions` 要求

- 容错解析**极其重要**：模型可能包一层 ```json 代码块、可能在前后带解释文字、可能返回坏 JSON。
- 提取第一个 `[` 到最后一个 `]` 之间的内容再 `JSON.parse`；失败返回 `[]`。
- 过滤掉不合法的元素：`action` 不在三个允许值内、`name` 非字符串或为空 → 丢弃。
- `create` 缺 `body` 或 `description` → 丢弃；`write_file` 缺 `file_path` 或 `content` → 丢弃。
- 不要抛错，永远返回数组。

### `runReview` 要求

1. `buildReviewPrompt({ transcript, skills, loadedSkills })` 构造提示词。
2. `yield* reviewer({ prompt })` 拿原始输出。
3. `parseActions(raw)`，截断到 `maxActions ?? 5`。
4. 用**注入的 store** 逐条应用。store 参数类型用 `SkillStore`（从 `./skill-store` 导入其类型即可；`runReview` 只依赖接口，不自己 `make`）。
   - `create` → `store.create({ name, description, body, sessionId })`
   - `patch` → `store.patch({ name, description, body, sessionId })`
   - `write_file` → `store.writeSupportFile({ name, filePath: file_path, content, sessionId })`
5. 每条结果 `ok: true` 记入对应数组（`created` / `patched` / `wroteFiles`），`ok: false` 记入 `rejected`（含 `reason`）。
6. **单条失败绝不中断其余动作**；整体失败也绝不向上抛（沉淀是尽力而为，主循环不能因它受影响）。用 `Effect.catchCause` 兜住，并 `Effect.logWarning`。
7. 结束时 `Effect.logInfo` 记录 `created/patched/wroteFiles/rejected` 的数量。

**测试要求**（全部通过注入的假 reviewer + 真实 store 指向临时目录，或注入内存假 store）：

- 坏 JSON 输入 → `parseActions` 返回 `[]`，`runReview` 返回全空结果且不抛错
- ```json 代码块包裹 + 前后有解释文字 → 能正确解析
- `parseActions` 丢弃 `action` 非法、`name` 为空、`create` 缺 `body` 的元素
- `runReview` 超过 `maxActions` 时被截断（给 8 个动作、`maxActions: 3`，只应用前 3 个）
- 单条动作被 store 拒绝（如 `not-writable`）时其余动作仍被应用，`rejected` 里记录了 reason
- reviewer 直接失败（`Effect.die`）→ `runReview` 不抛错，返回空结果

---

## Task 7 — `trigger.ts`

```ts
export interface TriggerConfig {
  /** 累计工具迭代数达到该值时触发（默认 10） */
  readonly nudgeInterval: number
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig

export interface Trigger {
  /** 累加本轮新增的工具迭代数 */
  addToolIterations(count: number): void
  /** 是否应当触发一次沉淀 */
  shouldReview(): boolean
  /** 标记本会话已完成沉淀；此后 shouldReview 恒为 false，直到 reset() */
  markReviewed(): void
  /** 新会话开始时重置 */
  reset(): void
  /** 当前累计值，供诊断 */
  toolIterations(): number
}

export function createTrigger(config?: TriggerConfig): Trigger
```

行为：

- `addToolIterations` 忽略 `<= 0` 的输入。
- `shouldReview()` 为真当且仅当 `toolIterations >= nudgeInterval` 且本会话尚未 `markReviewed()`。
- `markReviewed()` 后 `shouldReview()` 恒为假。
- `reset()` 把累计值与已复习标记都清零。
- 纯内存，不碰 I/O，不读时钟。

**测试要求**：`nudgeInterval: 10` 时 9 次不触发、第 10 次触发；`shouldReview` 是纯查询（连续调用不改变状态）；`markReviewed` 后不再触发；`reset` 后重新可触发；`addToolIterations(0)` 与负数被忽略；`DEFAULT_TRIGGER_CONFIG.nudgeInterval` 为 10。

---

## 工作方式

TDD：三个模块分别「先写测试跑红 → 写实现 → 跑绿」，每个模块单独 commit：

- `feat(learning): 沉淀提示词，约束主动性与优先级阶梯`
- `feat(learning): 沉淀主流程，容错解析模型输出并逐条落盘`
- `feat(learning): 工具迭代触发判定`

最后跑 `bun test src/gyccode/learning` 确认七份测试全绿。

## 铁律

注释、测试描述、提交信息里禁止出现「用户」两字（改用「谷总」或换句式）；注释全简体中文；新文件 UTF-8 无 BOM。

不要修改 `paths.ts` / `usage.ts` / `ledger.ts` / `skill-store.ts`。
