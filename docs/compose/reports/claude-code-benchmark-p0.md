---
feature: claude-code-benchmark-p0
status: delivered
specs:
  - docs/compose/specs/2026-08-10-claude-code-benchmark-design.md
plans:
  - docs/compose/plans/2026-08-10-claude-code-benchmark-p0.md
branch: main
commits: a35c2a0..7be74c0
---

# Claude Code 三指标对标改进 P0 阶段 — 最终报告

## What Was Built

对标 Claude Code 2.1.88 源码，对 gyc-code（gyc-cli）在「任务成功率 / 幻觉率 / 每任务真实成本」三项指标上完成机制差距评估，并交付 P0 阶段第一批 4 项代码改进：跨会话记忆自动提取（S4）、read-before-write 强制（H1）、prompt cache 字节级稳定（C1）、token budget 续跑（C2）。全部改进以 TDD 方式实现，7 个 commit，新增 11 个单元测试，非 UI 测试全量通过。

## Architecture

P0 的 4 项改进均为对现有主循环/工具层的增量增强，不改动模型本身：

- **S4 记忆自动提取**：新增 `src/gyccode/memory/extraction-runner.ts`（可注入 `Extractor`/`MemorySink` 的纯封装 `runExtraction`：提取 → 去重 → 按 maxMemories 截断 → 持久化）。在 `src/gyccode/session/prompt.ts` 的 `runLoop` 中每 N 轮（默认 3）异步触发（`Effect.forkIn(scope)` + `Effect.ignore`，不阻塞主循环），用 `summary` agent + 便宜模型（`provider.getSmallModel` 或配置 `memory.extraction.model`）调用 `formatExtractionPrompt`/`parseExtractionResult`，经 `hermesMemorySink` 写入 Hermes 记忆文件。配置字段：`memory.extraction.{enabled,min_turns,model,max_memories}`。
- **H1 read-before-write 强制**：`src/gyccode/tool/read-cache.ts` 新增 `hasRead`/`markRead` 已读状态（模块级 `readSet` 单例），`read.ts` 在读取成功与 file-unchanged 桩命中时 `markRead`；`write.ts`/`edit.ts` 对已存在文件强制检查 `hasRead`，未读则报错提示先读。保留原有 mtime TOCTOU 防护。
- **C1 prompt cache 字节级稳定**：`src/gyccode/session/message-v2.ts` 的 `aggregateToolCaps` 引入按 callID 冻结的截断决策（`truncationDecisions` Map）：一旦某 callID 决定截断/不截断即记录，后续序列化复用同一决策，保证 prompt 前缀字节级稳定（对齐 Claude Code partitionByPriorDecision）。导出 `resetTruncationDecisions` 供测试。
- **C2 token budget 续跑**：`src/gyccode/session/token-budget.ts` 新增 `checkTokenBudget`（<90% 续跑；连续 3 次续跑且增量 <500 token 收益递减即停）、`budgetContinuationMessage`；`prompt.ts` runLoop 在停止判定前解析用户消息中的 `+500k`/`use 2M tokens` 预算指令（`parseTokenBudgetNL`），未达预算时注入 synthetic user 消息继续循环。

### Design Decisions

- **记忆提取可注入**：`runExtraction` 采用依赖注入（`Extractor`/`MemorySink`），使纯逻辑可单测（fake extractor/sink），真实 LLM 调用只在 prompt.ts 接线处构造——对齐 goal.ts 的 judge 注入模式。
- **截断决策进程内冻结而非持久化**：冻结决策存模块级 Map（按 callID，全局唯一），未落库——因为 `ToolPart.metadata` 会污染 provider 调用，而进程内冻结已覆盖"轮次间前缀漂移"这一主要场景；跨 resume 精确冻结留待 P1。
- **收益递减优先于完成阈值**：`checkTokenBudget` 先判断 diminishing returns 再判断 90% 阈值，避免已无进展的续跑继续烧钱（对齐 Claude Code query/tokenBudget.ts 语义）。
- **默认开启记忆提取**：`memory.extraction.enabled` 默认 true（对标核心能力），提供开关关闭。

## Usage

- 记忆提取：默认每 3 轮自动提取。配置 `memory.extraction.enabled=false` 关闭；`min_turns`、`model`、`max_memories` 可调。
- read-before-write：无需配置，write/edit 已存在文件时若本会话未 Read 过会收到明确报错。
- token budget：用户在消息中输入 `+500k`、`use 2M tokens`、`limit to 500k tokens` 等即触发续跑。
- prompt cache：自动生效，无需配置。

## Verification

- `bun tsc --noEmit`：通过（同时修复了既有的 `toModelMessagesEffect` 不接受 `readonly WithParts[]` 的类型错误）。
- 非 UI 测试：75/75 通过（12 个文件），含本次新增 11 个测试（read-cache 3、read-before-write 3、token-budget 4、message-v2.cache 4、extraction-runner 3，其中 token-budget 与 message-v2 部分计数重叠）。
- 已知失败：`src/ui/components/scroll-view.test.ts`、`src/ui/context/i18n.test.ts` 因 solid-js `jsxDEV` 导出问题失败——为仓库既有环境问题（基线即失败，与本改动无关，本次未触碰任何 UI 文件）。
- 提交已通过 `.githooks/post-commit` 自动 push 到 origin/main。

## Journey Log

> 供后续阶段（P1/P2）参考的注意事项。

- [lesson] 本仓库 TS 文件为 CRLF 行尾且部分含非 UTF-8 中文注释，`edit` 工具按字符串精确匹配会失败，需用 PowerShell 按行号重建。
- [lesson] write 工具存在"报告成功但未落盘"的间歇性问题，写文件后必须用 `Test-Path` 验证。
- [lesson] `message-v2.ts` 的 `aggregateToolCaps` 原实现每次重算截断，首次改写时按"从大到小"排序即可，但加入冻结逻辑后需按 callID 升序确定性排序 + 冻结集合，测试曾捕获 total 重算漂移。
- [dead end] 曾尝试把冻结决策写入 `ToolPart.metadata` 持久化——会被 `callProviderMetadata` 传给 provider 造成污染，改为进程内模块级 Map。
- [pivot] `checkTokenBudget` 初始实现先判 90% 阈值后判收益递减，测试暴露语义错误后调整为收益递减优先。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-08-10-claude-code-benchmark-design.md` | 设计/评估 | 三指标差距总表 + P0/P1/P2 设计 |
| `docs/compose/plans/2026-08-10-claude-code-benchmark-p0.md` | 实施计划 | P0 9 个 Task 的 TDD 步骤 |
