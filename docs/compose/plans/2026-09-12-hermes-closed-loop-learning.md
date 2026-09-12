# Hermes 闭环学习机制移植 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把 Hermes Agent 的「任务完成 → 梳理流程 → 沉淀技能文档 → 跨会话索引 → 更新画像 → 多层记忆 → 下一任务」闭环移植进 gyc-code。

**Architecture:** 新增 `src/gyccode/learning/` 承担技能沉淀（存储/账本/生命周期/触发），与既有 `src/gyccode/memory/` 职责分离、风格对齐：纯逻辑模块不碰 I/O，副作用以注入函数传入（沿用 `Extractor` / `DreamSynthesizer` 模式）。自建技能落 `~/.gyc/skills/`，与 bundled/compose 只读集物理隔离。

**Tech Stack:** TypeScript + Bun + Effect v4 + `bun:test` + node `crypto`。

**设计来源（本机实测 Hermes 实现）：**

- 触发：`E:\myAI\hermes agent\agent\turn_finalizer.py:787-810`
- 沉淀提示词与三道闸门：`E:\myAI\hermes agent\agent\background_review.py:476-578`
- read-before-write / 落盘：`E:\myAI\hermes agent\tools\skill_manager_tool.py:458,1900`
- sha256 账本与回滚：`E:\myAI\hermes agent\tools\skill_ledger.py:104-141,545`
- 用量记账：`E:\myAI\hermes agent\tools\skill_usage.py:851-1056`
- tick 与 stale/archive：`E:\myAI\hermes agent\agent\curator.py:233-283,305-398`
- MEMORY/USER 双限额：`E:\myAI\hermes agent\tools\memory_tool.py:178-187`

---

## 关键背景（执行前必读）

### 已知技术债（Phase P2 一并治理）

1. `docs/SELF_IMPROVING_ARCHITECTURE.md` 描述的 `skill-loader.ts` / `skill-registry.ts` / `loadAllSkills` / `SkillRegistryService` / layered memory / orchestrator **在当前 src 中全部不存在**。
   - 实证：这些文件曾由 commit `63f1e34d0e`（2026-09-03）创建，随后被 commit `256f5b7159`「Remove unused files (36) identified by knip」删除——因为**从未接入运行时**。
   - 结论：该文档误导性强，必须改写。
2. `src/gyccode/memory/training-pipeline.ts`（10.5KB）在 src 内零调用者，但它**不是死代码**——它是离线工具，由 `scripts/build-training-set.ts` 驱动。真正的问题是文档把它描述成运行时组件。
3. `src/gyccode/skills/`（复数，`agent.json` + `KNOWLEDGE`/`RULE`/`MODEL`）是**离线种子内容**，只被 `scripts/archive-skills.ts` 与 `scripts/marketplace.ts` 引用，运行时不加载。

### 命名与文案铁律

- 凡涉及最终使用者的文本，一律写「**谷总**」；**禁止出现「用户」二字**。适用范围：对话回复、提交信息、代码注释、文档、计划、报告、子代理提示词。
- 所有对话、注释、文档使用简体中文。

### 路径约定

```
GYC_HOME = process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc")
```

与 `src/gyccode/memory/memory-bridge.ts:38`、`dream-runner.ts:20` 完全一致（既有约定，不得另立门户）。

```
$GYC_HOME/skills/<name>/SKILL.md          # agent 自建技能
$GYC_HOME/skills/<name>/references/*.md   # 支持文件
$GYC_HOME/skills/.usage.json              # 用量账本
$GYC_HOME/skills/.ledger.jsonl            # 变更账本（append-only）
$GYC_HOME/skills/.blobs/<sha256>          # 内容寻址快照
$GYC_HOME/skills/.learning-state.json     # 触发器状态
$GYC_HOME/skills_archived/<name>-<ts>/    # 归档区
```

### 验证命令

```bash
bun test src/gyccode/learning                                            # 本特性单测
bun test --preload ./scripts/bun-solid-preload.ts --path-ignore-patterns=src/webapp   # 全量
bun run build                                                            # 构建
```

---

## 文件结构

### 新建

| 文件 | 职责 |
|---|---|
| `src/gyccode/learning/paths.ts` | 路径解析 + 技能名/支持文件路径校验（纯函数，无 I/O） |
| `src/gyccode/learning/usage.ts` | `.usage.json` 读写与计数（view/use/patch/created/state/pinned） |
| `src/gyccode/learning/ledger.ts` | sha256 快照 + `.ledger.jsonl` 追加 + 单条回滚 |
| `src/gyccode/learning/skill-store.ts` | list/read/create/patch/writeSupportFile/archive/restore；provenance 闸门 + read-before-write 闸门 |
| `src/gyccode/learning/review-prompt.ts` | 沉淀提示词构建（Hermes `_SKILL_REVIEW_PROMPT` 精简移植） |
| `src/gyccode/learning/runner.ts` | 沉淀主流程：提示词 → 注入的 reviewer → 解析动作 → 经 skill-store 落盘 |
| `src/gyccode/learning/trigger.ts` | 工具迭代计数与触发判定（纯内存，可测） |
| `src/gyccode/learning/lifecycle.ts` | stale/archive 确定性规则（30d/90d，pinned 免疫） |
| `src/gyccode/memory/user-model.ts` | 谷总画像层（USER.md，独立字符限额） |
| `src/cli/cmd/learning.ts` | `gyc learning status \| rollback \| archive \| restore \| usage` |
| 各模块对应 `*.test.ts` | 单测 |

### 修改

| 文件 | 改动 |
|---|---|
| `src/core/v1/config/config.ts`（`memory` 段之后） | 新增 `learning` 配置段 |
| `src/gyccode/skill/index.ts`（compose 扫描之后） | 增加 learned 技能根扫描（scope `"learned"`） |
| `src/gyccode/session/prompt.ts:1360-1384` | 主循环退出分支挂载触发与 fork |
| `src/gyccode/session/prompt.ts:1246` 附近 | 累计工具迭代数（复用 `toolSignatures`） |
| `src/gyccode/tool/skill.ts` | 技能被加载时 `bumpView` |
| `src/gyccode/session/system.ts:154-180` | 注入谷总画像段 |
| `src/gyccode/memory/extract.ts` 与 `prompt.ts` | 抽取结果按内容分流到 USER / MEMORY |
| `src/core/session-search.ts` | LIKE 全扫升级为 FTS5 |
| `docs/SELF_IMPROVING_ARCHITECTURE.md` | 改写为与实现一致 |

---

## 每个 Task 的完成定义（DoD）

1. 先写失败测试 → 运行确认失败 → 实现 → 运行确认通过 → 提交。
2. 纯逻辑模块（`paths` / `trigger` / `review-prompt` / `runner` / `lifecycle`）不得直接做 I/O，副作用一律注入。
3. 有 I/O 的模块（`usage` / `ledger` / `skill-store` / `user-model`）：缺失文件、损坏文件、并发写三种情况都不允许抛到主循环。
4. 每个 Task 结束跑一次 `bun test <本模块>`；每个 Phase 结束跑一次全量 + `bun run build`。

---

# Phase P0 — 技能沉淀闭环

## Task 1 — 路径解析与命名校验

`src/gyccode/learning/paths.ts` + `.test.ts`

- 导出 `gycHome` / `skillsRoot` / `archiveRoot` / `skillDir` / `skillFile` / `usagePath` / `ledgerPath` / `blobsDir` / `learningStatePath` / `isValidSkillName` / `isValidSupportPath` / `SUPPORT_DIRS`。
- `gycHome()` 解析顺序必须与 `memory-bridge.ts:38` 完全一致。
- `isValidSkillName` 拒绝：非 kebab-case、`UPPER`、`-leading`、`trailing-`、空串、`../escape`、`a/b`、`fix-*` / `debug-*` / `audit-*` / `patch-*` / `hotfix-*` / `pr-*` / `issue-*` 前缀、含 `YYYY-MM-DD`、含 `today` / `now` / `temp` / `tmp`。
- `isValidSupportPath` 只放行 `references/` `templates/` `scripts/` 三类，拒绝逃逸、绝对路径、反斜杠。

参考 Hermes：`background_review.py:535-541`（类级命名）、`background_review.py:516-535`（三类支持文件）。

**验收**：`bun test src/gyccode/learning/paths.test.ts` 全绿。

## Task 2 — 用量账本 `.usage.json`

`src/gyccode/learning/usage.ts` + `.test.ts`

- 类型：`SkillOrigin = "agent" | "user"`，`SkillState = "active" | "stale" | "archived"`，`SkillUsageEntry { origin, state, pinned, useCount, viewCount, patchCount, createdAt, lastActivityAt }`。
- API：`readUsage` / `recordCreated` / `bumpView` / `bumpUse` / `bumpPatch` / `setState` / `setPinned` / `isWritable`。
- 读失败（缺失/损坏）返回空表，绝不抛错。
- 写用「临时文件 + rename」原子替换，JSON 以换行结尾。
- 进程内并发读改写必须串行化（模块级 Promise 队列），避免丢更新。
- `isWritable(entry)` = `origin === "agent" && !pinned`。
- **不要加「成功率」字段**——Hermes 的效果反馈就是「次数 + 最后活动时间 + 被 patch 次数 + 生命周期状态」。

参考 Hermes：`tools/skill_usage.py:851-1056`。

**验收**：`bun test src/gyccode/learning/usage.test.ts` 全绿。

## Task 3 — 变更账本与回滚

`src/gyccode/learning/ledger.ts` + `.test.ts`

- `sha256(content)` 用 node `crypto`。
- `snapshotSkill(root, name)` → `FileSnapshot[]`，递归遍历技能目录，内容按 sha256 存入 `$GYC_HOME/skills/.blobs/<hash>`（内容寻址，相同内容只存一份）；技能不存在返回 `[]` 而非抛错。
- `appendEntry(root, input)` → 追加一行 JSONL，返回 entry id；**任何失败都吞掉**（账本是遥测，绝不阻塞技能写入）。
- `readLedger(root)` → 跳过损坏行，不整份作废。
- `rollbackEntry(root, id)` → 删除该次变更新建的文件、把 `before` 逐个写回；**id 不存在必须抛错**（唯一 fail-closed 操作）。

参考 Hermes：`tools/skill_ledger.py:104-141`（blobs）、`:387-455`（append/capture）、`:545`（rollback）、`:20-24`（遥测语义）。

**验收**：`bun test src/gyccode/learning/ledger.test.ts` 全绿。

## Task 4 — 技能存储与两道闸门

`src/gyccode/learning/skill-store.ts` + `.test.ts`

- `list(root)` / `read(root, name)` / `readSupportFile(root, name, rel)` / `create(root, {name, description, body})` / `patch(root, name, {description?, body})` / `writeSupportFile(root, name, rel, content)` / `archive(root, name, reason)` / `restore(root, name)`。
- **闸门一（provenance）**：只有 `isWritable(usage[name])` 为真的技能可被改写；不在此列一律拒绝并返回结构化拒绝原因，不抛异常。
- **闸门二（read-before-write）**：`patch` 与覆盖已存在支持文件前，必须在本轮沉淀中先 `read` 过该技能；由 store 实例内存中的 read-mark 集合强制。新建技能或新增支持文件不需要先读。
- 每次成功变更：先 `snapshotSkill` 取 before → 写盘 → `snapshotSkill` 取 after → `appendEntry` → `bumpPatch`（create 则 `recordCreated`）。
- `create` 前 `isValidSkillName` 必须为真，且技能不得已存在。
- `archive` 把目录移到 `$GYC_HOME/skills_archived/<name>-<时间戳>/`，并 `setState(..., "archived")`；`restore` 反向。
- SKILL.md 必须带 YAML frontmatter：`name` + `description`（供 `Skill.discovery` 的 `isSkillFrontmatter` 识别）。

参考 Hermes：`skill_manager_tool.py:458`（read-before-write guard）、`:978`（create）、`:1139`（patch）、`:1276`（delete）、`:1384`（write_file）、`background_review.py:562-577`（protected 名单）。

**验收**：`bun test src/gyccode/learning/skill-store.test.ts` 全绿；必测「拒写 user-owned」「未先读即 patch 被拒」「新建无需先读」。

## Task 5 — 沉淀提示词

`src/gyccode/learning/review-prompt.ts` + `.test.ts`

- `buildReviewPrompt({ transcript, skills, loadedSkills })` → string。
- 必须包含 Hermes 的四条硬约束（精简后保留全部语义）：
  1. **要主动**：多数会话至少应产生一次技能更新；空手而归是错失机会。
  2. **优先级阶梯**：① 改本次已加载的技能 → ② 改已有类级 umbrella → ③ 往 umbrella 下加 `references/` / `templates/` / `scripts/` 支持文件 → ④ 才允许新建类级技能。
  3. **禁止捕获**：一次性报错串、环境偶然现象、与本次任务绑定的临时做法。
  4. **谷总偏好的归处**：风格/流程偏好应写进治理该类任务的 SKILL.md 正文，而不是只写进记忆。
- 输出约定为 JSON 动作数组：`[{ "action": "create" | "patch" | "write_file", "name": string, "description"?: string, "body"?: string, "file_path"?: string, "content"?: string }]`；无动作时输出 `[]`。

参考 Hermes：`background_review.py:476-578`（原文较长，移植时压缩到 ~40 行，保留全部语义要点）。

**验收**：`bun test src/gyccode/learning/review-prompt.test.ts` 全绿（断言四条约束均出现在提示词中）。

## Task 6 — 沉淀主流程

`src/gyccode/learning/runner.ts` + `.test.ts`

- 注入式签名（与 `Extractor` / `DreamSynthesizer` 同风格）：

```typescript
export type Reviewer = (input: { prompt: string }) => Effect.Effect<string>
export interface RunReviewOptions {
  readonly root: string
  readonly sessionId: string
  readonly transcript: string
  readonly loadedSkills: readonly string[]
  readonly reviewer: Reviewer
  readonly store: SkillStore
  readonly maxActions?: number
}
export function runReview(options: RunReviewOptions): Effect.Effect<ReviewResult>
```

- 流程：构建提示词 → 调 reviewer → `parseActions`（容错解析，坏 JSON 返回 `[]`）→ 截断到 `maxActions`（默认 5）→ 逐条经 `store` 应用 → 汇总 `{ created, patched, wroteFiles, rejected }`。
- 单个动作失败不得中断其余动作；整体失败不得向上抛（沉淀是尽力而为）。
- 用 `Effect.logInfo` 记录结果。

**验收**：`bun test src/gyccode/learning/runner.test.ts` 全绿（必测：坏 JSON → 空结果；单动作失败不中断；超 maxActions 被截断）。

## Task 7 — 触发判定

`src/gyccode/learning/trigger.ts` + `.test.ts`

- 纯内存状态机：`createTrigger(config)` → `{ addToolIterations(n), shouldReview(), markReviewed(), reset() }`。
- 触发条件：`toolIterations >= config.nudgeInterval`（默认 10）且本会话尚未 review。
- `markReviewed()` 后不再触发，直到 `reset()`（新会话）。

参考 Hermes：`turn_finalizer.py:787-792`、`agent_init.py:2000`（默认 10）。

**验收**：`bun test src/gyccode/learning/trigger.test.ts` 全绿。

## Task 8 — 配置段

`src/core/v1/config/config.ts`（在 `memory` 段 `:311-332` 之后）

```typescript
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

**验收**：`bun test src/core/v1` 全绿；`bun run build` 通过。

## Task 9 — 自建技能纳入发现

`src/gyccode/skill/index.ts`（在 compose 扫描块 `:247-255` 之后）

```typescript
// 沉淀闭环自建技能：落在 GYC_HOME/skills，与 bundled/compose 只读集物理隔离。
if (!disableLearnedSkills) {
  const root = skillsRoot()
  if (yield* fsys.isDir(root)) {
    yield* scan(state, root, SKILL_PATTERN, { dot: true, scope: "learned" })
  }
}
```

- 新增 flag `disableLearnedSkills`，贯通路径对齐既有 `disableComposeSkills`（`RuntimeFlags` → `discoverSkills` 参数）。
- `SKILL_PATTERN = "**/SKILL.md"`（:28）会扫到 `.blobs/` 下的哈希文件名，但它们没有 `.md` 后缀，不会命中，无需额外过滤。
- 自建技能**不设为 hidden**：它们是常规可用技能，应出现在 `available_skills` 中。

**验收**：手工造 `$GYC_HOME/skills/demo-skill/SKILL.md`，确认它出现在 `Skill.all()` 中；`Skill.available()` 仍不含 compose 技能。

## Task 10 — 主循环挂载

`src/gyccode/session/prompt.ts`

- **计数**（`:1246` 附近，`hasToolCalls` 计算处）：用既有 `toolSignatures(lastAssistantMsg.parts).length`（来自 `./tool-stall`）累加到本循环的 `toolIterations`。
- **触发点**：会话退出分支（`:1360-1382`，判定 `!hasToolCalls && finish 不在 ["tool-calls","unknown"]`）内，在 `break` 之前：

```typescript
const learningCfg = (yield* config.get()).learning
if (learningCfg?.enabled !== false && learningTrigger.shouldReview()) {
  learningTrigger.markReviewed()
  yield* runReview({
    root: gycHome(),
    sessionId: sessionID,
    transcript: buildTranscript(msgs), // 只取可见文本，截断到 ~12k 字符
    loadedSkills: collectLoadedSkills(msgs),
    reviewer: makeReviewer({ agents, provider, llm, sessionID, lastUser }),
    store: SkillStore.make(gycHome()),
    maxActions: learningCfg?.max_actions ?? 5,
  }).pipe(
    Effect.catchCause(() => Effect.logWarning("技能沉淀失败；已跳过", { "session.id": sessionID })),
    Effect.forkIn(scope),
  )
}
```

- `makeReviewer` 的 LLM 调用方式**必须与既有抽取路径完全一致**（`:1417-1443` 的 `Extractor`）：`agents.get("summary")` + `provider.getSmallModel(...)` + `llm.stream({ agent, user, system: [], small: true, tools: {}, model, sessionID, retries: 2, messages })` + `Stream.filter(LLMEvent.is.textDelta)` + `Stream.mkString`。
- `scope`（`:216`）、`agents`（`:201`）、`provider`（`:202`）、`llm`（`:222`）均在外层作用域，退出分支可直接使用。
- `forkIn(scope)` 保证非阻塞；沉淀失败绝不影响主循环退出。
- `collectLoadedSkills(msgs)`：扫所有 tool part，`part.tool === "skill"` 时取 `part.state?.input?.name`；无则 `[]`。

参考 Hermes：`turn_finalizer.py:803-810`、`background_review.py:1102`（fork 的 cache parity）、`:1250`（fork 内禁用再触发——gyc 侧由 `markReviewed()` 等价实现）。

**验收**：手工造一个 10+ 工具调用的会话，确认日志出现沉淀记录、`$GYC_HOME/skills/` 下出现新条目；`bun test src/gyccode/session` 全绿。

## Task 11 — 技能加载计数

`src/gyccode/tool/skill.ts`

- 在返回 `output` 前加一次 fire-and-forget 记账：

```typescript
yield* Effect.promise(() => bumpView(gycHome(), info.name)).pipe(Effect.ignore)
```

- 用 `bumpView` 而非 `bumpUse`：技能被加载进上下文记 view；「被实际按流程执行」难以自动判定。两者都刷新 `lastActivityAt`，对老化时钟等价。
- 失败必须 `Effect.ignore`——记账不能影响技能加载。

**验收**：`bun test src/gyccode/tool` 全绿；手工跑一次技能加载确认 `.usage.json` 计数 +1。

## Task 12 — CLI 命令

`src/cli/cmd/learning.ts`（写法对齐 `src/cli/cmd/memory.ts`）

- `gyc learning status` — 技能总数、自建数、stale/archived 数、最近一次 ledger 时间。
- `gyc learning usage` — 每个技能的 `useCount` / `viewCount` / `patchCount` / `lastActivityAt`，按 `lastActivityAt` 倒序。
- `gyc learning rollback <id>` — 调 `rollbackEntry`；失败以非零退出码结束（唯一 fail-closed 操作）。
- `gyc learning archive <name>` / `restore <name>` — 手工归档/恢复。

**验收**：`bun run dev -- learning status` 有输出；`bun test src/cli` 全绿。

## Task 12b — 生命周期自动转换

`src/gyccode/learning/lifecycle.ts` + `.test.ts`

- 纯函数：`planTransitions(usage, { now, staleAfterDays, archiveAfterDays })` → `Transition[]`，`Transition = { name, to: "stale" | "active" | "archived" }`。
- 规则（确定性，不用 LLM），依据 Hermes `curator.py:305-398`：
  - `pinned === true` → **永不转换**（Hermes 明确：pinned 被自动流程免疫）。
  - `state === "archived"` 且**有新的活动**（`lastActivityAt > 归档时间`）→ 转 `active`（reactivate，对应 `curator.py:393-396`）。
  - 距 `lastActivityAt` 超过 `archiveAfterDays`（默认 90）→ 转 `archived`。
  - 距 `lastActivityAt` 超过 `staleAfterDays`（默认 30）→ 转 `stale`。
  - `useCount === 0 && viewCount === 0`（从未被用过）→ 有**宽限期**：`createdAt` 起算不足 `staleAfterDays` 不转换（对应 `curator.py:359-369`）。
- 执行侧：`applyTransitions(root, transitions)` 调 `skill-store.archive` / `restore` 与 `usage.setState`，并写 ledger（`action: "archive" | "restore"`）。
- 调用点：CLI 启动时 tick 一次（对齐 Hermes 的 `maybe_run_curator`，见 `cli.py` tick 与 `gateway/run.py:6349`），失败仅日志。

**验收**：`bun test src/gyccode/learning/lifecycle.test.ts` 全绿（必测 pinned 免疫、从未使用者的宽限期、reactivate）。

---

# Phase P1 — 画像层与跨会话索引

## Task 13 — 谷总画像层

`src/gyccode/memory/user-model.ts` + `.test.ts`

- 路径：`$GYC_HOME/memory/USER.md`（与 `gyccode_memory.md` 平级，对应 Hermes `memories/USER.md`）。
- 条目分隔符与记忆文件一致（`\n§\n`），字符限额 `USER_CHAR_LIMIT = 1400`（Hermes 为 1375，取整便于文案）。
- API：`readUserModel()` / `writeUserModel(entry)` / `formatUserModelForPrompt(entries, budget)` / `isUserModelEntry(text)`。
- 超限淘汰策略与记忆文件**不同**：优先保留偏好/风格类条目，淘汰最旧的纯事实条目——画像层的价值集中在偏好。
- 原子写 + 缓存失效；复用 `memory-bridge.ts` 的 `atomicWriteFile` 模式（可导出则直接复用，否则本地实现并注释说明）。

参考 Hermes：`tools/memory_tool.py:178-187`（双限额）、`:949`（写入门控）、`:839-880`（外部漂移检测）。

**验收**：`bun test src/gyccode/memory/user-model.test.ts` 全绿（必测超限淘汰策略）。

## Task 14 — 抽取分流

`src/gyccode/memory/extract.ts` 与 `src/gyccode/session/prompt.ts:1445-1455`

- 新增 `classifyMemoryTarget(text): "user" | "memory"`，规则保守（默认归 memory）：
  - 命中偏好/风格/流程信号 → `user`：`不要` / `别` / `一律` / `禁止` / `必须` / `偏好` / `风格` / `称呼` / `prefer` / `always` / `never`。
  - 其余 → `memory`。
- `sink` 内部按分类分流：`user` → `writeUserModel`，`memory` → 既有 `memorySink`。保持注入式签名不变，避免改动调用点形状。
- 注意与 Task 5 第 4 条的分工：**操作流程偏好**进技能 SKILL.md，**身份/长期偏好**进画像层。
  参考 Hermes：`background_review.py:554-560`。

**验收**：`bun test src/gyccode/memory` 全绿；新增分类用例覆盖 10 个信号词。

## Task 15 — 画像注入

`src/gyccode/session/system.ts:154-180`

- 在既有 `memory` 段（`:166-179`）加入 `userModel` 段，独立预算 `USER_MODEL_INJECTION_BUDGET = 1_400`。
- 注入格式与记忆段区分：

```
<about-owner>
谷总画像（跨会话累积）：
- ...
</about-owner>
```

- 复用既有 TTL 缓存与 `MEMORY_CACHE_MAX` 淘汰逻辑，不新增第二套缓存。

**验收**：`bun test src/gyccode/session` 全绿；手工写一条 USER.md 确认出现在 system prompt 中。

## Task 16 — 跨会话索引升级 FTS5

`src/core/session-search.ts`（现 64 行）

现状（文件头 `:5-14` 自述）：LIKE 全表扫 `json_extract(p.data, '$.text')`，`Phase-1 will replace this scan with an FTS5 trigram index`。

目标：

1. migration 建 `part_fts`（FTS5）+ `part_fts_trigram`（`tokenize='trigram'`）。
2. 建表后一次性回填历史 `part` 文本。
3. `search()` 走 FTS5 `MATCH` + `bm25()` 排序，`m.time_created DESC` 为次排序；无命中或 FTS 不可用时**回退到现有 LIKE 路径**（保留 `escapeLike`，`:34`）。
4. CJK 查询走 trigram 表；ASCII 走标准表。

**必须保留 LIKE 回退**：老库未迁移时 FTS 表缺失，不能报错。

参考 Hermes：`hermes_state_common.py:667`（contentless FTS5）、`:736`（trigram，视图排除 `role='tool'`）、`hermes_state.py:4050`（CJK 表）。

**验收**：`bun test src/core` 全绿；新增用例覆盖「FTS 命中」「FTS 表缺失时回退 LIKE」「CJK 子串命中」。

---

# Phase P2 — 技术债治理

## Task 17 — 文档与实现对齐

`docs/SELF_IMPROVING_ARCHITECTURE.md`

- 重写为真实架构：记忆侧（`memory/`：extraction + dream + bridge + user-model）与技能侧（`learning/`：沉淀闭环）两条线，各标注实际文件与触发时机。
- 删除所有不存在的模块描述（`skill-loader` / `skill-registry` / layered memory / orchestrator / `loadAllSkills` / `SkillRegistryService`）。
- 明示 `src/gyccode/skills/`（复数）是**离线种子内容 + marketplace 输入**，运行时不从此处加载技能；运行时技能来自 `src/gyccode/skill/`（bundled/compose）与 `$GYC_HOME/skills/`（agent 自建）。
- 附「历史教训」：记录 2026-09-03 的 self-evolution P0-P2 因未接入运行时被 knip 判为死代码删除（`63f1e34d0e` → `256f5b7159`），说明「写了模块 ≠ 有了机制」。

**验收**：文档中每个文件路径都能在仓库中找到。

## Task 18 — 离线工具定位澄清

- `src/gyccode/memory/training-pipeline.ts` 文件头加注释：本模块是**离线工具**，由 `scripts/build-training-set.ts` 驱动，运行时不调用；不要因为「src 内零调用者」而删除。
- `src/gyccode/skills/agent-schema.ts` 与 `marketplace-client.ts` 同理加注释。
- 跑一次 `bun scripts/build-training-set.ts stats` 确认离线链路可用。

**验收**：`bun scripts/build-training-set.ts stats` 正常输出。

## Task 19 — 收尾验证

- [ ] `bun test --preload ./scripts/bun-solid-preload.ts --path-ignore-patterns=src/webapp` 全绿
- [ ] `bun run build` 成功
- [ ] 端到端手工验证：跑一个 ≥10 次工具调用的真实会话，确认
  - `$GYC_HOME/skills/` 下产生新技能或补丁
  - `.usage.json` 有对应条目
  - `.ledger.jsonl` 有新行，且 `before` / `after` 的 sha256 在 `.blobs/` 中可查
  - `gyc learning rollback <id>` 能把改动还原
  - 重新开会话时该技能出现在 `available_skills` 中
- [ ] 确认 compose 技能仍为 hidden（`Skill.available()` 不含 compose 技能）

---

## 风险与应对

| 风险 | 应对 |
|---|---|
| 沉淀污染技能库（写入低价值技能） | Task 1 类级命名校验 + Task 5「禁止捕获」清单 + Task 12 `rollback` 通道 |
| fork 消耗 token（Hermes 注释：每次 fork 约 30K token） | 默认阈值 10 次工具迭代；cron/子代理会话显式不触发（对齐 `turn_finalizer.py`） |
| 自建技能与 bundled 同名冲突 | `skill/index.ts:136-142` 已有 duplicate 警告；`skill-store.create` 前置检查技能不存在 |
| FTS5 迁移在老库上失败 | Task 16 强制保留 LIKE 回退 |
| 画像层与记忆层职责重叠 | Task 14 分类保守（默认归 memory）；Task 15 注入格式区分 `<about-owner>` 与 `<memories>` |
