# gyc-code 自我进化架构

本文件描述**当前实际存在**的自我进化机制。两条线各管一件事：

- **记忆侧**（`src/gyccode/memory/`）记「发生过什么」——事实、决策、本次任务的经验，以及谷总是谁。
- **技能侧**（`src/gyccode/learning/`）记「这类任务该怎么做」——把可复用的流程沉淀成技能文档。

两条线都不阻塞主循环：所有沉淀都在会话尾部 fork 出去，失败只记日志。

---

## 一、记忆侧

| 模块 | 职责 |
|---|---|
| `memory/extract.ts` | 抽取提示词、去重判定、结果解析（纯逻辑） |
| `memory/extraction-runner.ts` | 抽取主流程；`memorySink` 按内容分流落盘 |
| `memory/dream.ts` | 梦境合成提示词、五维质量校验、阈值判定（纯逻辑） |
| `memory/dream-runner.ts` | 梦境主流程、状态读写（`dream-state.json`）、原子写 |
| `memory/memory-bridge.ts` | 会话记忆文件读写：TF-IDF 检索、去重、条目上限、4KB 注入预算、陈旧告警、TTL 缓存 |
| `memory/user-model.ts` | 谷总画像层（`USER.md`）：1400 字符上限，**偏好优先**淘汰（与记忆文件的 FIFO 不同） |
| `memory/file-lock.ts` | 跨进程文件锁 |

### 触发时机

- **抽取**：主循环每 `memory.extraction.min_turns` 轮（默认 3）触发一次，用便宜模型从最近对话里提事实与偏好。落盘时按内容分流——命中偏好信号（不要 / 一律 / 禁止 / 必须 / prefer / always …）进画像层，其余进记忆文件。
- **梦境**：抽取之后顺带评估。阈值是记忆数达到 10 条，且距上次超过 24 小时、或累积满 5 个会话。达标才合成摘要并写回。

### 注入方式

`session/system.ts` 在每轮组装系统提示时检索记忆与画像，两者拼在同一处（`MessageV2.toModelMessagesEffect` 的 `injectMemories`，追加到最后一条 user 消息末尾，保证历史前缀稳定、不破坏提示缓存）。画像用 `<about-owner>` 包裹，记忆用 `<memories>` 包裹，模型可区分「这是谁」与「发生过什么」。

---

## 二、技能侧：沉淀闭环

参照 Hermes Agent 的 curator / background-review 机制实现。模块都在 `src/gyccode/learning/`。

| 模块 | 职责 |
|---|---|
| `paths.ts` | 路径解析 + 技能名合法性校验（纯函数，不碰 I/O） |
| `usage.ts` | 用量账本 `.usage.json`：view / use / patch 计数、生命周期状态、pinned |
| `ledger.ts` | 变更账本 `.ledger.jsonl` + sha256 内容寻址快照 + 单条回滚 |
| `skill-store.ts` | 技能读写；provenance 闸门 + read-before-write 闸门 |
| `review-prompt.ts` | 沉淀提示词（纯逻辑） |
| `runner.ts` | 沉淀主流程：容错解析模型输出，逐条落盘 |
| `trigger.ts` | 工具迭代计数与触发判定（纯内存） |
| `lifecycle.ts` | stale / archive 自动转换（确定性规则，不用模型） |

### 闭环怎么走

1. **计数**：主循环每轮把本轮工具调用数累加到 `trigger`。
2. **触发**：会话即将退出时，若累计工具迭代数达到 `learning.nudge_interval`（默认 10）且本会话尚未沉淀过，`fork` 一次后台复盘，并立刻标记已沉淀（防止重复触发）。
3. **复盘**：把本会话可见文本与本会话加载过的技能交给模型，要求它按**优先级阶梯**给出动作：先改本次已加载的技能 → 再改已有类级技能 → 再往技能下加 `references/` / `templates/` / `scripts/` 支持文件 → 最后才允许新建类级技能。
4. **落盘**：动作逐条经 `skill-store` 应用，单条被拒不中断其余动作。

### 三道闸门

| 闸门 | 规则 |
|---|---|
| 类级命名 | 技能名必须是小写 kebab-case，且禁止 `fix-*` / `debug-*` / `audit-*` / `patch-*` / `hotfix-*` / `pr-*` / `issue-*` 前缀、禁止日期式与会话产物式命名 |
| provenance 白名单 | 只能改**自建且未被 pinned** 的技能（`origin === "agent" && !pinned`）；手写或外部安装的技能一律拒写 |
| read-before-write | 改写已有 SKILL.md 或覆盖已有支持文件前，必须在本轮沉淀里先读过它；新建不需要 |

### 可回溯

每次成功变更都留下一条账本记录（`before` / `after` 的文件清单与 sha256，内容按 sha256 存在 `.blobs/`）。账本是遥测——写不进去也不阻碍技能落盘；唯一 fail-closed 的操作是回滚本身：`gyc learning rollback <id>` 找不到条目会以非零码退出。

### 生命周期

`lifecycle.ts` 用纯确定性规则推进状态：闲置超过 30 天转 `stale`，超过 90 天转 `archived`；已归档但近期又活跃的转回 `active`；**pinned 技能免疫一切自动转换**。自动转换只改 `.usage.json` 里的状态，不搬迁目录——搬目录始终是显式动作。

### 运维入口

```
gyc learning status             查看技能库概况与最近一次变更
gyc learning usage              按最近活动时间列出用量
gyc learning rollback <id>      回滚账本中的某次变更
gyc learning archive <name>     手工归档
gyc learning restore <name>     从归档区恢复
gyc learning tick               按闲置时长推进生命周期
```

---

## 三、运行时技能来源

运行时技能只有两个来源：

1. `src/gyccode/skill/bundled/` 与 `src/gyccode/skill/compose/`（构建时打进 bundle，**只读**，compose 技能对普通模式隐藏）。
2. `$GYC_HOME/skills/`——沉淀闭环的自建技能。`$GYC_HOME` 解析顺序是 `GYCCODE_SKILLS_HOME || GYCCODE_MEMORY_HOME || ~/.gyc`。

> **注意**：这里刻意**不**采纳 `HERMES_HOME`。Hermes Agent 自己的 `skills/` 是它的技能库、`.usage.json` 是它自己的结构，沿用会把 gyc 的自建技能写进别人的库并误读其用量账本。

---

## 四、离线工具（不在运行时链路上）

以下模块在 `src/` 内没有运行时调用方，但**不是死代码**——它们由 `scripts/` 下的命令行工具驱动。不要因为「src 内零调用者」就把它们删掉（历史上发生过一次，见第五节）。

| 模块 | 驱动方式 | 用途 |
|---|---|---|
| `memory/training-pipeline.ts` | `bun scripts/build-training-set.ts <command>` | 从任务日志构建训练数据集 |
| `skills/agent-schema.ts` | `scripts/archive-skills.ts`、`scripts/marketplace.ts` | 技能清单 `agent.json` 的 schema 与校验 |
| `skills/marketplace-client.ts` | `scripts/marketplace.ts` | 技能市场客户端 |
| `skills/code-review/`、`skills/doc-generation/`、`skills/test-generation/` | `scripts/archive-skills.ts` | 技能市场的种子内容 |

运行时**不**从 `src/gyccode/skills/`（复数）加载技能，别把它和上面的 `src/gyccode/skill/`（单数）混为一谈。

---

## 五、历史教训

2026-09-03 的 commit `63f1e34d0e`「feat: self-evolution P0-P2 full implementation」一次性合入了 1788 行，包含 `skill-loader.ts`、`skill-registry.ts`、`skills/index.ts` 以及分层记忆的描述。但这些模块**从未接入运行时**——没有任何调用点，于是被 commit `256f5b7159`（knip 检查未使用文件）当作死代码删除，连文档一起留下了 705 行的空头承诺。

教训只有一句：**写了模块不等于有了机制**。一个自我进化特性要能被称为「存在」，必须满足三件事——有触发点（谁在什么时候调用它）、有产物（落到哪里、能被下一次会话读到）、有可验证的证据（测试或端到端跑通的记录）。缺任何一条，它都只是躺在仓库里的一堆文件。
