# gyc cli vs Claude Code 2.1.88 — 模型能力层五指标全面评估（第二轮）

**评估日期**: 2026-08-10
**对照源码**: `E:\AI项目备份\Claude Code 源码资料\extracted-source\extracted-source\src`（1902 文件）
**评估对象**: `c:\Users\谷勇成\gyc-cli\src\gyccode`
**分级**: P0(阻断) / P1(重要) / P2(建议)
**目标**: 100% 达到 Claude Code 对应能力并超越

---

## 总览

| 指标 | Claude Code | gyc cli | 结论 |
|------|------------|---------|------|
| 1. 上下文长度 | 200K/1M + usage 锚定估算 + 分级输出上限 + 有效窗口 + 三级告警 | 200K/1M + usage 锚定估算 + 本地精确 tokenizer + 通用上限 | **基本持平**，gap：三级告警/P1、per-block 估算/P1、槽位预留/P2 |
| 2. 代码理解深度 | LSPTool 9 操作 + git-ignore 过滤 + 结果截断 + 诊断回灌 | LSP 9 操作 + 38 内置 LSP + 编辑后诊断注入 + 10MB 护栏 | **超越**，gap：git-ignore 过滤/P2、结果截断/P2 |
| 3. 推理能力 | Anthropic 自适应思考 + ultrathink + 默认开启 + thinkback | 多 provider 推理矩阵 + 关键词升档 + 加密推理 + 流式落盘 | **超越**，gap：默认开启/P1、thinking 预算/P2 |
| 4. 多语言支持 | 插件式 LSP + LanguagePicker | 38 内置 LSP + 121 扩展名映射 + 自定义注入 | **显著超越**，无 gap |
| 5. 长会话稳定性 | 全量压缩 + 三路微压缩 + 会话记忆后台分叉 + 熔断 + 缓存破坏检测 + 部分压缩 | 全量压缩 + 双路微压缩 + 记忆快速路径 + 熔断 + 空闲超时 + 工具停滞检测 | **超越**，gap：缓存破坏检测/P1、部分压缩/P2、压缩后清理/P2 |

---

## 指标 1：上下文长度

### Claude Code 实现（全面）
- **默认窗口**：`utils/context.ts:9` `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`
- **1M 上下文**：`[1m]` 后缀（`utils/context.ts:35-40` has1mContext）+ `context-1m-2025-08-07` beta 头（`constants/betas.ts:6`）
- **分级输出上限**：`utils/context.ts:149-210` `getModelMaxOutputTokens()` — Opus 4.6: 64K/128K，Sonnet 4.6: 32K/128K；`MAX_OUTPUT_TOKENS_DEFAULT=32K` / `MAX_OUTPUT_TOKENS_UPPER_LIMIT=64K`（行 15-16）
- **槽位预留优化**：`utils/context.ts:24-25` `CAPPED_DEFAULT_MAX_TOKENS = 8000`（BQ p99 4,911 tokens）→ 触顶后 `ESCALATED_MAX_TOKENS = 64K`（行 25）
- **有效窗口**：`services/compact/autoCompact.ts:33-49` `getEffectiveContextWindowSize()` = 窗口 − min(输出上限, 20K 摘要预留)；`AUTOCOMPACT_BUFFER_TOKENS = 13K`（行 62）；`CLAUDE_CODE_AUTO_COMPACT_WINDOW` 环境覆盖
- **分级告警阈值**：`autoCompact.ts:63-65` `WARNING_THRESHOLD_BUFFER_TOKENS=20K` / `ERROR_THRESHOLD_BUFFER_TOKENS=20K` / `MANUAL_COMPACT_BUFFER_TOKENS=3K`
- **估算**：`utils/tokens.ts:226` `tokenCountWithEstimation()` — usage 锚定 + 增量估算，并行工具调用拆分处理（同 message.id 回溯首兄弟记录）
- **API 精确计数**：`services/tokenEstimation.ts:140-201` `countMessagesTokensWithAPI()` + Haiku 4.5 兜底（行 245-325）+ Bedrock CountTokensCommand（行 437-495）
- **逐块估算**：`tokenEstimation.ts:391-435` `roughTokenCountEstimationForBlock()` — text→chars/4、images→2000、tool_use→jsonStringify、thinking→text
- **1M 访问控制**：`check1mAccess.ts:11-43` 13 种 `ExtraUsageDisabledReason`；`contextWindowUpgradeCheck.ts` 1M 升级引导；`CLAUDE_CODE_DISABLE_1M_CONTEXT`

### gyc cli 实现（全面）
- 1M beta 头：`session/llm/context-1m.ts:17`；`parse1mSuffix`：21 行；`context1MHeader`：101 行
- **通用窗口上限**：`GYCCODE_MAX_CONTEXT_TOKENS`（`context-1m.ts:41`）— 全用户开放，优于 Claude ant-only
- **有效窗口**：`session/overflow.ts:11-22` `usable()` = 窗口 − 20K 预留；`isOverflow`：24 行
- **本地 tokenizer**：`core/util/tokenizer.ts`（CJK 1 字 1 token，ASCII 词簇，代码符号单 token，线性时间）— **超越 Claude 的 chars/4 粗估**
- **API 计数**：`core/util/token.ts` `estimateWithAPI()` + `compaction.ts:248-283` `makeCountTokensAdapter()`（10s 超时，失败回退本地）
- **usage 锚定**：`compaction.ts:110` `findUsageAnchor()` 读取 step-finish part 的 input+cache+output+reasoning
- **输出上限**：`llm/output-cap.ts` `resolveOutputTokenMax`（flag > config > 32K）+ `escalateOutputMax`（min(limit.output, 64K)）
- **记忆快速路径**：`compaction.ts:151-157` `buildMemorySummary()` — hermes 记忆拼摘要免 LLM 调用

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P1 | Claude `autoCompact.ts:62-65` 分级告警阈值 / `calculateTokenWarningState()`：93-145 | gyc 无「分级告警」状态机：无 warning/error/blocking 三级缓冲告警，无法提前感知上下文将满（只剩 ≤20K/13K/3K 时提示） | 在 overflow.ts 增加 `calculateTokenWarningState()`，输出 percentLeft + isAboveWarning/Error/Blocking 三级布尔，供 TUI/CLI 展示 |
| P1 | Claude `tokenEstimation.ts:391-435` per-block 估算 | gyc 的 `Token.estimate` 对整段 JSON.stringify 计数，image/tool_use/thinking 块混合时无法区分（image 按字符算严重低估） | 增加 per-block token 估算：text→本地 tokenizer、image→2000、tool_use→JSON 长度、thinking→文本，镜像 Claude 结构 |
| P2 | Claude `context.ts:24-25` 槽位预留（8K→64K） | gyc 无「常规 8K → 触顶 64K」槽位预留优化：深度推理长输出场景首 token 后 max_tokens 无动态策略 | 可选：默认 output max 收窄到 8K，finish=length 时 escalate 到 64K（gyc 已有 escalateOutputMax 基础，需加默认槽位） |
| P2 | Claude `contextWindowUpgradeCheck.ts` 1M 升级引导 | gyc 无 `[1m]` 升级引导提示（检测到超长会话主动建议用 1M 模型） | 可选：context 超 70% 且模型支持 1M 时提示升级 |

### 结论：**基本持平**。核心估算能力已对齐（usage 锚定 + 本地精确 tokenizer 超越），主要缺分级告警（P1）与 per-block 估算（P1）。

## 指标 2：代码理解深度

### Claude Code 实现（全面）
- **LSPTool 9 操作**：`tools/LSPTool/LSPTool.ts` goToDefinition/findReferences/hover/documentSymbol/workspaceSymbol/goToImplementation/prepareCallHierarchy/incomingCalls/outgoingCalls
- **10MB 护栏**：`LSPTool.ts:53` `MAX_LSP_FILE_SIZE_BYTES = 10_000_000`；`maxResultSizeChars = 100_000`（行 130）
- **git-ignore 过滤**：`LSPTool.ts:556` `filterGitIgnoredLocations()` 批量 `git check-ignore`，`BATCH_SIZE = 50`
- **符号上下文**：`symbolContext.ts:21` `getSymbolAtPosition()` 提取光标处符号（64KB 读取窗口）
- **诊断注册表**：`services/lsp/LSPDiagnosticRegistry.ts` + `passiveFeedback.ts` 诊断被动反馈
- **LSP 推荐**：`hooks/useLspPluginRecommendation.tsx` 检测语言推荐插件
- **格式器**：`formatters.ts`（592 行）9 操作各自解析：SymbolKind 26 枚举、groupByFile、callHierarchy
- **协议位置转换**：`LSPTool.ts:432` 1-based → 0-based 位置
- **defer/concurrency**：`isLsp: true, shouldDefer: true, isReadOnly, isConcurrencySafe: true`
- **文件同步**：didOpen 后发请求（`LSPTool.ts:258-278`）

### gyc cli 实现（全面）
- **LSP 9 操作**：`tool/lsp.ts:15-25` 同名 9 操作，外部目录权限校验（行 49）
- **10MB 护栏（已加）**：`tool/lsp.ts:11` `MAX_LSP_FILE_SIZE_BYTES = 10_000_000`（本轮新增，对齐 Claude）
- **38 内置 LSP**：`lsp/server.ts:88-1968`（Deno/TS/Vue/ESLint/Oxlint/Biome/Gopls/Rubocop/Ty/Pyright/ElixirLS/ZLS/C#/Razor/F#/SourceKit/RustAnalyzer/Clangd/Svelte/Astro/JDTLS/KotlinLS/YamlLS/LuaLS/Intelephense/Prisma/Dart/OCaml/BashLS/TerraformLS/TexLab/DockerfileLS/Gleam/Clojure/Nixd/Tinymist/HLS/JuliaLS）**零插件开箱即用，超越 Claude 插件门槛**
- **编辑后诊断注入**：`tool/write.ts:86`、`tool/edit.ts:220`、`tool/apply_patch.ts:283` — 等价 Claude 被动反馈
- **扩展名映射**：`lsp/language.ts:1-121` 121 扩展名 → languageId
- **自定义 LSP**：`lsp/lsp.ts:160-181` config 注入任意 server
- **read warm-up**：`tool/read.ts:127-130` 后台 fork `lsp.touchFile()`

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P2 | Claude `LSPTool.ts:556` filterGitIgnoredLocations | gyc LSP 结果不过滤 git-ignore 文件，长尾仓库可能返回无关位置 | 在 `tool/lsp.ts` 结果格式化后加 git check-ignore 批量过滤（BATCH=50） |
| P2 | Claude `LSPTool.ts:130` maxResultSizeChars=100K | gyc 无 LSP 结果大小上限，超大结果可能撑爆单条消息 | 增加 100K 字符截断 + 截断标记 |
| P3 | Claude `symbolContext.ts` 符号上下文 | gyc 跳转把「文件+行+列」传给模型，但无光标符号名 | 可选：跳转请求前取符号名附加到结果 |

### 结论：**超越**。38 内置 LSP + 编辑后诊断注入已全面超越；P2 项（git-ignore 过滤、结果截断）为锦上添花。

## 指标 3：推理能力

### Claude Code 实现（全面）
- **ThinkingConfig**：`utils/thinking.ts:10-13` adaptive / enabled(budgetTokens) / disabled
- **ultrathink 关键词**：`thinking.ts:29` `hasUltrathinkKeyword` → 思考预算升级，GrowthBook 灰度 + 构建门控
- **模型能力探测**：`thinking.ts:90` `modelSupportsThinking`（Claude 4+ 全支持）、`:113` `modelSupportsAdaptiveThinking`（opus-4-6/sonnet-4-6）
- **默认开启**：`thinking.ts:146` `shouldEnableThinkingByDefault` 除非显式禁用；`MAX_THINKING_TOKENS` 环境变量覆盖
- **思考预算**：`context.ts:219-221` `getMaxThinkingTokensForModel()` = upperLimit - 1
- **thinkback 回放**：`commands/thinkback/thinkback.tsx`（60KB）
- **思考流**：`thinking-start/thinking-delta/thinking-end` 流事件

### gyc cli 实现（全面）
- **变体矩阵**：`provider/transform.ts:700+` `variants()` — 15+ provider 推理档位：
  - Anthropic 自适应（4.7+ 省略显式块）、4.6 系 efforts；OpenAI reasoning_effort 含 xhigh 版本化；Google thinkingConfig/Level/Budget；Bedrock budgetTokens；Kimi/MiniMax/GLM/120Grok-3-mini/SAP 等
- **关键词升档**：`session/thinking-keywords.ts` think→high、think harder→xhigh、ultrathink→max；`resolveThinkingVariant` 选最强可用档位 — **超越 Claude ant-only ultrathink 门控**
- **推理流落盘**：`session/processor.ts:281-313` reasoning-start/delta/end
- **加密推理**：OpenAI multi-turn 加密 reasoningSummary — **超越**
- **采样参数**：`transform.ts:505-545` per-model temperature/topP/topK

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P1 | Claude `thinking.ts:146` shouldEnableThinkingByDefault | gyc 依赖 agent/模型变体显式配置；模型支持自适应思考时无「默认自动开启」逻辑，用户不配 variant 则走非思考路径 | 在 request prep 增加：模型 support adaptive/thinking 时默认启用（除非 config.user 显式关闭） |
| P2 | Claude `context.ts:219-221` 思考预算 = 输出上限−1 | gyc 无面向思考模型的显式思考预算字段（依赖 provider 默认） | 可选：支持 `thinking.budget_tokens` 配置注入 adaptive 模型 |
| P3 | Claude `commands/thinkback/` | gyc 无思考回放命令 | 低优先，TUI 已有 reasoning 展示 |

### 结论：**超越**。多 provider 矩阵 + 关键词升档 + 加密推理远超 Claude 仅 Anthropic；P1 默认开启为行为对齐缺口。

## 指标 4：多语言支持

### Claude Code 实现
- LSP 仅插件式（`services/lsp/config.ts:11`）；`components/LanguagePicker.tsx` 交互选择
- 工具层语言无关（grep/glob/bash）

### gyc cli 实现
- `src/gyccode/lsp/language.ts:1-121`：**121 扩展名 → languageId 映射**（含 .vue/.svelte/.astro/.gleam/.typ/.nix/.tf/.zon 长尾）
- **38 内置 LSP server**：覆盖 TS/JS/Vue/Svelte/Astro/Go/Rust/C#/F#/Java/Kotlin/Swift/C-C++/Ruby/Elixir/Zig/PHP/Dart/OCaml/Bash/Terraform/LaTeX/Docker/Gleam/Clojure/Nix/Typst/Haskell/Julia/YAML/Lua/Prisma
- 自定义 LSP：`lsp/lsp.ts:160-181` config 注入任意 server（command/extensions/initialization）

### 差距
无 P0/P1/P2 差距。**显著超越**。38 内置 server + 自动安装 + 自定义注入 + 121 映射，开箱覆盖主流与长尾语言；Claude 依赖插件生态。

---

## 指标 5：长会话稳定性

### Claude Code 实现（全面）
- **自动压缩**：`autoCompact.ts:241` `autoCompactIfNeeded`；熔断 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`（行 70）
- **压缩顺序**：先 `trySessionMemoryCompaction`（行 288）→ 失败再 `compactConversation`；部分压缩 `partialCompactConversation`（行 772，pivot 方向 from/up_to）
- **微压缩三路**：`microCompact.ts:253` 时间触发 + 缓存微压缩（ant-only）+ 遗留路径；`COMPACTABLE_TOOLS`（行 41-50）
- **API 原生**：`apiMicrocompact.ts` context-management beta 服务端清理 thinking/tool_use；`DEFAULT_MAX_INPUT_TOKENS=180K` / `DEFAULT_TARGET_INPUT_TOKENS=40K`
- **会话记忆**：`services/SessionMemory/sessionMemory.ts` 后台 fork 子代理维护 markdown；`EXTRACTION_WAIT_TIMEOUT_MS=15s`；阈值 10K/5K/3 tool calls
- **缓存破坏检测**：`services/api/promptCacheBreakDetection.ts`（>5% cache read 下降 + >2K tokens 告警）
- **token 预算**：`utils/tokenBudget.ts` +500k/use 2M 自然语言；`checkTokenBudget()` 收益递减检测
- **响应式溢出**：`withRetry.ts:384-430` 溢出时 `max_tokens = max(3000, availableContext)` 调整
- **压缩后清理**：`postCompactCleanup.ts` 重置 microcompactState/contextCollapse/caches

### gyc cli 实现（全面）
- **全量压缩**：`compaction.ts:502-725` 尾部保留（tail_turns+preserve_recent_tokens）、前次摘要链式继承、插件钩子、自动续跑、溢出回放
- **熔断**：`MAX_CONSECUTIVE_COMPACTION_FAILURES = 3`（行 46）+ `consecutiveCompactionFailures` — 与 Claude 等价
- **微压缩双路**：`microcompact-select.ts` 使用率 85% + 时间触发（gap_minutes/keep_recent）；skill 输出保护
- **API 上下文管理**：`llm/context-management.ts` clear_thinking + clear_tool_uses，**全用户可配（Claude ant-only）— 超越**
- **记忆快速路径**：`compaction.ts` `buildMemorySummary()` — hermes 记忆免 LLM 摘要调用 — **对齐 Claude trySessionMemoryCompaction**
- **记忆后台抽取**：`memory/extract.ts` + `extraction-runner.ts`（forkIn 后台）；`memory/dream.ts` 记忆整合 — **超越（Claude 无 dream 整合）**
- **流空闲超时**：`llm-timeout.ts:21` 300s 可配置 — **Claude 无，超越**
- **工具停滞检测**：`tool-stall.ts` 无文本+重复/失败工具 — **Claude 无，超越**
- **重试**：`retry.ts:26-34` 指数退避 + retry-after + 5 分钟放弃 + 5 次上限 — 近似
- **token 预算**：`token-budget.ts` 简写 + 3 种自然语言 + 收益递减 — 对齐并超越（Claude 无收益递减保护）
- **预算结转**：`prompt.ts` 压缩后重置 continuations/lastIncrement — 对齐 Claude 跨边界结转意图

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P1 | Claude `promptCacheBreakDetection.ts` | gyc 无提示缓存破坏检测：压缩/系统提示变更后模型看不到缓存命中率变化（成本可观测性） | 在 session/llm.ts 事件流记录 cache read tokens，压缩/提示变更后对比基线，降幅>5%+2K 时告警 |
| P2 | Claude `partialCompactConversation.ts` pivot 部分压缩 | gyc 全量压缩只能压整个会话，无法围绕某条 pivot 消息部分压缩（保留 pivot 前后不同比例） | 可选：`select()` 支持 pivot 模式 |
| P2 | Claude `postCompactCleanup.ts` 压缩后清理 | gyc 压缩后无显式重置会话缓存（systemPromptSections/上下文缓存等） | 可选：压缩成功后清理会话级缓存避免陈旧状态 |
| P2 | Claude `microCompact.ts` COMPACTABLE_TOOLS | gyc microcompact 已含类似列表但未核对是否含全部 8 工具 | 核对 microcompact-select 覆盖 Read/Shell/Grep/Glob/WebSearch/WebFetch/Edit/Write |

### 结论：**超越**。熔断/微压缩双路/记忆快速路径/API 上下文管理全开放/空闲超时/工具停滞/dream 整合均已达或超 Claude；缓存破坏检测为 P1 成本可观测性缺口。

---

## 修复路线（达到 100% 对齐并超越）

| 顺序 | 项 | 指标 | 级别 | 工作量 | 状态 |
|------|-----|------|--------|--------|------|
| 1 | 三级上下文告警状态机（warning/error/blocking） | 1 | P1 | 0.3 天 | 待做 |
| 2 | per-block token 估算（text/image/tool_use/thinking 分块） | 1 | P1 | 0.4 天 | 待做 |
| 3 | 模型自适应思考默认开启 | 3 | P1 | 0.3 天 | 待做 |
| 4 | 提示缓存破坏检测 | 5 | P1 | 0.4 天 | 待做 |
| 5 | LSP git-ignore 位置过滤 | 2 | P2 | 0.2 天 | 待做 |
| 6 | LSP 结果 100K 截断 | 2 | P2 | 0.2 天 | 待做 |
| 7 | 输出上限槽位预留（8K→64K 动态） | 1 | P2 | 0.2 天 | 待做 |
| 8 | 思考预算显式配置 | 3 | P2 | 0.1 天 | 待做 |
| 9 | 压缩后会话缓存清理 | 5 | P2 | 0.2 天 | 待做 |
| 10 | [1m] 升级引导提示 | 1 | P2 | 0.1 天 | 待做 |

**已超越项（保持）**：本地精确 tokenizer、GYCCODE_MAX_CONTEXT_TOKENS 全开放、38 内置 LSP + 编辑后诊断、多 provider 推理矩阵 + 关键词升档 + 加密推理、API 上下文管理全开放、流空闲超时、工具停滞检测、dream 记忆整合、收益递减预算检测、记忆快速压缩路径。
