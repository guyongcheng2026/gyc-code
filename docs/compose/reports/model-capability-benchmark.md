---
feature: model-capability-benchmark
status: delivered (P0 + P1 + P2-1M)
specs:
  - docs/compose/specs/2026-08-10-model-capability-benchmark-design.md
plans:
branch: main
commits: 1586b8e..eedeb47
---

# 模型能力层 5 指标对标改进 — 最终报告

## What Was Built

对标 Claude Code 2.1.88 源码，对 gyc-code（gyc-cli）在模型能力层 5 指标（上下文长度 / 代码理解深度 / 推理能力 / 多语言支持 / 长会话稳定性）上完成机制差距评估，并交付 5 项关键改进：P0-1 启用 microcompact（长会话稳定性）、P0-2 类型感知 token 估算（上下文长度）、P1 MagicDocs 等价物 + 嵌套指令 @include（代码理解深度）、P2-1M 上下文通用支持（多语言/上下文长度）。P1 推理增强经源码复核判定为已满足。其余 P2 尾项（Notebook 编辑工具、语言特定提示）评估为低价值，归入后续。

## Architecture

### P0 批（第一批核心）

- **P0-1 microcompact 启用**：`src/gyccode/session/microcompact-select.ts`（新增，纯选择函数）：当上下文使用率 ≥85%（复用 `isOverflow` 的 `usable` 计算）时，扫描消息，对中间轮的 completed tool part 标记 `state.time.compacted`，保留 cache 前缀（前 10 条）与最近 5 条，清中间 tool 输出。`src/gyccode/session/compaction.ts` 中的 `Service` 新增 `microcompactIfNeeded` Effect 接线；`prompt.ts` runLoop 在完整压缩前先尝试 micro compact，若清输出后仍超限才走完整压缩（对齐 Claude Code microCompact 的 cache_edits+部分压缩语义）。可配置 `compaction.microcompact`（默认开）。
- **P0-2 类型感知 token 估算**：`src/core/util/token.ts` 增强 `estimate`：按内容特征分层——中文/全角字符按 ~1.5 字符/token（此前 /4 严重低估中文）、代码密集（含 `{` `}` `;` 等符号）按 ~3 字符/token、普通文本 /4；JSON 保持 /2。接口兼容（`estimate` 签名不变），供 compaction 的 estimate 与 prune 复用。修正了 413 前压缩触发过晚与英文散文高估两个偏差。

### P1 批（第二批）

- **MagicDocs 等价物**：`src/gyccode/magic-docs.ts`（新增）识别 `# MAGIC DOC` 头文件，`tool/read.ts` 读取时注册/刷新文档缓存（对齐 Claude Code magicDocs.ts 自动文档维护）。
- **嵌套指令 @include**：`src/gyccode/session/instruction-includes.ts`（新增，纯解析函数）支持 AGENTS.md/CLAUDE.md 内 `@path` 递归引用；`instruction.ts` 注入时展开（对齐 claudemd.ts:451）。

### P2 批（第三批）

- **1M 上下文通用支持**：`src/gyccode/session/llm/context-1m.ts`（新增）：`CONTEXT_1M_BETA_HEADER="context-1m-2025-08-07"`；纯函数 `context1MHeader(model, existingBeta)`——当模型 context≥1,000,000 且 provider 属 Anthropic 系（anthropic / google-vertex-anthropic / amazon-bedrock / openrouter / llmgateway / mailgun / vercel，按内部 id 匹配 @ai-sdk 相关 provider 包名）时，返回与既有静态 beta（如 `interleaved-thinking`）逗号去重合并后的完整 `anthropic-beta` 头，否则返回空串。`request.ts` 在 `LLMRequestPrep` 组装 headers 处调用合并写回。此前仅 GitLab 提供方特例注入该头（provider.ts:631），models.dev 已广告 1M 窗口的模型（claude-sonnet/opus 4.6+ 等）请求时因缺 beta 头实际被 API 限 200K——本改动修复此缺口。

## Design Decisions

- **按模型自动注入而非全局开关**：1M beta 头只对 context≥1M 的 Anthropic 系模型生效，避免对不支持 1M 的模型发送未知头导致拒绝。
- **逗号合并既有 beta 而非覆盖**：AI SDK `combineHeaders` 浅合并（后者覆盖前者），直接覆盖会丢失 `interleaved-thinking` 等静态 beta，故显式合并去重。
- **推理增强判定为已满足**：spec S4 第 2 条——复核后确认 config 已可经 `provider.ts` variants 覆写 reasoning（effort/budget），且 Claude 侧"验证 agent"是 ant-only 功能门控（VERIFICATION_AGENT），非通用基准能力，与 gyc 的 goal 低温 judge 对齐。

## Usage

- microcompact：`compaction.microcompact=false` 可关闭；默认开启，85% 阈值自动清中间 tool 输出推迟完整压缩。
- token 估算：自动生效，无需配置。
- MagicDocs：文件内容含 `# MAGIC DOC` 头即被识别并自动刷新。
- @include：AGENTS.md/CLAUDE.md 中写 `@path/to/file` 即可递归引入。
- 1M 上下文：选择 context 1M 的 Anthropic 系模型（models.dev 目录提供）即自动注入 `anthropic-beta: context-1m-2025-08-07`。

## Verification

- `bun tsc --noEmit`：通过（零错误；曾修 TS7053 字面量类型索引）。
- 单元测试：新增 microcompact-select、token、instruction-includes、magic-docs、context1m 共 5 个测试文件；context1m 8 用例 + request 8 用例 16/16 通过，session/provider 目录 53/53 通过。
- 已知失败：`src/ui/components/scroll-view.test.ts`、`src/ui/context/i18n.test.ts` 因 solid-js `jsxDEV` 导出问题失败——仓库既有基线问题，本次未触碰 UI 文件。
- 所有 commit 已通过 `.githooks/post-commit` 自动 push 到 origin/main。

## Journey Log

- [lesson] bun test 过滤器将含连字符的文件名解析为排除模式，`context-1m.test.ts` 报 "did not match any test files"，重命名为 `context1m.test.ts` 后通过。
- [lesson] write 工具"报告成功但未落盘"间歇性复现，落盘后用 Test-Path 验证；本会话改用 PowerShell `Set-Content`（UTF8）可靠写入。
- [dead end] 1M beta 头直接覆盖 `headers["anthropic-beta"]` 会丢存量 `interleaved-thinking`，改为逗号去重合并。
- [lesson] models.dev 广告的 1M 窗口（context=1,000,000）与 Anthropic API 实际接受上限（缺 beta 头时 200K）不一致——能力广告 ≠ 请求可用，需按模型注入请求头。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-08-10-model-capability-benchmark-design.md` | 设计/评估 | 5 指标差距总表 + P0/P1/P2 设计 |
| `src/gyccode/session/microcompact-select.ts` | P0-1 | microcompact 纯选择函数 |
| `src/core/util/token.ts` | P0-2 | 类型感知 token 估算 |
| `src/gyccode/magic-docs.ts` | P1 | MagicDocs 等价物 |
| `src/gyccode/session/instruction-includes.ts` | P1 | @include 递归引用 |
| `src/gyccode/session/llm/context-1m.ts` | P2 | 1M context beta 头注入 |