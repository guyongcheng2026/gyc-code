# Task 6 / 7 规格（修正版）

> Task 5（`review-prompt.ts`）已完成并提交。本文件替代 `task-5-7-core.md` 中 Task 6/7 的部分，**并修正了原规格的一处不自洽**：`RunReviewOptions` 必须包含 `store`。

---

## Task 6 — `runner.ts`

```ts
import { Effect } from "effect"
import type { SkillStore } from "./skill-store"

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
  /** 注入的技能存储；runReview 不自己 make，只依赖接口 */
  readonly store: SkillStore
  readonly maxActions?: number   // 默认 5
}

export function parseActions(raw: string): ReviewAction[]
export function runReview(options: RunReviewOptions): Effect.Effect<ReviewResult>
```

### `parseActions` 要求

- 容错解析**极其重要**：模型可能包一层 ```json 代码块、前后带解释文字、或直接返回坏 JSON。
- 提取第一个 `[` 到最后一个 `]` 之间的内容再 `JSON.parse`；失败返回 `[]`。
- 逐元素过滤：`action` 不在三个允许值内、或 `name` 非字符串或为空 → 丢弃。
- `create` 缺 `description` 或缺 `body` → 丢弃。
- `write_file` 缺 `file_path` 或缺 `content` → 丢弃。
- 永不抛错，永远返回数组。

### `runReview` 要求

1. 用 `buildReviewPrompt({ transcript, skills, loadedSkills })`（从 `./review-prompt` 导入）构造提示词。
2. `yield* options.reviewer({ prompt })` 拿原始输出。
3. `parseActions(raw)`，截断到 `options.maxActions ?? 5`。
4. 逐条经 `options.store` 应用：
   - `create` → `store.create({ name, description: description ?? "", body: body ?? "", sessionId })`
   - `patch` → `store.patch({ name, description, body, sessionId })`
   - `write_file` → `store.writeSupportFile({ name, filePath: file_path ?? "", content: content ?? "", sessionId })`
5. `ok: true` 记入对应数组，`ok: false` 记入 `rejected`（带 `reason`）。
6. **单条失败绝不中断其余动作**；整体失败也绝不向上抛。用 `Effect.catchCause` 兜住并 `Effect.logWarning`。
7. 结束时 `Effect.logInfo` 记录三个数组与 `rejected` 的数量。

`runReview` 全程只做 `Effect`，不直接 `fs`。`root` 仅用于日志诊断。

### `runner.test.ts` 必须覆盖

用内存假 store（实现 `SkillStore` 接口、记录调用）或真实 store 指向 `mkdtemp` 临时目录均可。

1. 坏 JSON 输入 → `parseActions` 返回 `[]`；`runReview` 返回全空结果且不抛错
2. ```json 代码块包裹 + 前后有解释文字 → 能正确解析出动作
3. `parseActions` 丢弃：`action` 非法、`name` 为空、`create` 缺 `body`、`write_file` 缺 `file_path`
4. `runReview` 超 `maxActions` 被截断（8 个动作 + `maxActions: 3` → 只应用前 3 个）
5. 单条被 store 拒绝（返回 `ok: false`）时其余动作仍被应用，`rejected` 里记了 name 与 reason
6. reviewer 直接失败（`Effect.die`）→ `runReview` 不抛错，返回空结果

---

## Task 7 — `trigger.ts`

```ts
export interface TriggerConfig {
  /** 累计工具迭代数达到该值时触发（默认 10） */
  readonly nudgeInterval: number
}

export const DEFAULT_TRIGGER_CONFIG: TriggerConfig

export interface Trigger {
  addToolIterations(count: number): void
  shouldReview(): boolean
  markReviewed(): void
  reset(): void
  toolIterations(): number
}

export function createTrigger(config?: TriggerConfig): Trigger
```

行为：

- `addToolIterations` 忽略 `<= 0` 的输入（包括 0 与负数、`NaN`）。
- `shouldReview()` 为真当且仅当 `toolIterations >= nudgeInterval` 且本会话尚未 `markReviewed()`。
- `shouldReview()` 是纯查询：连续调用不改变任何状态。
- `markReviewed()` 后 `shouldReview()` 恒为假，直到 `reset()`。
- `reset()` 把累计值与已复习标记都清零。
- 纯内存，不碰 I/O，不读时钟。

### `trigger.test.ts` 必须覆盖

1. `nudgeInterval: 10`：9 次不触发、第 10 次触发
2. `shouldReview()` 连续调用结果一致、不产生副作用
3. `markReviewed()` 后不再触发（即使继续累加）
4. `reset()` 后重新可触发
5. `addToolIterations(0)` / 负数被忽略；`toolIterations()` 反映累计值
6. `DEFAULT_TRIGGER_CONFIG.nudgeInterval` 为 10

---

## 工作方式

TDD，两个模块分别提交：

- Task 6：`feat(learning): 沉淀主流程，容错解析模型输出并逐条落盘`
- Task 7：`feat(learning): 工具迭代触发判定`

最后跑 `bun test src/gyccode/learning` 确认全绿（应有 7 份测试：paths / usage / ledger / skill-store / review-prompt / runner / trigger）。

## 铁律

注释、测试描述、提交信息里禁止出现「用户」两字（改用「谷总」或换句式）；注释全简体中文；新文件 UTF-8 无 BOM。

不要修改已完成的 `paths.ts` / `usage.ts` / `ledger.ts` / `skill-store.ts` / `review-prompt.ts` 及其测试。

不要 `git add` `docs/compose/plans/` 下的任何文件。
