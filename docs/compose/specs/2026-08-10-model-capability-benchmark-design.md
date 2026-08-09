# gyc-cli 对标 Claude Code「模型能力层」5 指标差距评估与改进设计

- 日期：2026-08-10
- 状态：设计稿
- 对标对象：`E:\AI项目备份\Claude Code 源码资料\extracted-source\extracted-source\src`（Claude Code 2.1.88）
- 改进对象：`C:\Users\谷勇成\gyc-cli`（gyc-code）
- 目标：在模型能力层 5 指标（上下文长度 / 代码理解深度 / 推理能力 / 多语言支持 / 长会话稳定性）上 100% 达到 Claude Code 对应能力并超越

## [S1] 评估方法

- 纯源码机制差距评估（用户确认），不做运行 benchmark。
- 每个结论带文件路径 + 行号锚点，不臆造；未覆盖处标注"未检"。
- 差距分级：P0（直接影响能力、缺失或严重不足）/ P1（重要）/ P2（建议）。
- 交付物：本评估报告 + 分阶段代码改进，每阶段独立验证（bun test + tsc）。

## [S2] 5 指标差距评估总表

### S2.1 上下文长度

| 机制 | Claude Code | gyc-cli | 差距 |
|---|---|---|---|
| 默认窗口 | 200K（utils/context.ts:9） | models.dev 目录提供（models-dev.ts:157） | ✅ 目录驱动 |
| 1M 上下文 | `[1m]` 后缀 + beta header + 能力缓存（context.ts:35-98） | 仅 GitLab 特例（provider.ts:631） | **P0** |
| token 计数 | 按文件类型精化（JSON 2字节、图片2000）+ API countTokens + Haiku 回退（tokenEstimation.ts:215,115-200） | 字符/4 启发式（core/util/token.ts:6） | **P0** |
| 输出平衡 | 按模型族分级 maxOutputTokens + escalate 64K（context.ts:149-218） | OUTPUT_TOKEN_MAX=32K + escalate 64K（transform.ts:18, prompt.ts:1183） | ✅ 对齐 |

### S2.2 代码理解深度

| 机制 | Claude Code | gyc-cli | 差距 |
|---|---|---|---|
| LSP 操作 | 9 种（LSPTool.ts:61-73） | 9 种对齐（tool/lsp.txt） | ✅ 对齐 |
| 指令注入 | 嵌套 CLAUDE.md @include + 条件规则（claudemd.ts:451,1354） | 指令就近注入（instruction.ts:238-285） | P1 |
| MagicDocs | 自动文档维护（magicDocs.ts） | 无 | **P0** |
| 诊断回灌 | LSP 诊断被动反馈 | LSP 诊断回灌（edit.ts:219-227） | ✅ 对齐 |

### S2.3 推理能力

| 机制 | Claude Code | gyc-cli | 差距 |
|---|---|---|---|
| thinking | adaptive + enabled(budget)（thinking.ts:12） | reasoning_effort/budget variants（transform.ts:598-693） | P1 |
| effort | low~max + ultrathink（effort.ts:13） | 模型族 effort 档位（transform.ts:547-643） | P1 |
| 独立裁判 | — | goal 低温 judge（goal.ts:246-252） | ✅ gyc 超越 |
| 验证 agent | 非平凡实现强制验证（prompts.ts:394） | 无 | P1 |

### S2.4 多语言支持

| 机制 | Claude Code | gyc-cli | 差距 |
|---|---|---|---|
| 扩展名映射 | 100+（claudemd.ts:97-190） | 100+（lsp/language.ts:1-99） | ✅ 对齐 |
| LSP 多语言 | 插件化（lsp/config.ts:19） | TS/Pyright/Biome/elixir 等（lsp/server.ts） | ✅ 对齐 |
| Notebook | NotebookEditTool | 无 | P2 |
| 响应语言 | 语言偏好注入（prompts.ts:142） | 默认中文指令（request.ts:63-74） | ✅ 对齐 |

### S2.5 长会话稳定性

| 机制 | Claude Code | gyc-cli | 差距 |
|---|---|---|---|
| autoCompact | 阈值 + 熔断3次（autoCompact.ts:62-70） | isOverflow + 熔断3次（compaction.ts:23） | ✅ 对齐 |
| microCompact | cache_edits + 时间触发（microCompact.ts:253,422） | **死代码未启用**（compaction.ts:53 无调用） | **P0** |
| SessionMemory | 会话内记忆免压缩 API（sessionMemory.ts） | 结构化摘要链（core/session/compaction.ts:23-72） | P1（等价） |
| prune | — | 工具输出回收（compaction.ts:307-375） | ✅ gyc 独有 |
| resume | 完整恢复（sessionRestore.ts） | 重放恢复（runtime.ts:144） | ✅ 对齐 |

## [S3] P0 阶段改进设计（第一批）

### P0-1：启用 microcompact（长会话稳定性）

**现状**：`microcompact()` 已实现但死代码（compaction.ts:53，仅定义无调用）。它基于简化 `{role,content}` 消息类型，85% 阈值，保留 cache 前缀 + 最近 5 条，清中间 tool 输出。

**设计**：
1. 在 `src/gyccode/session/compaction.ts` 的 `Service` 中新增 `microcompactIfNeeded` Effect：当上下文使用率 ≥85%（复用 `isOverflow` 的 `usable` 计算）时，扫描消息，对中间轮的 completed tool part 标记 `state.time.compacted`（与 prune 同机制，序列化时自动替换为占位），保留 cache 前缀（前 10 条）与最近 5 条。
2. 接线：在 `prompt.ts` runLoop 的 overflow 检查（`compaction.isOverflow`）之前，先尝试 `microcompactIfNeeded`（若已达到 micro 阈值但未达压缩阈值则清 tool 输出并 continue，推迟完整压缩）；若 micro 后仍超限则走完整压缩。
3. 阈值：`MICROCOMPACT_THRESHOLD=0.85`（已有），`CACHE_PREFIX_KEEP=10`（已有）。
4. 可配置：`compaction.microcompact` 布尔（默认 true，对齐 auto 语义）。

**验证**：单元测试（构造 85%+ 上下文消息序列，断言中间 tool 被 compacted、cache 前缀保留、最近保留）；bun test。

### P0-2：token 估算增强（上下文长度）

**现状**：`Token.estimate` 纯字符/4（core/util/token.ts:6），JSON 用 /2。对代码（符号密集）和中文会低估，导致压缩触发过晚 → 413 风险；对英文散文会高估。

**设计**：
1. 增强 `estimate`：按内容特征分层——中文/全角字符按 ~1.5 字符/token，代码密集（含 `{` `}` `;` 等符号）按 ~3 字符/token，普通文本 /4；JSON 保持 /2。
2. 新增 `estimateParts`/`estimateMessage` 辅助（对齐 Claude Code tokenEstimation 的按类型估算），供 compaction 的 `estimate()`（compaction.ts:251）与 prune（compaction.ts:335）使用。
3. 保持接口兼容（`estimate(input)` 签名不变），纯增量增强。

**验证**：单元测试（中文/代码/JSON/英文各类型的估算精度 vs 已知近似值）；bun test。

## [S4] P1 阶段改进设计（第二批）

1. **MagicDocs 等价物**：识别 `# MAGIC DOC` 头文件，会话空闲时后台更新文档（对齐 magicDocs.ts）。
2. **推理增强**：显式 `reasoning` 配置暴露（effort/budget 用户可调），非平凡实现建议验证 agent。
3. **嵌套指令 @include**：AGENTS.md/CLAUDE.md 支持 `@path` 递归引用（对齐 claudemd.ts:451）。

## [S5] P2 阶段改进设计（第三批）

1. **Notebook 编辑工具**（对齐 NotebookEditTool）。
2. **1M 上下文通用支持**：模型名 `[1m]` 后缀解析 + beta header 注入（对齐 context.ts）。
3. **语言特定提示**：按文件类型注入语言特定工具/校验提示。

## [S6] 验证策略

- 每阶段完成后：bun test（全量）+ bun tsc --noEmit + 定向测试。
- 回归：不触碰上一会话遗留的未提交改动（17 个文件，属 UI/数据库历史遗留）。
- 每 P 阶段独立 commit，post-commit 自动 push。

## [S7] 范围与排除

- 不做：模型本身更换、依赖新增（真实 tokenizer 库需评估后再定）、文档类交付。
- 改动边界：只改本设计列出的模块。
- 已修正的探索偏差：gyc LSP 9 操作与 Claude Code 对齐（非缺失）；gyc 有 goal 独立裁判（Claude Code 无，gyc 超越）。
