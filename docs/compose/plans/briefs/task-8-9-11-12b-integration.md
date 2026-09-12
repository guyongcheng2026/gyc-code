# Task 8 / 9 / 11 / 12b 规格：集成与生命周期

已完成并提交的模块（不要改动）：`src/gyccode/learning/` 下的 paths / usage / ledger / skill-store / review-prompt / runner / trigger。

本批做四件事，每件单独 commit。

---

## Task 8 — 配置段

文件：`src/core/v1/config/config.ts`（在 `memory` 段之后，约 :311-332 处）

在 config 的顶层 schema 里、与既有 `memory` 段平级，新增 `learning` 段：

```ts
learning: Schema.optional(
  Schema.Struct({
    enabled: Schema.optional(Schema.Boolean).annotate({
      description: "启用会话尾部技能沉淀闭环（默认 true）",
    }),
    nudge_interval: Schema.optional(NonNegativeInt).annotate({
      description: "累计工具迭代数达到该值时触发一次沉淀（默认 10）",
    }),
    max_actions: Schema.optional(NonNegativeInt).annotate({
      description: "单次沉淀最多落盘的动作数（默认 5）",
    }),
    model: Schema.optional(Schema.String).annotate({
      description: "沉淀用的模型，如 deepseek/deepseek-chat（默认 provider 小模型）",
    }),
    stale_after_days: Schema.optional(NonNegativeInt).annotate({
      description: "多久未使用标记为 stale（默认 30）",
    }),
    archive_after_days: Schema.optional(NonNegativeInt).annotate({
      description: "多久未使用归档（默认 90）",
    }),
  }),
).annotate({ description: "技能沉淀闭环配置" }),
```

`NonNegativeInt` 在该文件已有使用（`memory` 段就用了），照抄即可。

**验收**：`bun test src/core/v1` 全绿；`bun run build` 通过。

**commit**：`feat(learning): 技能沉淀闭环配置段`

---

## Task 9 — 自建技能纳入发现

三处修改：

### 9.1 `src/gyccode/effect/runtime-flags.ts`

在 `disableComposeSkills`（:22）旁边加一行：

```ts
disableLearnedSkills: bool("GYCCODE_DISABLE_LEARNED_SKILLS"),
```

### 9.2 `src/gyccode/skill/index.ts` — `discoverSkills` 形参

在 `disableComposeSkills: boolean`（:195）之后加 `disableLearnedSkills: boolean`。注意该函数是位置参数风格，加在 `disableComposeSkills` 之后、`directory` 之前。

### 9.3 `src/gyccode/skill/index.ts` — 扫描块

在 compose 扫描块（:247-255，以 `if (!disableComposeSkills) { ... }` 结尾处）之后加：

```ts
  // 沉淀闭环自建技能：落在 GYC_HOME/skills，与 bundled/compose 只读集物理隔离。
  if (!disableLearnedSkills) {
    const root = skillsRoot()
    if (yield* fsys.isDir(root)) {
      yield* scan(state, root, SKILL_PATTERN, { dot: true, scope: "learned" })
    }
  }
```

需要 `import { skillsRoot } from "@/learning/paths"`（确认 `@/` 别名可用；该文件已用 `@/agent/agent` 等别名）。

再加一处：调用 `discoverSkills(...)` 的地方（约 :291-303）在 `flags.disableComposeSkills` 之后补 `flags.disableLearnedSkills`。

**要点**：自建技能**不要**设 hidden——它们是常规可用技能，应出现在 `available_skills` 中。`SKILL_PATTERN` 是 `**/SKILL.md`，`.blobs/` 下的哈希文件没有 `.md` 后缀不会被命中，无需额外过滤。

**验收**：`bun test src/gyccode/skill` 全绿。另外手工验证：临时把 `GYCCODE_MEMORY_HOME` 指向一个临时目录，在其中建 `skills/demo-skill/SKILL.md`（带 `---` frontmatter，含 `name` 与 `description`），确认 `Skill.all()` 能发现它；验证完删掉临时目录。若手工验证成本高，至少补一个单测。

**commit**：`feat(learning): 自建技能纳入技能发现`

---

## Task 11 — 技能加载计数

文件：`src/gyccode/tool/skill.ts`

在该工具 `execute` 返回 `output` 之前加一次 fire-and-forget 记账：

```ts
yield* Effect.promise(() => bumpView(gycHome(), info.name)).pipe(Effect.ignore)
```

- `bumpView` 与 `gycHome` 从 `../learning/usage` 与 `../learning/paths` 导入。
- 失败必须被忽略——记账不能影响技能加载。
- 用 `bumpView`（技能被加载进上下文）而非 `bumpUse`；两者都刷新 `lastActivityAt`，对老化时钟等价。

**验收**：`bun test src/gyccode/tool` 全绿。

**commit**：`feat(learning): 技能加载计入用量账本`

---

## Task 12b — 生命周期自动转换

文件：`src/gyccode/learning/lifecycle.ts` + `lifecycle.test.ts`

### 接口

```ts
import type { SkillUsage } from "./usage"

export interface LifecycleConfig {
  readonly staleAfterDays: number
  readonly archiveAfterDays: number
}

export const DEFAULT_LIFECYCLE_CONFIG: LifecycleConfig  // 30 / 90

export interface Transition {
  readonly name: string
  readonly to: "active" | "stale" | "archived"
}

export function planTransitions(
  usage: SkillUsage,
  options: { now: number; config?: LifecycleConfig },
): Transition[]

export async function applyTransitions(root: string, transitions: readonly Transition[]): Promise<void>
```

### `planTransitions` 规则（确定性，不用 LLM）

- `pinned === true` → **永不转换**（免疫）。
- 距 `lastActivityAt` 超过 `archiveAfterDays` → 转 `archived`。
- 否则距 `lastActivityAt` 超过 `staleAfterDays` → 转 `stale`。
- `state === "archived"` 且 `lastActivityAt` 距 `now` **未超过** `staleAfterDays` → 转 `active`（reactivate）。
- **宽限期**：`useCount === 0 && viewCount === 0`（从未被用过）时，从 `createdAt` 算起；若 `now - createdAt` 未超过 `staleAfterDays`，不转换。
- 目标状态与当前 `state` 相同时**不要**产生 Transition（避免无谓写入）。
- 返回值按 `name` 排序，保证确定性。

### `applyTransitions`

- `to: "archived"` → 调 `skill-store` 的 `archive`（`make(root).archive({ name, sessionId: "lifecycle", reason: "auto" })`）或直接调 `setState(root, name, "archived")`；两者都做会导致账本与状态不一致，建议**只调 `setState`**（自动转换是元数据变更，不做目录搬迁），并在注释里写明这个取舍。
- `to: "stale"` / `"active"` → `setState`。
- 任何失败都吞掉，只 `console.warn`（不抛）。

### `lifecycle.test.ts` 必须覆盖

1. `pinned` 技能无论多久未用都不产生 Transition
2. 超过 `archiveAfterDays` → `archived`
3. 介于 `staleAfterDays` 与 `archiveAfterDays` 之间 → `stale`
4. 活跃技能（`lastActivityAt` 很近）→ 无 Transition
5. 从没用过（`useCount`/`viewCount` 均为 0）且 `createdAt` 在宽限期内 → 无 Transition
6. 从没用过但 `createdAt` 已超 `staleAfterDays` → `stale`
7. 已 `archived` 但近期有活动（`lastActivityAt` 在 `staleAfterDays` 内）→ `active`
8. 目标状态等于当前状态时不产生 Transition
9. 返回结果按 name 排序

用固定的 `now` 值构造数据，**不要依赖真实时钟**。

**commit**：`feat(learning): 技能生命周期自动转换规则`

---

## 工作方式

四件事依次做，每件 TDD（适用时）并单独 commit。最后跑：

```
bun test src/gyccode/learning
bun test src/gyccode/skill
bun test src/gyccode/tool
bun run build
```

## 铁律

注释、测试描述、提交信息里禁止出现「用户」两字（改用「谷总」或换句式）；注释全简体中文；新文件 UTF-8 无 BOM。

不要修改 `src/gyccode/learning/` 下已完成的 7 个模块及其测试。不要 `git add docs/`。
