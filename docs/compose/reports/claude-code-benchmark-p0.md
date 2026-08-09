---
feature: claude-code-benchmark
status: delivered (P0 + P1)
specs:
  - docs/compose/specs/2026-08-10-claude-code-benchmark-design.md
plans:
  - docs/compose/plans/2026-08-10-claude-code-benchmark-p0.md
branch: main
commits: a35c2a0..6bda90d
---

# Claude Code 三指标对标改进 — 最终报告（P0 + P1）

## What Was Built

对标 Claude Code 2.1.88 源码，对 gyc-code（gyc-cli）在「任务成功率 / 幻觉率 / 每任务真实成本」三项指标上完成机制差距评估，并交付两批共 9 项代码改进：P0（记忆自动提取 S4、read-before-write 强制 H1、prompt cache 稳定 C1、token budget 续跑 C2）与 P1（输出 escalate S2、WebSearch 强制引用 H4、记忆 freshness H3、任务管理工具 S6、大结果 LLM 摘要 H6+C5）。全部改进以 TDD 方式实现，15 个功能 commit，新增 22 个单元测试，非 UI 测试 92/92 通过，类型检查零错误。

## Architecture

### P0 批（第一批核心）

- **S4 记忆自动提取**：`src/gyccode/memory/extraction-runner.ts`（可注入 `Extractor`/`MemorySink` 的 `runExtraction`：提取→去重→maxMemories 截断→持久化）。`runLoop` 每 N 轮（默认 3）异步触发（`Effect.forkIn(scope)`+`Effect.ignore`），用 `summary` agent + 便宜模型经 `hermesMemorySink` 写入 Hermes 记忆。配置：`memory.extraction.{enabled,min_turns,model,max_memories}`。
- **H1 read-before-write 强制**：`read-cache.ts` 新增 `hasRead`/`markRead`（模块级 readSet 单例）；`read.ts` 读取时 markRead；`write.ts`/`edit.ts` 对已存在文件强制检查，未读报错。保留 mtime TOCTOU 防护。
- **C1 prompt cache 字节级稳定**：`message-v2.ts` 的 `aggregateToolCaps` 引入按 callID 冻结的截断决策（`truncationDecisions` Map），保证 prompt 前缀字节级稳定（对齐 partitionByPriorDecision）。
- **C2 token budget 续跑**：`token-budget.ts` 新增 `checkTokenBudget`（<90% 续跑；连续 3 次增量<500 收益递减即停）、`budgetContinuationMessage`；`runLoop` 解析 `+500k`/`use 2M tokens` 预算并注入续跑消息。

### P1 批（第二批）

- **S2 输出 escalate**：`request.ts` 新增 `resolveMaxOutputTokens`（override 优先）；`runLoop` 首次 `finish="length"` 时 escalate 到 64k 重试（对齐 max_output_tokens escalate），之后才走 resumes 注入。
- **H4 WebSearch 强制引用**：`websearch.ts` 结果末尾追加 "You MUST include the sources above" 提醒。
- **H3 记忆 freshness**：`hermes-bridge.ts` 新增 `getHermesMemoryAgeMs`；`formatMemoriesForPrompt` 支持 `fileAgeMs`，超过 7 天注入 `<system-reminder>This memory is N days old...verify against current code`。
- **S6 任务管理工具**：`task-manage.ts` 新增 `task_list`/`task_get`/`task_stop`（基于 BackgroundJob registry 的 list/get/cancel），注册进 registry builtin。
- **H6+C5 大结果摘要**：`summarize.ts` 新增 `shouldSummarize`/`summarizeText`（可注入 Summarizer，80k 输入边界，失败回退原文）；`webfetch.ts` 大内容经 `ctx.extra.summarizer` 摘要（对齐 Claude Code Haiku 摘要）。

### Design Decisions

- **依赖注入模式**：所有可测逻辑（runExtraction/summarizeText/task-manage）均采用注入式设计，LLM/服务调用在接线处构造——对齐 goal.ts judge 注入模式。
- **截断决策进程内冻结而非持久化**：`ToolPart.metadata` 会污染 provider 调用，故用模块级 Map；跨 resume 精确冻结归 P2。
- **S5 SessionMemory 评估修正**：gyc 的 `SUMMARY_TEMPLATE`（compaction.ts）已含 Objective/Work State(Completed/Active/Blocked)/Next Move/Relevant Files 结构化分区且 `previousSummary` 跨 compact 链式传递，与 Claude Code SessionMemory 目标等价——S5 从 P1 降为"已基本满足"，剩余差异归 P2。
- **收益递减优先于完成阈值**：`checkTokenBudget` 先判 diminishing returns 再判 90%，避免无进展续跑烧钱。

## Usage

- 记忆提取：默认每 3 轮自动提取；`memory.extraction.enabled=false` 关闭。
- read-before-write：write/edit 已存在文件时若本会话未 Read 会收到明确报错。
- token budget：消息中输入 `+500k`、`use 2M tokens` 等触发续跑。
- 任务管理：模型可用 `task_list`/`task_get`/`task_stop` 枚举/检查/停止后台任务。
- 输出 escalate：`finish="length"` 时自动 64k 重试，无需配置。
- 记忆 freshness / WebSearch 引用 / WebFetch 摘要：自动生效。

## Verification

- `bun tsc --noEmit`：通过（零错误；同时修复了既有 `toModelMessagesEffect` 不接受 `readonly WithParts[]` 的类型错误）。
- 非 UI 测试：92/92 通过（15 个文件），含 P0 新增 11 个 + P1 新增 11 个（request 3、hermes-bridge 4、task-manage 6、summarize 4）。
- 已知失败：`src/ui/components/scroll-view.test.ts`、`src/ui/context/i18n.test.ts` 因 solid-js `jsxDEV` 导出问题失败——仓库既有环境问题（基线即失败），本次未触碰任何 UI 文件。
- 所有 commit 已通过 `.githooks/post-commit` 自动 push 到 origin/main。

## Journey Log

- [lesson] 本仓库 TS 文件为 CRLF 行尾且部分含非 UTF-8 中文注释，`edit` 工具按字符串精确匹配会失败，需用 PowerShell 按行号重建。
- [lesson] write 工具存在"报告成功但未落盘"的间歇性问题，写文件后必须用 `Test-Path` 验证。
- [lesson] `aggregateToolCaps` 加冻结逻辑后需按 callID 确定性排序 + 冻结整个决策集合，测试曾捕获 total 重算漂移。
- [dead end] 截断决策写入 `ToolPart.metadata` 会污染 provider 调用，改为进程内模块级 Map。
- [pivot] `checkTokenBudget` 初始先判 90% 后判收益递减，测试暴露语义错误后调整为收益递减优先。
- [lesson] 任务管理工具用 `Tool.define` 会引入 Truncate/Agent 依赖使测试复杂化，改为返回 `{id, init}` Info + `Tool.init` 解包，测试直接构造 mock service。
- [lesson] S5 探索报告曾判为"无"，实际代码（compaction.ts SUMMARY_TEMPLATE + previousSummary 链）已覆盖核心能力——评估必须以真实代码为准。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-08-10-claude-code-benchmark-design.md` | 设计/评估 | 三指标差距总表 + P0/P1/P2 设计 + [S9] P1 发现 |
| `docs/compose/plans/2026-08-10-claude-code-benchmark-p0.md` | 实施计划 | P0 9 个 Task 的 TDD 步骤 |
