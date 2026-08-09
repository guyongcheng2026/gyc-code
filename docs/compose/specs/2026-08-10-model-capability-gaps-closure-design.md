# 模型能力层 5 指标复评差距补齐 — 设计

- 日期：2026-08-10
- 状态：设计稿（待实施）
- 对标对象：`E:\AI项目备份\Claude Code 源码资料\extracted-source\extracted-source\src`（Claude Code 2.1.88）
- 改进对象：`C:\Users\谷勇成\gyc-cli`（gyc-code）
- 范围：复评确认的 6 项真实差距 100% 补齐，每项超越 Claude 对应实现

## [S1] 背景与差距清单

复评（2026-08-10）确认 6 项真实差距：

| # | 差距 | 指标 | 优先级 |
|---|---|---|---|
| 1.2 | 1M 上下文缺 `[1m]` 后缀 opt-in 与有效窗口裁剪开关 | 上下文长度 | 低 |
| 1.3 | token 计数仅启发式，无精确 token 化 / API 校准 | 上下文长度 | 中 |
| 1.4 | maxOutputTokens 无模型族分级与可配上限 | 上下文长度 | 低 |
| 2.3 | 缺 `.claude/rules/*.md` 条件规则注入 | 代码理解深度 | 中 |
| 5.3 | 缺 time-based microcompact | 长会话稳定性 | 中 |
| 5.4 | 缺 API 原生上下文管理（context-management beta） | 长会话稳定性 | 中 |

用户决策：6 项全部补齐，每项超越 Claude（补齐 + 每项超越）。已逐项确认设计方向。

## [S2] 架构总览

独立模块 + 纯函数/Effect Service + config 下沉 + TDD。所有改动集中在：

```
src/core/util/tokenizer.ts              # 1.3 本地精确 token 化
src/core/util/token.ts                  # 1.3 estimate 增强 + 可选 API 校准
src/gyccode/session/llm/context-1m.ts   # 1.2 [1m] 后缀 + 有效窗口裁剪
src/gyccode/provider/transform.ts       # 1.4 maxOutputTokens 模型驱动 + 可配
src/gyccode/session/rules.ts            # 2.3 条件规则解析/匹配（新增）
src/gyccode/session/instruction.ts      # 2.3 接线（system + 就近）
src/gyccode/session/microcompact-select.ts  # 5.3 time-based 选择
src/gyccode/session/compaction.ts       # 5.3/5.4 联动与 api_context_management
src/gyccode/session/llm/request.ts      # 5.4 context-management 头 + 参数
src/core/v1/config/config.ts            # 新配置项
```

## [S3] 1.2 `[1m]` 后缀 + 有效窗口裁剪开关

### 现状
`context-1m.ts` 的 `context1MHeader(model, existingBeta)` 仅按 `model.limit.context >= 1_000_000` 自动注入 beta 头。无后缀解析、无窗口裁剪。

### 设计
- 新增 `parse1mSuffix(modelId): boolean`：模型 id 含 `[1m]`（大小写不敏感）→ 显式 1M opt-in（对齐 Claude `has1mContext`，`utils/context.ts:35`）。
- `context1MHeader` 判定扩展：context≥1M **或** `parse1mSuffix(id)` → 注入。
- 新增 `effectiveContextWindow(model, env?): number`：若 `GYCCODE_MAX_CONTEXT_TOKENS` 为正整数，则返回该值（裁剪本地决策的有效窗口），否则返回 `model.limit.context` 或默认 200K。Claude 的对应开关（`CLAUDE_CODE_MAX_CONTEXT_TOKENS`）为 ant-only；gyc 做成通用（**超越**）。
- 接线：compaction 的 `usable`/`isOverflow` 计算使用 `effectiveContextWindow`。

### 验证
- `parse1mSuffix`：`"claude-sonnet-4-6[1m]"` → true；`"claude-sonnet-4-6"` → false；大小写不敏感。
- `context1MHeader`：后缀模型（即使 context 未达 1M）也注入。
- `effectiveContextWindow`：env 未设 → model.context；env=500000 → 500000；非法值 → 忽略。

## [S4] 1.3 token 计数：本地精确 token 化 + 可选 API 校准

### 现状
`core/util/token.ts` 启发式：CJK 1.5 / JSON 2 / code 3 / 文本 4 字符每 token。无精确 token 化、无 API 校准。

### 设计
- 新增 `src/core/util/tokenizer.ts`：
  - `tokenize(input): string[]`：轻量 BPE 近似——ASCII 字母数字按常见英文 token 聚类（连续字母/数字簇）、CJK 每字 1 token、代码符号（`{ } ( ) ; : , .` 等）单 token、空白单 token。返回 token 数组（长度即精确 token 数）。
  - 与 `estimate` 兼容：`estimate(input) = tokenize(input).length`（保留现有导出名与签名，供 compaction/prune 调用）。
- `core/util/token.ts` 增强：
  - `estimate` 内部改走 `tokenizer.tokenize`。
  - 新增 `estimateWithAPI(input, { api, model })`：`token_counting.mode="api"` 时调用 Anthropic countTokens（`@ai-sdk/anthropic` beta.messages.countTokens 或直连），失败自动回退本地 `estimate`（**超越**：Claude 无本地回退，API 失败即失败）。
- config 新增：`token_counting: { mode: "local"|"api"|"auto", api_model?: string }`，默认 `local`。
- 超越点：Claude 的 roughTokenCountEstimation 仍按字节估算且依赖 API；gyc 本地精确 = 离线零成本，API 可选校准 + 回退。

### 验证
- `tokenize` 对 ASCII/CJK/代码/JSON 的 token 数与已知近似值吻合（用真实字符串断言范围）。
- `estimate` 与 `tokenize().length` 一致。
- `estimateWithAPI`：api 失败回退本地（mock 抛错 → 返回本地 estimate）。

## [S5] 1.4 maxOutputTokens：模型驱动 + 可配上限

### 现状
`transform.ts:1391` `maxOutputTokens = min(model.limit.output, outputTokenMax)`，默认 `OUTPUT_TOKEN_MAX=32K`（`transform.ts:18`）。escalate 固定 64K（`prompt.ts:1184`）。

### 设计
- config 新增 `llm: { output_token_max?: number, escalate_output_token_max?: number }`。
- `maxOutputTokens(model, outputTokenMax)`：`outputTokenMax` 由 config 提供（默认 32K，可配到模型上限）。保持 `min(limit.output, outputTokenMax)`。
- escalate：`maxOutputTokensOverride` 从固定 64K 改为 `min(model.limit.output, config.llm.escalate_output_token_max ?? 64K)`——escalate 后可达模型上限（如 128K）。
- 超越点：Claude 用硬编码 default/upper 分级表（新模型需手动更新）；gyc 用 models.dev `limit.output` 自动适配 + 用户可配。

### 验证
- 默认 32K、config 覆盖、escalate 取 `min(limit.output, escalate_max)`。
- 既有 resolveMaxOutputTokens 测试保持通过。

## [S6] 2.3 条件规则注入：globs + 条件 + 就近注入

### 现状
`instruction.ts` 仅加载 AGENTS.md/CLAUDE.md/CONTEXT.md 与 @include。无规则目录、无条件匹配。

### 设计
- 新增 `src/gyccode/session/rules.ts`：
  - `parseRuleFrontmatter(content): { globs?: string[], condition?: { language?: string, os?: string } } | undefined`：解析 YAML frontmatter（`---\n...\n---` 头），支持 `globs`（数组/单值）、`condition.language`、`condition.os`。
  - `matchRules(rules, { filepath, language, os }): Rule[]`：globs 用 picomatch/minimatch 匹配文件路径；condition.language 匹配会话语言（zh/en 归一化）；condition.os 匹配平台（win32/darwin/linux）。全部命中才注入。
  - `discoverRuleFiles(dir): Promise<string[]>`：扫描 `.claude/rules/`（含子目录）+ 项目根 `rules/` 下的 `*.md`。
- `instruction.ts` 接线：
  - `system()`：将匹配当前工作区路径（无具体文件 → globs 命中任意路径或无条件）的规则并入 system prompt，格式 `Rules from: <path>\n<content>`。
  - `resolve()`（文件 read/edit 就近）：对目标文件路径匹配的规则追加到返回数组（**超越**：Claude 规则只在 system 层，不就近注入）。
- 超越点：Claude `processMdRules` 仅按 globs 区分条件（`utils/claudemd.ts:688`）；gyc 增加 language/os 条件 + 就近注入。

### 验证
- frontmatter 解析：globs 数组/单值、condition、无 frontmatter（视为无条件）。
- matchRules：路径 globs 命中/不命中、language 条件、os 条件、组合条件。
- 就近注入：resolve 返回含规则条目。

## [S7] 5.3 time-based microcompact：可配阈值 + 联动

### 现状
`microcompact-select.ts` 仅使用率型（85% 阈值）。无时间触发。

### 设计
- `microcompact-select.ts` 新增 `selectTimeBasedParts(messages, { gapMinutes, keepRecent }): MicrocompactBlock[]`：
  - 找到最后一条主循环 assistant 消息时间戳（`state.time` 或消息元数据）。
  - `now - lastAssistantAt >= gapMinutes` 时：清中间 tool 输出（保留 cache 前缀 `CACHE_PREFIX_KEEP` + 最近 `keepRecent` 条），返回待 compact parts（复用现有结构）。
  - 未超阈值 → 返回空数组。
- `compaction.ts` `microcompactIfNeeded` 扩展：
  1. 先查 time-based 条件（gap 超阈值且 `config.compaction.time_based_microcompact.enabled`）→ 触发；
  2. 否则查使用率（≥85%）→ 触发；
  3. 联动：time-based 后若仍超限继续走使用率型/完整压缩。
- config 新增：`compaction.time_based_microcompact: { enabled?: boolean, gap_minutes?: number, keep_recent?: number }`。
- 超越点：Claude time-based 由 GrowthBook 远程配置（`timeBasedMCConfig.ts`，服务器端）；gyc 本地可配、无远程依赖。

### 验证
- `selectTimeBasedParts`：gap 超阈值 → 清中间；未超 → 空；保留前缀/尾部。
- `microcompactIfNeeded` 联动：time-based 触发后继续使用率判断。

## [S8] 5.4 API 原生上下文管理：beta 头 + 参数，通用

### 现状
`request.ts` 无 context-management beta，无 context_management 参数。仅客户端 microcompact。

### 设计
- `request.ts` 增强（`prepare`）：
  - 当 `config.compaction.api_context_management.enabled` 且 provider 属 Anthropic 系（复用 `ANTHROPIC_BETA_PROVIDERS`）：
    - 将 `context-management-2025-06-27` 合并进 `anthropic-beta`（逗号去重，与 context1MHeader 同机制）。
    - 组装 `context_management` 参数到 `options`：
      ```ts
      {
        context_management: {
          edits: [
            ...(clear_thinking ? [{ type: "clear_thinking_20251015", keep: { type: "thinking_turns", value: thinking_turns } }] : []),
            ...(clear_tool_uses ? [{ type: "clear_tool_uses_20250919", trigger: { type: "token_threshold", value: trigger }, clear_at_least: { type: "token_count", value: trigger - keep_target }, exclude_tools: [...] }] : [])
          ]
        }
      }
      ```
  - 默认关闭（避免不支持端点 400）。
- config 新增：`compaction.api_context_management: { enabled?: boolean, trigger_threshold?: number, keep_target?: number, clear_thinking?: boolean, clear_tool_uses?: boolean, thinking_turns?: number }`。
- 本地 microcompact 保留为降级（API 不支持时仍本地清）。
- 超越点：Claude clear_tool_uses 为 ant-only env 开关（`apiMicrocompact.ts:90` "Tool clearing strategies are ant-only"）；gyc 通用 config 可用。

### 验证
- 仅 Anthropic 系注入头与参数；非 Anthropic 不注入。
- 各 config 开关组合生成正确 edits 数组。
- 默认关闭不注入。

## [S9] 验证策略

- 每项独立 TDD：先写测试 → RED → 最小实现 → GREEN → 回归。
- 全量：`bun tsc --noEmit` 零错误；llm/session/core 目录测试通过；既有 92+ 测试不回归。
- 已知失败（环境基线）：`src/ui/components/scroll-view.test.ts`、`src/ui/context/i18n.test.ts`（solid-js jsxDEV）不触碰。
- 每项独立 commit，post-commit 自动 push。

## [S10] 范围与排除

- 不做：模型本身更换、真实 tokenizer 库依赖（BPE 近似自实现）、GrowthBook 远程配置体系。
- 改动边界：仅上述文件；不触碰 16 个历史遗留未提交文件（sqlite/tui 等）。
- 配置默认保守：time-based、api_context_management 默认关闭；token_counting 默认 local；output_token_max 默认 32K 保持现状。