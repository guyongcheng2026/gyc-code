---
feature: model-capability-gaps-closure
status: delivered
specs:
  - docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md
plans:
  - docs/compose/plans/2026-08-10-model-capability-gaps-closure.md
branch: main
commits: 940addc..0570967
---

# 模型能力层 6 项差距补齐 — 最终报告

## What Was Built

对标 Claude Code 2.1.88 复评确认的 6 项真实差距全部补齐，每项均超越 Claude 对应实现：1.2 `[1m]` 后缀 opt-in + 通用有效窗口裁剪、1.3 本地精确 tokenizer + 可选 API 校准、1.4 模型驱动输出上限 + 可配 escalate 顶、2.3 条件规则（globs+语言+OS+就近注入）、5.3 可配时间触发 microcompact、5.4 API 原生上下文管理（context-management beta，双运行时生效）。全部经 TDD + 每任务双阶段审查（spec 合规 + 代码质量）+ 最终整体审查实现，146 个非 UI 测试通过、`bun tsc --noEmit` 零错误。

## Architecture

### 1.2 `[1m]` 后缀 + 有效窗口裁剪（`session/llm/context-1m.ts`、`session/overflow.ts`）
- `parse1mSuffix(modelId)`：模型 id 尾 `[1m]`（大小写不敏感）→ 显式 1M opt-in。
- `strip1mSuffix(modelId)`：剥离 wire 上的后缀（Claude 400 防护）——在 AI SDK 与 native 两条 wire 入口应用；`context1MHeader` 仍看到带后缀 id 以决定 beta 头注入。
- `effectiveContextWindow(model, env)`：`GYCCODE_MAX_CONTEXT_TOKENS` 通用上限（Claude 的等价物 ant-only），非法值忽略，缺省回退 model.context ?? 200K；`overflow.ts usable` 两条分支（input/context）均应用。

### 1.3 token 计数（`core/util/tokenizer.ts`、`core/util/token.ts`）
- `tokenize(input)`：零依赖 BPE 近似——CJK 每字 1 token、ASCII 词簇、代码符号单 token、空白 run 1 token；线性时间（sticky regex）。
- `Token.estimate` 改走 `tokenize().length`；`estimateWithAPI` 注入式 API 计数（失败/非法/缺失回退本地）。
- `SessionCompaction.estimate` 接 `config.token_counting.mode`（local/api/auto）：api/auto 经 `makeCountTokensAdapter`（HTTP POST `{base}/v1/messages/count_tokens`，10s 超时，非 Anthropic 短路由）调用，失败回退本地。超越 Claude：本地精确离线可用，API 可选且带回退（Claude 无回退）。

### 1.4 输出上限（`provider/transform.ts`、`session/llm/output-cap.ts`、`session/llm.ts`、`request.ts`、`prompt.ts`）
- `resolveOutputTokenMax(flags, cfg)`：flag > config > 默认 32K，单一优先级源。
- `escalateOutputMax(model, cap)`：`min(model.limit.output, cap ?? 64K)`；prompt.ts finish=length 时 escalate（getModel 失败优雅降级）。
- 超越 Claude 的硬编码 default/upper 分级表：models.dev `limit.output` 自动适配任意新模型 + 用户可配。

### 2.3 条件规则（`session/rules.ts`、`session/instruction.ts`）
- `parseRuleFrontmatter`：YAML frontmatter 解析（globs 数组/单值/块、condition.language/os，注释剥离 + condition 块限定）。
- `globToRegExp`：`**` 零或多目录；`matchRules` 全条件命中，Windows 路径归一化，绝对+相对双匹配。
- `loadRulesFromDirs` 纯函数（fs 注入）；system 注入无条件规则 + `resolve()` 就近注入带 globs 规则（超越 Claude 仅 system 层）。
- `normalizeLanguage`：zh-CN/Hans/SG/TW→zh，en-US/GB/AU/CA→en。

### 5.3 时间触发 microcompact（`session/microcompact-select.ts`、`session/compaction.ts`、`prompt.ts`）
- `selectTimeBasedParts`：最后主循环 assistant 消息 `time.completed ?? time.created`（跳过 summary，回退 tool end），gap 超阈值清中间 tool 输出（保前缀+keepRecent）。
- `shouldContinueAfterMicrocompact(clearedAny, limitOk, selectedAny)`：锁定升级语义（无项可清→false→完整压缩可达，无忙循环）。
- `microcompactIfNeeded` 移至 overflow 门控**之前**（prompt.ts）：空闲超阈值即触发，无需等使用率≥85%。
- 超越 Claude GrowthBook 远程配置：本地可配 `gap_minutes`/`keep_recent`，opt-in。

### 5.4 API 原生上下文管理（`session/llm/context-management.ts`、`request.ts`、`src/llm/protocols/anthropic-messages.ts`）
- `contextManagementEdits` 产出 AI SDK camelCase shape（clear_thinking_20251015 keep thinking_turns；clear_tool_uses_20250919 trigger input_tokens / clearAtLeast input_tokens）。
- `contextManagementBetaHeader` / `contextManagementOptions` 纯函数（request.ts 复用），beta 头仅在 edits 非空时合并。
- 双运行时生效：AI SDK 路径 `params.options.contextManagement` → providerOptions.anthropic；native 路径 `lowerContextManagement` 忠实降级（字段名 snake_case、类型 identity，keep/clear_tool_inputs 保留，未知类型告警）→ body schema 含 context_management（encode 不丢）。
- `mergeBetaHeader` 共享（context-1m.ts）与 1M 头无漂移。超越 Claude：clear_tool_uses 通用 config（Claude ant-only）。

## Design Decisions

- **双形状（camelCase providerOptions / snake_case wire）**：AI SDK zod 只认 camelCase 且直通 wire，native 需要 raw snake_case——各自边界用正确形状，`lowerContextManagement` 只降字段名、类型 identity，保证两条路径 wire 字节一致（trigger 均 `input_tokens`）。
- **`[1m]` 后缀不进 wire**：opt-in 标记只在客户端用于 beta 头决策，wire 前剥离——避免 Anthropic 400。
- **time-based 独立于使用率**：空闲即触发（cache 过期场景），而非叠加在 overflow 门控内。
- **estimate 永不阻塞**：countTokens fetch 10s 超时 + 任何失败回退本地，保证压缩路径始终返回。
- **所有新功能默认关闭/默认保持**：time-based opt-in、api_context_management 默认关、token_counting 默认 local、output 上限默认 32K——零回归。

## Usage

- `[1m]`：模型 id 加后缀（`claude-sonnet-4-6[1m]`）→ 1M opt-in + beta 头注入 + wire 剥离。
- `GYCCODE_MAX_CONTEXT_TOKENS=500000` → 裁剪有效窗口（压缩/溢出判定）。
- `token_counting.mode=auto`（推荐）→ API 精确计数带回退；`api` 严格模式。
- `llm.output_token_max` / `llm.escalate_output_token_max` → 配置输出上限与 escalate 顶。
- 规则：`.claude/rules/*.md` 或 `rules/`，frontmatter `globs`/`condition.language`/`condition.os`。
- `compaction.time_based_microcompact: { enabled: true, gap_minutes: 60, keep_recent: 5 }`。
- `compaction.api_context_management: { enabled: true, clear_thinking: true, clear_tool_uses: true, trigger_threshold: 180000, keep_target: 40000 }`。

## Verification

- 每 Task TDD（RED→GREEN）+ spec 合规审查（两阶段）+ 代码质量审查（多轮修复）。
- 最终整体审查发现 5 个集成缺口（token_counting 死配置、[1m] 泄漏 wire、time-based 门控错误、zh-CN 语言不匹配、CM beta 空合并）——全部修复并复审。
- 最终：`bun test ./src/core/util/ ./src/core/session/ ./src/gyccode/session/ ./src/gyccode/provider/` → **146 pass / 0 fail**（18 文件，261 expect）；`bun tsc --noEmit` → **exit 0**。
- 已知环境基线失败（未触碰）：UI solid-js jsxDEV（scroll-view/i18n）。

## Journey Log

- [lesson] AI SDK zod 会剥离未知 key：providerOptions 必须用 SDK 的 camelCase shape，native 才用 raw snake_case——两条运行时 wire 必须字节一致。
- [dead end] `microcompactIfNeeded` 曾恒返回 true 使完整压缩不可达并可能忙循环——用 `shouldContinueAfterMicrocompact` 纯函数锁定升级语义。
- [lesson] `[1m]` opt-in 后缀会泄漏到 wire 导致 400——客户端标记与 wire id 必须分离（parse 用于决策，strip 用于发送）。
- [lesson] Effect 4.0.0-beta.83 无 `catchAll`/`catchAllCause`，用 `Effect.catch`/`catchCause`；`Schema.Literal` 无变参，用 `Schema.Literals([...])`。
- [lesson] 新配置字段必须当天接线——`token_counting` 曾是无消费者的孤儿配置，最终审查才暴露。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md` | 设计 | 6 项差距设计 |
| `docs/compose/plans/2026-08-10-model-capability-gaps-closure.md` | 实施计划 | 9 Task TDD |
| `src/core/util/tokenizer.ts` | 1.3 | 本地 tokenizer |
| `src/gyccode/session/rules.ts` | 2.3 | 条件规则 |
| `src/gyccode/session/llm/context-management.ts` | 5.4 | API 上下文管理 |
| `src/gyccode/session/llm/output-cap.ts` | 1.4 | 输出上限纯函数 |