# gyc cli vs Claude Code 2.1.88 — 模型能力层五指标差距评估

**评估日期**: 2026-08-10
**对照源码**: `E:\AI项目备份\Claude Code 源码资料\extracted-source\extracted-source\src`（1902 文件）
**评估对象**: `c:\Users\谷勇成\gyc-cli\src\gyccode`
**分级**: P0(阻断) / P1(重要) / P2(建议)

---

## 总览

| 指标 | Claude Code | gyc cli | 结论 |
|------|------------|---------|------|
| 1. 上下文长度 | 200K 默认 + 1M beta + usage 锚定估算 | 200K 默认 + 1M beta + 本地/API 估算 | **持平**，估算精度有 P1 差距 |
| 2. 代码理解深度 | LSPTool 9 操作 + 插件式 LSP + 诊断注册表 | LSP 9 操作 + **38 内置 LSP** + 编辑后诊断注入 | **超越** |
| 3. 推理能力 | Anthropic 自适应思考 + ultrathink 关键词 | 多 provider 推理变体（Anthropic/OpenAI/Google/Bedrock/Kimi/xAI/GLM） | **超越**，缺关键词升级（P2） |
| 4. 多语言支持 | 插件式 LSP + LanguagePicker | 38 内置 LSP server + 100+ 扩展名映射 | **显著超越** |
| 5. 长会话稳定性 | 自动压缩 + 微压缩 + 会话记忆压缩 + 熔断 | 全量压缩 + 微压缩 + API 上下文管理 + 熔断 + 空闲超时 | **持平**，缺会话记忆快速路径（P1） |

---

## 指标 1：上下文长度

### Claude Code 实现
- 默认窗口 200K：`utils/context.ts:9` `MODEL_CONTEXT_WINDOW_DEFAULT = 200_000`
- 1M 上下文：`[1m]` 后缀（`utils/context.ts:35-40` has1mContext）+ `context-1m-2025-08-07` beta 头（`constants/betas.ts:6`），`services/api/claude.ts:1543-1546` 注入
- **权威测量**：`utils/tokens.ts:226` `tokenCountWithEstimation()` — 以最近一次 API 响应 usage（input+output+cache）为锚点，只对锚点之后新增消息做粗略估算；特别处理并行工具调用拆分记录（同 message.id 回溯到首个兄弟记录，避免漏计交错的 tool_result）
- 有效窗口：`services/compact/autoCompact.ts:33-49` = 窗口 − min(输出上限, 20K 摘要预留)；自动压缩阈值 = 有效窗口 − 13K 缓冲（`AUTOCOMPACT_BUFFER_TOKENS`，行 62）
- 窗口上限覆盖：`CLAUDE_CODE_MAX_CONTEXT_TOKENS`（仅 ant 内部用户，`utils/context.ts:59-67`）

### gyc cli 实现
- 1M beta 头：`src/gyccode/session/llm/context-1m.ts:17` 同名头；`parse1mSuffix`（行 21）支持 `[1m]` 后缀；`context1MHeader`（行 101）按 provider 传输类型注入
- 窗口上限覆盖：`GYCCODE_MAX_CONTEXT_TOKENS`（行 41）— **对所有用户开放，优于 Claude 的 ant-only**
- 有效窗口：`src/gyccode/session/overflow.ts:11-22` `usable()` = 窗口 − 20K 预留；`isOverflow`（行 24）用最近 assistant 消息的真实 tokens（API 返回值）判断 — 与 Claude 的 usage 锚定思路一致
- 估算：`src/gyccode/session/compaction.ts:371-399` `estimate()` — 全量 JSON 序列化后经本地 BPE 近似分词器（`src/core/util/tokenizer.ts`，CJK 1 字 1 token）或 Anthropic count_tokens API（行 248-283 适配器，失败回退本地）

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P1 | gyc `compaction.ts:375-379`（estimate 全量 JSON.stringify + 重分词）vs Claude `tokens.ts:226`（usage 锚定 + 增量估算） | 微压缩/尾部选择路径每次都全量重估：① JSON 语法字符（引号/键名）引入系统性高估；② 长会话 O(n) 重复分词，开销随会话线性增长 | 增加 usage 锚定估算：以最近带 usage 的 assistant 消息为锚点（`tokens.input+output+cache.read+cache.write`），只对锚点之后消息做本地估算 |
| P2 | Claude `tokens.ts:79-112` finalContextTokensFromLastResponse（跨压缩边界的预算结转） | gyc token-budget（`session/token-budget.ts`）未处理压缩边界：压缩后 used 计数不重置/结转 | 压缩成功后按压缩前最终窗口递减预算剩余 |

---

## 指标 2：代码理解深度

### Claude Code 实现
- `tools/LSPTool/LSPTool.ts`：9 个操作（goToDefinition/findReferences/hover/documentSymbol/workspaceSymbol/goToImplementation/prepareCallHierarchy/incomingCalls/outgoingCalls），10MB 文件大小护栏（行 53）
- LSP server **仅通过插件提供**：`services/lsp/config.ts:11` "LSP servers are only supported via plugins, not user/project settings"
- `services/lsp/LSPDiagnosticRegistry.ts` + `passiveFeedback.ts`：诊断被动反馈给模型
- `hooks/useLspPluginRecommendation.tsx`：检测项目语言并推荐安装 LSP 插件
- 基础搜索：GrepTool(ripgrep) / GlobTool(fast-glob) / FileReadTool

### gyc cli 实现
- `src/gyccode/tool/lsp.ts:11-21`：**同样 9 个操作**，含外部目录权限校验（行 49）
- `src/gyccode/lsp/server.ts`：**38 个内置 LSP server**（行 88-1968）：Deno/TypeScript/Vue/ESLint/Oxlint/Biome/Gopls/Rubocop/Ty/Pyright/ElixirLS/ZLS/C#/Razor/F#/SourceKit/RustAnalyzer/Clangd/Svelte/Astro/JDTLS/KotlinLS/YamlLS/LuaLS/Intelephense/Prisma/Dart/OCaml/BashLS/TerraformLS/TexLab/DockerfileLS/Gleam/Clojure/Nixd/Tinymist/HLS/JuliaLS — 含自动下载/安装逻辑，**零插件开箱即用，超越 Claude 的插件门槛**
- **编辑后诊断注入**：`tool/write.ts:86`、`tool/edit.ts:220`、`tool/apply_patch.ts:283` 在每次写入后调用 `lsp.diagnostics()` 把编译错误回灌给模型 — 等价于 Claude 的被动诊断反馈
- grep/glob/read 工具齐备（`tool/grep.ts`、`tool/glob.ts`、`tool/read.ts`）

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P2 | Claude `LSPTool.ts:53` MAX_LSP_FILE_SIZE_BYTES=10MB | gyc `tool/lsp.ts` 无文件大小护栏，超大文件可能拖垮 LSP | 加 10MB 上限检查 |
| P2 | Claude `hooks/useLspPluginRecommendation.tsx` | gyc 内置 server 已覆盖主流语言，但无"检测到未安装 server 时提示"的引导 | 可选：`lsp.status` 输出缺失 server 提示 |

---

## 指标 3：推理能力

### Claude Code 实现
- `utils/thinking.ts:10-13`：ThinkingConfig = adaptive / enabled(budgetTokens) / disabled
- 关键词触发：`hasUltrathinkKeyword`（行 29）检测 "ultrathink"；ULTRATHINK 构建门控 + GrowthBook 灰度（行 19-24）
- 模型能力探测：`modelSupportsThinking`（行 90，Claude 4+ 全支持）、`modelSupportsAdaptiveThinking`（行 113，opus-4-6/sonnet-4-6）
- 默认开启：`shouldEnableThinkingByDefault`（行 146）除非显式禁用；`MAX_THINKING_TOKENS` 环境变量覆盖
- 思考预算 = 输出上限 − 1：`utils/context.ts:219-221`
- thinkback 回放：`commands/thinkback/thinkback.tsx`（60KB）——实为**插件命令**（安装 `thinkback@claude-code-marketplace` 插件并播放“年度回顾”动画 year_in_review），**并非思考过程回放**（2026-08-11 经源码核实）

### gyc cli 实现
- `src/gyccode/provider/transform.ts:700+` `variants()`：**跨 provider 推理变体矩阵** —
  - Anthropic 现代自适应思考（行 628-637，claude 4.7+ 省略显式 thinking 块）、4.6 系 efforts low/medium/high/max（行 643-655）
  - OpenAI reasoning_effort 分档含 xhigh（行 557-625，按发布日期版本化，旧模型不发 `none` 避免 400）
  - Google thinkingConfig/thinkingLevel/thinkingBudget（行 661-698，gemini-3 分档）
  - Bedrock reasoningConfig budgetTokens（行 1019-1031）、Kimi adaptive（行 743-748）、xAI（行 766-776）、GLM-5.2（行 724-739）、MiniMax-M3（行 707-721）
- 推理流处理：`session/processor.ts:281-313` reasoning-start/delta/end 完整落盘
- **多 provider 覆盖远超 Claude（仅 Anthropic 系）**

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P2 | Claude `thinking.ts:29` ultrathink 关键词 → 思考预算升级 | gyc 无提示词关键词→推理档位升级映射（"think hard/think harder/ultrathink" 不会自动升档），仅在 skill bundle 文本中出现 | 在 `session/prompt.ts` 或 request prep 中解析关键词并映射到 variant effort |
| - | Claude `commands/thinkback/` | 误标：实为**插件/动画命令**（安装 thinkback 插件播放“年度回顾”动画），非思考回放 | 移除（gyc TUI 已有 reasoning 展示；动画命令价值低，依赖 Claude 插件市场生态） |

---

## 指标 4：多语言支持

### Claude Code 实现
- LSP 仅插件式（见指标 2）；`components/LanguagePicker.tsx` 交互选择
- 工具层语言无关（grep/glob/bash）

### gyc cli 实现
- `src/gyccode/lsp/language.ts:1-121`：**100+ 扩展名 → languageId 映射**（含 .vue/.svelte/.astro/.gleam/.typ/.nix/.tf/.zon 等长尾）
- 38 个内置 LSP server 覆盖：TS/JS/Vue/Svelte/Astro/Go/Rust/Python(C 系双 server：Ty+Pyright)/C#/F#/Java/Kotlin/Swift/C-C++(Clangd)/Ruby/Elixir/Zig/PHP/Dart/OCaml/Bash/Terraform/LaTeX/Docker/Gleam/Clojure/Nix/Typst/Haskell/Julia/YAML/Lua/Prisma
- 自定义 LSP：`lsp/lsp.ts:160-181` 支持 config 注入任意 server（command/extensions/initialization）

### 结论
**显著超越**。Claude Code 的多语言深度依赖用户安装插件；gyc 内置 38 server + 自动安装 + 自定义注入，开箱覆盖主流与长尾语言。无 P0/P1 差距。

---

## 指标 5：长会话稳定性

### Claude Code 实现
- 自动压缩：`autoCompact.ts:241` `autoCompactIfNeeded`；**熔断器**：连续失败 3 次停止尝试（行 70 `MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES = 3`，注释说明曾单日浪费 25 万 API 调用）
- 压缩顺序：先试**会话记忆压缩**（行 288 `trySessionMemoryCompaction`，用已维护的 session memory 文件替代 LLM 摘要调用）→ 失败再全量 `compactConversation`
- 微压缩：`microCompact.ts:41-50` 仅清理 COMPACTABLE_TOOLS（Read/Shell/Grep/Glob/WebSearch/WebFetch/Edit/Write）输出；时间触发（缓存过期后）；缓存微压缩（ant-only）
- API 原生上下文管理：`apiMicrocompact.ts`（context-management beta，服务端清理 thinking/tool_use）
- 会话记忆：`services/SessionMemory/sessionMemory.ts` 后台 fork 子代理周期性维护 markdown 笔记，不打断主会话
- token 预算：`utils/tokenBudget.ts` `+500k` 简写 / "use 2M tokens" 自然语言 → 续跑消息（行 66-73）
- 缓存破坏检测：`services/api/promptCacheBreakDetection.ts`

### gyc cli 实现
- 全量压缩：`session/compaction.ts:502-725` — 尾部保留（tail_turns + preserve_recent_tokens 预算，行 153-158/401-452）、前次摘要链式继承（行 549）、插件钩子（experimental.session.compacting，行 556）、自动续跑（行 686-716）、溢出回放（行 523-539）
- **熔断器**：`MAX_CONSECUTIVE_COMPACTION_FAILURES = 3`（行 46）+ `consecutiveCompactionFailures`（行 141-151）— 与 Claude 等价
- 微压缩：`microcompact-select.ts` 使用率触发（85%，行 14）+ 时间触发（行 65-119，含"消息数不足时放弃前缀保护"的刻意偏离注释）；skill 输出保护（行 17）
- API 上下文管理：`llm/context-management.ts` context-management-2025-06-27 beta，clear_thinking + clear_tool_uses，**全用户可配置（Claude 为 ant-only 门控）**
- **流空闲超时**：`session/llm-timeout.ts:21` 300s 可配置 — Claude 无对应显式机制，断网挂死防护更强
- 重试：`session/retry.ts:26-34` 指数退避 + retry-after 解析 + 5 分钟放弃阈值 + 5 次上限（防 13 小时 retry-after 挂死）
- 记忆抽取：`memory/extract.ts` + `extraction-runner.ts` 后台抽取到 hermes 记忆（`prompt.ts:1369` forkIn 后台执行）；`memory/dream.ts` 记忆整合（超越）
- token 预算：`token-budget.ts` 简写 + 3 种自然语言模式 + **收益递减检测**（行 78-90，连续 3 次续跑增量 <500 token 即停 — Claude 无此保护）

### 差距
| 级别 | 锚点 | 问题 | 建议 |
|------|------|------|------|
| P1 | Claude `autoCompact.ts:288` trySessionMemoryCompaction 优先于 LLM 摘要 | gyc 记忆抽取（extract.ts）已存在但**未接入压缩路径**：溢出时只能走 LLM 摘要压缩，多花一次完整 API 调用 | 在 `compaction.process` 前增加快速路径：若 hermes 记忆 + 尾部消息足以覆盖，直接剪枝免摘要 |
| P2 | Claude `promptCacheBreakDetection.ts` | gyc 无提示缓存破坏检测（影响成本可观测性，不影响正确性） | 可选：压缩/系统提示变更后记录缓存基线 |

---

## 修复路线（达到 100% 对齐并超越）

| 顺序 | 项 | 级别 | 工作量 | 状态 |
|------|-----|------|--------|------|
| 1 | usage 锚定 token 估算（指标 1-P1） | P1 | 0.5 天 | ✅ 已实现 |
| 2 | 会话记忆快速压缩路径（指标 5-P1） | P1 | 1 天 | ✅ 已实现 |
| 3 | 思考关键词升档 think/ultrathink（指标 3-P2） | P2 | 0.5 天 | ✅ 已实现 |
| 4 | LSP 工具 10MB 护栏（指标 2-P2） | P2 | 0.1 天 | ✅ 已实现 |
| 5 | 压缩边界预算结转（指标 1-P2） | P2 | 0.5 天 | ✅ 已实现 |

### P1 实现说明（2026-08-10）

**1. usage 锚定 token 估算** — `compaction.ts` 新增 `findUsageAnchor()` 纯函数 + `estimate()` 增加 `anchored` 参数：
- 从末尾回溯，找最后一条带真实 API usage 的 assistant 消息的**最后一个 step-finish part**
- 锚点 = `input + cache.read + cache.write`（该步完整上下文）+ `output + reasoning`（该步生成、会成为下次请求输入）
- 锚点之后的消息才做本地估算，避免全量 JSON 重序列化（O(n) → O(增量)）
- 仅在完整会话列表（`microcompactIfNeeded` 热路径）启用锚定；`select`/`splitTurn` 的子集估算不启用（锚点是累计值，对子集无效）
- 修正要点：`assistant.tokens.input/cache` 在 processor 中从不更新（只累计 `total`），真实每步 usage 存在 step-finish part，故锚点必须读 part 而非 message.tokens
- 测试：`usage-anchor.test.ts` 7 例全过

**2. 会话记忆快速压缩路径** — `compaction.ts` 新增 `buildMemorySummary()`/`cleanMemoryValue()` 纯函数 + `processCompaction` 前置快速路径：
- 压缩时先读 hermes 记忆，非空则直接拼装 `<summary>` 摘要，**免去一次完整 LLM 摘要调用**
- 记忆为空或 `compaction.session_memory_compaction === false` 时回退 LLM 路径
- 新增配置项 `compaction.session_memory_compaction`（默认 true）
- 测试：`memory-summary.test.ts` 9 例全过

### P2 实现说明（2026-08-10）

**3. 思考关键词升档** — 新增 `session/thinking-keywords.ts` 纯函数模块 + `prompt.ts createUserMessage` 接入：
- 检测用户文本中的思考关键词："think"→high、"think harder/deeply"→xhigh、"ultrathink"→max
- 仅在未显式指定 variant 且模型声明了推理 variants 时升级，按档位选择最强可用档位
- 超越 Claude：Claude 的 ultrathink 为 Anthropic-only + 构建门控，gyc 对全部多 provider 生效
- 测试：`thinking-keywords.test.ts` 11 例全过
- **review 修复（2026-08-10）**：初版 `full` 解析 gate 为 `!input.variant && ag.variant && same`，要求 agent 必须配置 variant，否则用户说 "ultrathink" 但 agent 未配 variant 时 `full` 为 undefined、升档不触发。已重构：先做廉价关键词扫描得 `thinkingTarget`，`full` 解析条件改为 `!input.variant && (ag.variant || thinkingTarget)`，使升档对任何声明推理 variants 的模型生效；无关键词且无 agent variant 时不触发模型查询（保持性能）。`variant`（agent 配置）仍保留 `same` 约束。27 pass / 0 fail。

**4. LSP 工具 10MB 护栏** — `tool/lsp.ts` 新增 `MAX_LSP_FILE_SIZE_BYTES = 10_000_000`，stat 后超限即抛错（对齐 Claude LSPTool.ts:53）

**5. 压缩边界预算结转** — `prompt.ts` 压缩 task 分支：压缩成功后重置 token-budget 的 `continuations`/`lastIncrement` 计数，避免压缩前的低增量过早触发收益递减判定（对齐 Claude finalContextTokensFromLastResponse 跨边界结转意图）

**回归**：`bun test src/gyccode/session/` → 152 pass / 0 fail（16 文件）

已超越项（保持）：38 内置 LSP、多 provider 推理矩阵、API 上下文管理全用户开放、流空闲超时、收益递减预算检测、dream 记忆整合、GYCCODE_MAX_CONTEXT_TOKENS 全用户开放。
