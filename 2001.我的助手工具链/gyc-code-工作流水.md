# gyc-code 工作流水（自动同步）

> 每次 `git commit` 后由 `.githooks/post-commit` 自动追加
> 仓库：本地 `C:\Users\谷勇成\gyc-cli` / 用户 `guyongcheng2026/gyc-code`（gh-proxy）

## 提交诰

- [OK] 2026-08-08 [18fe331] feat: 新增 compose primary agent + 内置 compose skills（Tab 可切到 compose）与提示注入
  - [FILES] 54: scripts/gen-compose-bundle.mjs, src/gyccode/agent/agent.ts, src/gyccode/effect/runtime-flags.ts, src/gyccode/session/prompt/compose.txt, src/gyccode/session/reminders.ts, src/gyccode/skill/compose/.bundle/ask/SKILL.md ...

- [OK] 2026-08-08 [40791ba] chore: 代码改动后自动同步 Obsidian 知识库(vault 工作流水)与 GitHub 推送钩子
  - [FILES] 3: .githooks/post-commit, AGENTS.md, scripts/worklog-sync.mjs

- [OK] 2026-08-08 [47f0344] 修复 provider 凭据保存假成功并更新 TUI 组件
  - [FILES] 43: src/core/plugin/command.ts, src/gyccode/cli/cmd/run/footer.command.tsx, src/gyccode/cli/cmd/run/footer.prompt.tsx, src/gyccode/cli/cmd/run/footer.view.tsx, src/gyccode/command/index.ts, src/gyccode/tool/invalid.ts ...

- [OK] 2026-08-08 [73e30a1] perf: Bun --smol 启动参数 + SessionData dispose 释放 session 切换内存
  - [FILES] 3: bin/gyc, src/gyccode/cli/cmd/run/session-data.ts, src/gyccode/cli/cmd/run/stream.transport.ts

- [OK] 2026-08-08 [7022fb8] fix: Windows conhost 乱码——启动切换控制台输出代码页为 UTF-8（65001）
  - [FILES] 10: docs/GYCCODE-WORKLOG-2026-08-08.md, docs/compose/plans/2026-08-08-resource-optimization.md, src/codemode/tool-runtime.ts, src/core/database/database.ts, src/gyccode/index.ts, src/gyccode/tool/edit.ts ...

- [OK] 2026-08-08 [f5251f8] chore: phase 0 - remove 9 dead files (empty, stub, unused utils)
  - [FILES] 9: src/core/markdown.d.ts, src/core/util/array.ts, src/core/util/binary.ts, src/core/util/path.ts, src/core/util/retry.ts, src/gyccode/temporary.ts ...

- [OK] 2026-08-08 [43d9bef] feat: add shell security engine with 14 dangerous pattern classifications
  - [FILES] 2: src/gyccode/tool/shell.ts, src/gyccode/tool/shell/security.ts

- [OK] 2026-08-08 [7c6160d] feat: expand permission system with 4 modes and denial tracker
  - [FILES] 3: src/gyccode/permission/classifier.ts, src/gyccode/permission/index.ts, src/gyccode/permission/modes.ts

- [OK] 2026-08-08 [78c154a] feat: add hook system with 9 event types and config-driven execution
  - [FILES] 3: src/gyccode/hook/executor.ts, src/gyccode/hook/registry.ts, src/gyccode/hook/types.ts

- [OK] 2026-08-08 [c3c3adf] feat: add cache-preserving fork for shared prompt cache between parent and child agents
  - [FILES] 1: src/gyccode/session/session.ts

- [OK] 2026-08-08 [2e97cd5] feat: add prompt shard caching with static/semi-static/dynamic tiers
  - [FILES] 2: src/gyccode/session/prompt-shard.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-08 [74d8da8] fix: update Schema API usage for effect v4 beta compatibility
  - [FILES] 5: src/gyccode/hook/executor.ts, src/gyccode/hook/types.ts, src/gyccode/permission/modes.ts, src/gyccode/tool/shell.ts, src/gyccode/tool/shell/security.ts

- [OK] 2026-08-08 [f263408] feat: add auto memory extraction with dedup and formatting utilities
  - [FILES] 1: src/gyccode/memory/extract.ts

- [OK] 2026-08-08 [95eec07] feat: add auto memory consolidation (dream) with time/session gating
  - [FILES] 1: src/gyccode/memory/dream.ts

- [OK] 2026-08-08 [792e940] feat: add autonomous loop with stuck detection and loop/stuck skills
  - [FILES] 3: src/gyccode/session/proactive.ts, src/gyccode/skill/bundled/loop.md, src/gyccode/skill/bundled/stuck.md

- [OK] 2026-08-08 [b8ff5a3] feat: add microcompact strategy with cache prefix preservation
  - [FILES] 1: src/gyccode/session/compaction.ts

- [OK] 2026-08-08 [12c0296] feat: add swarm multi-agent system with teammate and coordinator
  - [FILES] 3: src/gyccode/agent/swarm/coordinator.ts, src/gyccode/agent/swarm/teammate.ts, src/gyccode/agent/swarm/types.ts

- [OK] 2026-08-08 [fa4e9cf] feat: add IDE transport stub and OAuth token lifecycle to MCP
  - [FILES] 2: src/gyccode/mcp/auth.ts, src/gyccode/mcp/transport-ide.ts

- [OK] 2026-08-08 [c927c6d] feat: add 5 built-in skills (debug, verify, review, tdd, brainstorm)
  - [FILES] 5: src/gyccode/skill/bundled/brainstorm.md, src/gyccode/skill/bundled/debug.md, src/gyccode/skill/bundled/review.md, src/gyccode/skill/bundled/tdd.md, src/gyccode/skill/bundled/verify.md

- [OK] 2026-08-08 [deb9839] feat: add BriefTool for agent-to-user notifications
  - [FILES] 2: src/gyccode/tool/brief.ts, src/gyccode/tool/registry.ts

- [OK] 2026-08-08 [c39fc97] feat: add vim keybindings and configurable keybinding system
  - [FILES] 1: src/gyccode/cli/keybindings.ts

- [OK] 2026-08-08 [bf0cb64] feat: add plugin marketplace stubs (search, install, update)
  - [FILES] 1: src/gyccode/plugin/marketplace.ts

- [OK] 2026-08-08 [9d5aae8] feat: add natural language token budget parsing (+500k, use 2M tokens)
  - [FILES] 1: src/gyccode/session/token-budget.ts

- [OK] 2026-08-08 [cc48932] feat: add team memory sharing with search and merge utilities
  - [FILES] 1: src/gyccode/memory/team.ts

- [OK] 2026-08-08 [d54796a] feat: add hermes-style input recall (history sentence completion with Tab) and next-step prediction hint
  - [FILES] 5: src/tui/component/next-step-hint.tsx, src/tui/component/prompt/autocomplete.tsx, src/tui/prompt/history.tsx, src/tui/prompt/next-step.ts, src/tui/routes/session/index.tsx

- [OK] 2026-08-08 [2fd7f74] fix: 修复 effect v4 Schema.Union 多参数调用崩溃，LLM 选择与计划执行恢复正常
  - [FILES] 13: src/gyccode/agent/swarm/teammate.ts, src/gyccode/agent/swarm/types.ts, src/gyccode/hook/types.ts, src/gyccode/mcp/auth.ts, src/gyccode/mcp/index.ts, src/gyccode/mcp/transport-ide.ts ...

- [OK] 2026-08-08 [d13dc75] docs: 重建并落盘 CC-BENCHMARK 对标报告（Claude Code 2.1.88 五维对标 + 22 项提升措施）
  - [FILES] 1: docs/CC-BENCHMARK-2026-08-08.md

- [OK] 2026-08-08 [ec47d6b] fix: 修复 429 retry-after 导致 run 挂死 13 小时 + BOM 配置解析失败；目录对齐 Claude Code 结构
  - [FILES] 24: docs/BUG-2026-08-08.md, src/QueryEngine.ts, src/STRUCTURE.md, src/Task.ts, src/Tool.ts, src/commands.ts ...

- [OK] 2026-08-08 [08b5fbf] docs: BUG 清单补充端到端验证结论（auth.set 保存/模型目录/LLM 实际调用均正常）
  - [FILES] 1: docs/BUG-2026-08-08.md

- [OK] 2026-08-08 [0b0a8bf] docs: 能力清单覆盖评估报告（A-G 逐项核查 + P0/P1/P2 追赶计划）
  - [FILES] 1: docs/CAPABILITY-GAP-2026-08-08.md

- [OK] 2026-08-08 [457b11d] feat: 记忆相关性检索接入系统提示（P0-1，hermes-bridge 关键词/标签粗筛 + 4KB 预算注入 + mtime 缓存）
  - [FILES] 3: src/gyccode/memory/hermes-bridge.ts, src/gyccode/session/prompt.ts, src/gyccode/session/system.ts

- [OK] 2026-08-08 [6e1e323] fix: GYCCODE logo 清晰化（GYC 与 CODE 渲染统一）+ provider 更名 OpenCode Zen；修复 92 处 tsc 类型错误（嵌套 Effect/Option<Date>/variadic 等真实 bug）+ UI 测试 preload 配置，tsc 与测试全绿
  - [FILES] 17: package.json, src/core/plugin/provider/gyccode.ts, src/core/plugin/skill.ts, src/gyccode/cli/cmd/memory.ts, src/gyccode/cli/ui.ts, src/gyccode/hook/executor.ts ...

- [OK] 2026-08-08 [54c790a] perf: gyc CLI 性能与 24h 稳定性优化——流式 delta 合并节流（30ms）、渲染 60→30fps、BgPulse 12fps+动画关闭、音效默认关闭、轮询降频（1000/200ms）、日志轮转 10MB、冷启动 1.3s 达标
  - [FILES] 9: src/core/observability/logging.ts, src/tui/app.tsx, src/tui/component/bg-pulse.tsx, src/tui/component/prompt/autocomplete.tsx, src/tui/component/spinner.tsx, src/tui/config/index.tsx ...

- [OK] 2026-08-08 [cbf61d1] perf: 会话循环记忆检索缓存（同 query 30s TTL）提速首 token/结果反馈；启动 1.3s、LLM 切换 SDK 缓存、流式节流均已达标
  - [FILES] 1: src/gyccode/memory/hermes-bridge.ts

- [OK] 2026-08-08 [acac175] feat: 基于 hermes /learn 理念将今日会话高价值能力封装为 gyc 技能（gyc-perf-optimization 性能优化 + gyc-effect-ts-fixes 类型修复），已入 compose bundle 供后续会话复用
  - [FILES] 3: src/gyccode/skill/compose/.bundle/gyc-effect-ts-fixes/SKILL.md, src/gyccode/skill/compose/.bundle/gyc-perf-optimization/SKILL.md, src/gyccode/skill/compose/bundle.gen.ts

- [OK] 2026-08-08 [0ebdbaf] fix: GYCCODE 主界面字标清晰化——纯块字符无阴影（Y 字加粗清晰）、三排严格等宽整体居中、参照 mimo code 布局；TUI 英文界面文案全面中文化（撤回/权限/提问等窗口）+ logo 数据回归测试
  - [FILES] 34: src/gyccode/cli/ui.ts, src/tui/app.tsx, src/tui/component/dialog-debug.tsx, src/tui/component/dialog-provider.tsx, src/tui/component/dialog-retry-action.tsx, src/tui/component/dialog-status.tsx ...

- [OK] 2026-08-09 [5dc779d] docs: 工作区对标 mimo-code 实施计划（cwd/context实时/instructions/goal/task + 默认中文固化）11 任务已入库
  - [FILES] 1: docs/compose/plans/2026-08-09-sidebar-workspace-mimo.md

- [OK] 2026-08-09 [fdf78cf] feat(schema): event defs for session.cwd / session.goal / session.instructions
  - [FILES] 2: src/schema/session-cwd-event.test.ts, src/schema/session-event.ts

- [OK] 2026-08-09 [8a1a273] fix(schema): register session.cwd/goal/instructions events in inventories; harden verdict fixtures
  - [FILES] 2: src/schema/session-event.test.ts, src/schema/session-event.ts

- [OK] 2026-08-09 [57f6d3d] feat(session): cwd tracker broadcast + instructions list event
  - [FILES] 5: src/gyccode/session/instruction.ts, src/gyccode/session/prompt.ts, src/gyccode/session/session-cwd.test.ts, src/gyccode/session/session-cwd.ts, src/gyccode/tool/shell.ts

- [OK] 2026-08-09 [7767330] fix(session): reuse resolved instruction paths for InstructionsListed; scope cwd store lifecycle
  - [FILES] 5: src/gyccode/session/instruction.ts, src/gyccode/session/prompt.ts, src/gyccode/session/session-cwd.test.ts, src/gyccode/session/session-cwd.ts, src/gyccode/session/session.ts

- [OK] 2026-08-09 [544f0ae] fix: 修复 benchmark 测试超时与 goal.test.ts import 拼写错误
  - [FILES] 3: src/gyccode/benchmark/benchmark.test.ts, src/gyccode/session/goal.test.ts, src/gyccode/session/goal.ts

- [OK] 2026-08-09 [fd4e878] feat(session): goal service with injectable judge + session.goal events
  - [FILES] 2: src/gyccode/session/goal.test.ts, src/gyccode/session/goal.ts

- [OK] 2026-08-09 [1b7ac80] fix(session): real Step.Ended cost + emit session.updated(cost) after usage accumulator
  - [FILES] 5: src/core/session/projector.test.ts, src/core/session/projector.ts, src/core/session/runner/llm.ts, src/core/session/runner/publish-llm-event.test.ts, src/core/session/runner/publish-llm-event.ts

- [OK] 2026-08-09 [373d286] fix(session): decouple usage broadcast from projector durable transaction (publishLive)
  - [FILES] 3: src/core/event.ts, src/core/session/projector.test.ts, src/core/session/projector.ts

- [OK] 2026-08-09 [bc47128] feat(sidebar): realtime Context tokens/% /spent + limit + tps
  - [FILES] 5: src/core/util/token.ts, src/tui/feature-plugins/sidebar/context.tsx, src/tui/feature-plugins/sidebar/tps.test.ts, src/tui/feature-plugins/sidebar/tps.ts, src/tui/util/model.ts

- [OK] 2026-08-09 [ef24e1e] feat(sidebar): add working-directory (cwd) panel
  - [FILES] 5: src/tui/context/event.ts, src/tui/context/sync.tsx, src/tui/feature-plugins/sidebar/cwd.test.tsx, src/tui/feature-plugins/sidebar/cwd.tsx, src/tui/plugin/adapters.tsx

- [OK] 2026-08-09 [d89c0b3] feat(sidebar): add instructions panel + session.instructions sync
  - [FILES] 5: src/tui/context/event.ts, src/tui/context/sync.tsx, src/tui/feature-plugins/sidebar/instructions.test.tsx, src/tui/feature-plugins/sidebar/instructions.tsx, src/tui/plugin/adapters.tsx

- [OK] 2026-08-09 [e620f7a] feat(sidebar): add goal panel + session.goal sync
  - [FILES] 5: src/tui/context/event.ts, src/tui/context/sync.tsx, src/tui/feature-plugins/sidebar/goal.test.tsx, src/tui/feature-plugins/sidebar/goal.tsx, src/tui/plugin/adapters.tsx

- [OK] 2026-08-09 [e93289d] feat(sidebar): upgrade todo panel with status sort + recent-done tail
  - [FILES] 2: src/tui/feature-plugins/sidebar/todo.test.tsx, src/tui/feature-plugins/sidebar/todo.tsx

- [OK] 2026-08-09 [5250a7e] feat(sidebar): register cwd/instructions/goal panels in builtins
  - [FILES] 1: src/tui/feature-plugins/builtins.ts

- [OK] 2026-08-09 [d984da8] feat(i18n): default Simplified Chinese locale + language directive tests
  - [FILES] 4: src/gyccode/session/llm/request.test.ts, src/gyccode/session/llm/request.ts, src/ui/context/i18n.test.ts, src/ui/context/i18n.tsx

- [OK] 2026-08-10 [9fb07d5] docs(spec): claude-code 三指标差距评估与分阶段改进设计
  - [FILES] 1: docs/compose/specs/2026-08-10-claude-code-benchmark-design.md

- [OK] 2026-08-10 [be37d1e] docs(plan): P0 阶段实施计划 - Claude Code 三指标对标第一批改进
  - [FILES] 1: docs/compose/plans/2026-08-10-claude-code-benchmark-p0.md

- [OK] 2026-08-10 [a35c2a0] feat(tool): track read state in read-cache for read-before-write
  - [FILES] 2: src/gyccode/tool/read-cache.test.ts, src/gyccode/tool/read-cache.ts

- [OK] 2026-08-10 [d05a84d] feat(tool): mark files as read after successful Read tool calls
  - [FILES] 1: src/gyccode/tool/read.ts

- [OK] 2026-08-10 [6827bab] feat(tool): enforce read-before-write in write/edit tools
  - [FILES] 3: src/gyccode/tool/edit.ts, src/gyccode/tool/read-before-write.test.ts, src/gyccode/tool/write.ts

- [OK] 2026-08-10 [781b62a] feat(session): add token budget continuation check + message
  - [FILES] 2: src/gyccode/session/token-budget.test.ts, src/gyccode/session/token-budget.ts

- [OK] 2026-08-10 [a85e361] feat(session): wire token budget continuation into runLoop
  - [FILES] 1: src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [9c9df68] feat(memory): add injectable extraction runner with dedup + cap
  - [FILES] 2: src/gyccode/memory/extraction-runner.test.ts, src/gyccode/memory/extraction-runner.ts

- [OK] 2026-08-10 [7be74c0] feat(session): wire automatic memory extraction into runLoop
  - [FILES] 2: src/core/v1/config/config.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [72be8fd] docs(report): P0 阶段最终报告 + 标记 spec/plan
  - [FILES] 3: docs/compose/plans/2026-08-10-claude-code-benchmark-p0.md, docs/compose/reports/claude-code-benchmark-p0.md, docs/compose/specs/2026-08-10-claude-code-benchmark-design.md

- [OK] 2026-08-10 [d1a06c4] feat(session): escalate output cap to 64k on first output-length truncation
  - [FILES] 4: src/gyccode/session/llm.ts, src/gyccode/session/llm/request.test.ts, src/gyccode/session/llm/request.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [7d233d7] feat(tool): require source citation in websearch results (anti-hallucination)
  - [FILES] 1: src/gyccode/tool/websearch.ts

- [OK] 2026-08-10 [fe9a53d] feat(memory): flag stale memories with freshness reminder (anti-hallucination)
  - [FILES] 3: src/gyccode/memory/hermes-bridge.test.ts, src/gyccode/memory/hermes-bridge.ts, src/gyccode/session/system.ts

- [OK] 2026-08-10 [31fb293] feat(tool): add task_list/task_get/task_stop management tools
  - [FILES] 3: src/gyccode/tool/registry.ts, src/gyccode/tool/task-manage.test.ts, src/gyccode/tool/task-manage.ts

- [OK] 2026-08-10 [c535620] feat(tool): summarize large webfetch results with cheap model (anti-hallucination + cost)
  - [FILES] 3: src/gyccode/tool/summarize.test.ts, src/gyccode/tool/summarize.ts, src/gyccode/tool/webfetch.ts

- [OK] 2026-08-10 [6bda90d] docs(spec): record P1 implementation findings + S5 assessment revision
  - [FILES] 1: docs/compose/specs/2026-08-10-claude-code-benchmark-design.md

- [OK] 2026-08-10 [f2dbdb3] docs(report): update final report to cover P0 + P1
  - [FILES] 1: docs/compose/reports/claude-code-benchmark-p0.md

- [OK] 2026-08-10 [003a37b] feat(tool): remind verification when 3+ todos closed at once
  - [FILES] 2: src/gyccode/tool/todo.test.ts, src/gyccode/tool/todo.ts

- [OK] 2026-08-10 [8f7e82c] fix(session): add idle+header timeouts so dropped connections never hang the runLoop
  - [FILES] 5: src/gyccode/provider/error.test.ts, src/gyccode/provider/provider.ts, src/gyccode/session/llm-timeout.test.ts, src/gyccode/session/llm-timeout.ts, src/gyccode/session/llm.ts

- [OK] 2026-08-10 [1586b8e] docs(spec): 模型能力层 5 指标差距评估与分阶段改进设计
  - [FILES] 1: docs/compose/specs/2026-08-10-model-capability-benchmark-design.md

- [OK] 2026-08-10 [8ce3168] feat(session): enable micro-compaction of middle tool outputs before full compaction
  - [FILES] 5: src/core/v1/config/config.ts, src/gyccode/session/compaction.ts, src/gyccode/session/microcompact-select.test.ts, src/gyccode/session/microcompact-select.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [fca0941] feat(core): type-aware token estimation (CJK/code/JSON density)
  - [FILES] 2: src/core/util/token.test.ts, src/core/util/token.ts

- [OK] 2026-08-10 [fff8197] feat(session): support @include references in instruction files
  - [FILES] 3: src/gyccode/session/instruction-includes.test.ts, src/gyccode/session/instruction-includes.ts, src/gyccode/session/instruction.ts

- [OK] 2026-08-10 [5bcfa11] feat(magic-docs): register and refresh MAGIC DOC documentation files
  - [FILES] 3: src/gyccode/magic-docs.test.ts, src/gyccode/magic-docs.ts, src/gyccode/tool/read.ts

- [OK] 2026-08-10 [eedeb47] feat(session): auto-inject 1M context beta header for Anthropic-lineage models
  - [FILES] 3: src/gyccode/session/llm/context-1m.ts, src/gyccode/session/llm/context1m.test.ts, src/gyccode/session/llm/request.ts

- [OK] 2026-08-10 [54d296f] docs(report): final report for model-capability-benchmark (5 metrics) P0+P1+P2-1M
  - [FILES] 2: docs/compose/reports/model-capability-benchmark.md, docs/compose/specs/2026-08-10-model-capability-benchmark-design.md

- [OK] 2026-08-10 [aabd865] feat(session): restrict response language to Simplified Chinese and English
  - [FILES] 2: src/gyccode/session/llm/request.test.ts, src/gyccode/session/llm/request.ts

- [OK] 2026-08-10 [940addc] docs(spec): design for closing 6 model-capability gaps (1.2/1.3/1.4/2.3/5.3/5.4)
  - [FILES] 1: docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md

- [OK] 2026-08-10 [31c355d] docs(plan): implementation plan for 6 model-capability gaps closure (9 tasks, TDD)
  - [FILES] 1: docs/compose/plans/2026-08-10-model-capability-gaps-closure.md

- [OK] 2026-08-10 [465de53] feat(config): add token_counting, llm.output caps, time-based MC and api context management schemas
  - [FILES] 1: src/core/v1/config/config.ts

- [OK] 2026-08-10 [fdd5df4] feat(core): add local BPE-approximation tokenizer
  - [FILES] 2: src/core/util/tokenizer.test.ts, src/core/util/tokenizer.ts

- [OK] 2026-08-10 [e64c8f1] fix(core): make tokenizer linear-time with sticky regex, add whitespace-collapse test
  - [FILES] 2: src/core/util/tokenizer.test.ts, src/core/util/tokenizer.ts

- [OK] 2026-08-10 [5b52814] feat(core): route Token.estimate through local tokenizer, add estimateWithAPI fallback
  - [FILES] 2: src/core/util/token.test.ts, src/core/util/token.ts

- [OK] 2026-08-10 [f0a93d2] fix(core): tokenizer-driven compaction split, integer API count guard, invalid-value fallback test
  - [FILES] 3: src/core/session/compaction.ts, src/core/util/token.test.ts, src/core/util/token.ts

- [OK] 2026-08-10 [61768a9] fix(core): bound compaction recent tail to remaining token budget, not the head
  - [FILES] 1: src/core/session/compaction.ts

- [OK] 2026-08-10 [b1a46cf] feat(session): support [1m] suffix opt-in and universal GYCCODE_MAX_CONTEXT_TOKENS window cap
  - [FILES] 3: src/gyccode/session/llm/context-1m.ts, src/gyccode/session/llm/context1m.test.ts, src/gyccode/session/overflow.ts

- [OK] 2026-08-10 [615858c] fix(session): apply universal context cap to usable input branch, add overflow wiring tests, tighten suffix/parse
  - [FILES] 3: src/gyccode/session/llm/context-1m.ts, src/gyccode/session/overflow.test.ts, src/gyccode/session/overflow.ts

- [OK] 2026-08-10 [9a6af32] feat(session): model-driven maxOutputTokens with configurable caps and escalate ceiling
  - [FILES] 5: src/gyccode/provider/transform.ts, src/gyccode/session/llm.ts, src/gyccode/session/llm/request.test.ts, src/gyccode/session/llm/request.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [08c6e57] 修复子代理无限空转：通配权限识别 + 默认步数上限 + 连续空转快速失败
  - [FILES] 2: src/gyccode/agent/subagent-permissions.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [7d802b1] fix(session): align compaction budget with configurable output cap, add escalate helper, positive-int caps
  - [FILES] 6: src/core/v1/config/config.ts, src/gyccode/session/compaction.ts, src/gyccode/session/llm.ts, src/gyccode/session/llm/output-cap.test.ts, src/gyccode/session/llm/output-cap.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-10 [1eba1c5] feat(session): conditional rules with globs+language+os matching, system and nearby injection
  - [FILES] 3: src/gyccode/session/instruction.ts, src/gyccode/session/rules.test.ts, src/gyccode/session/rules.ts

- [OK] 2026-08-10 [fbaa60b] fix(session): match rules against relative+absolute paths, dedup unconditional rules, os at system level, loadRules tests
  - [FILES] 3: src/gyccode/session/instruction.ts, src/gyccode/session/rules.test.ts, src/gyccode/session/rules.ts

- [OK] 2026-08-10 [b5817ee] feat(session): time-based micro-compaction with configurable gap and keep, chained before usage-based
  - [FILES] 3: src/gyccode/session/compaction.ts, src/gyccode/session/microcompact-select.test.ts, src/gyccode/session/microcompact-select.ts

- [OK] 2026-08-10 [83707e8] fix(session): restore full-compaction escalation in microcompactIfNeeded, opt-in time-based via enabled=true
  - [FILES] 3: src/gyccode/session/compaction.ts, src/gyccode/session/microcompact-select.test.ts, src/gyccode/session/microcompact-select.ts

- [OK] 2026-08-10 [a792281] fix(session): base time-based microcompact on last assistant message time, add escalation-contract and boundary tests
  - [FILES] 3: src/gyccode/session/compaction.ts, src/gyccode/session/microcompact-select.test.ts, src/gyccode/session/microcompact-select.ts

- [OK] 2026-08-10 [1b6ef1d] test(session): lock inclusive gap-boundary with 3-message fixture, skip summary in tool-end fallback
  - [FILES] 2: src/gyccode/session/microcompact-select.test.ts, src/gyccode/session/microcompact-select.ts

- [OK] 2026-08-10 [835fb48] feat(session): API-native context management via context-management beta, universally configurable
  - [FILES] 5: src/gyccode/session/llm.ts, src/gyccode/session/llm/context-1m.ts, src/gyccode/session/llm/context-management.test.ts, src/gyccode/session/llm/context-management.ts, src/gyccode/session/llm/request.ts

- [OK] 2026-08-10 [76cb8c4] fix(session): make API context management effective on AI SDK and native paths (camelCase providerOptions + wire mapping)
  - [FILES] 4: src/gyccode/session/llm/context-management.test.ts, src/gyccode/session/llm/context-management.ts, src/gyccode/session/llm/request.ts, src/llm/protocols/anthropic-messages.ts

- [OK] 2026-08-10 [ae46349] fix(session): unify context-management wire types (input_tokens), faithful native lowering, extract tested prepare helpers
  - [FILES] 6: src/gyccode/session/llm/context-1m.ts, src/gyccode/session/llm/context-management.test.ts, src/gyccode/session/llm/context-management.ts, src/gyccode/session/llm/context1m.test.ts, src/gyccode/session/llm/request.ts, src/llm/protocols/anthropic-messages.ts

- [OK] 2026-08-10 [f11ab37] docs(spec): mark model-capability gaps-closure design delivered
  - [FILES] 1: docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md

- [OK] 2026-08-10 [a52c68e] fix(session): wire token_counting API calibration, strip [1m] from wire, hoist time-based MC, normalize rule language, gate CM beta on non-empty edits
  - [FILES] 11: src/gyccode/provider/provider.ts, src/gyccode/session/compaction.ts, src/gyccode/session/llm/context-1m.ts, src/gyccode/session/llm/context-management.test.ts, src/gyccode/session/llm/context1m.test.ts, src/gyccode/session/llm/native-request.ts ...

- [OK] 2026-08-10 [0570967] fix(session): add countTokens fetch timeout, skip non-anthropic api/auto estimation, align api_model doc
  - [FILES] 2: src/core/v1/config/config.ts, src/gyccode/session/compaction.ts

- [OK] 2026-08-10 [0db1567] docs(report): final report for 6 model-capability gaps closure; mark spec and plan with NOTE pointer
  - [FILES] 3: docs/compose/plans/2026-08-10-model-capability-gaps-closure.md, docs/compose/reports/model-capability-gaps-closure.md, docs/compose/specs/2026-08-10-model-capability-gaps-closure-design.md

- [OK] 2026-08-10 [a2103ea] fix(test): update streamingTPS assertions to match real tokenizer
  - [FILES] 20: src/core/database/sqlite.bun.ts, src/core/database/sqlite.node.ts, src/core/session/message-updater.ts, src/core/session/projector.test.ts, src/gyccode/permission/index.ts, src/gyccode/tool/shell.ts ...

- [OK] 2026-08-10 [ea9cf3b] feat(session): model capability gap closure — usage-anchor estimation, memory-summary fast path, thinking-keywords upgrade, tool-stall detection, configurable stream idle timeout, LSP 10MB guard, compaction budget carryover
  - [FILES] 14: docs/claude-code-capability-gap-analysis.md, src/core/v1/config/config.ts, src/gyccode/session/compaction.ts, src/gyccode/session/llm-timeout.test.ts, src/gyccode/session/llm-timeout.ts, src/gyccode/session/llm.ts ...

- [OK] 2026-08-10 [84421e3] feat(session): session list content dedupe with cross-page mitigation
  - [FILES] 4: src/core/session/dedupe.test.ts, src/core/session/dedupe.ts, src/gyccode/cli/cmd/session.ts, src/server/handlers/session.ts

- [OK] 2026-08-10 [a2485bb] feat(tui): prompt history dialog with dedupe, search, delete, and preset
  - [FILES] 4: src/tui/component/dialog-history.tsx, src/tui/component/prompt/index.tsx, src/tui/config/keybind.ts, src/tui/prompt/history.tsx

- [OK] 2026-08-10 [de4529a] feat(session): three-tier context warning state (calculateTokenWarningState)
  - [FILES] 2: src/gyccode/session/overflow.test.ts, src/gyccode/session/overflow.ts

- [OK] 2026-08-10 [3d1b309] feat(token): per-block token estimation (estimateBlocks)
  - [FILES] 2: src/core/util/token.test.ts, src/core/util/token.ts

- [OK] 2026-08-10 [decf4c5] feat(provider): shouldEnableThinkingByDefault - reasoning-capable models default to thinking on
  - [FILES] 2: src/gyccode/provider/transform.test.ts, src/gyccode/provider/transform.ts

- [OK] 2026-08-10 [68f2939] feat(session): prompt cache break detection (detectCacheDrift)
  - [FILES] 4: src/gyccode/session/cache-anchor.test.ts, src/gyccode/session/cache-anchor.ts, src/gyccode/session/processor.ts, src/gyccode/session/session.ts

- [OK] 2026-08-10 [66ba02c] feat(lsp): git-ignore filter + 100K result truncation
  - [FILES] 3: src/gyccode/tool/lsp.test.ts, src/gyccode/tool/lsp.ts, src/gyccode/tool/lsp_gitignore.ts

- [OK] 2026-08-10 [344c4af] feat(output-cap): 8K slot reservation -> 64K escalation
  - [FILES] 2: src/gyccode/session/llm/output-cap.test.ts, src/gyccode/session/llm/output-cap.ts

- [OK] 2026-08-10 [33a7da2] feat(compaction): post-compaction cache invalidation hook
  - [FILES] 2: src/core/v1/config/config.ts, src/gyccode/session/compaction.ts

- [OK] 2026-08-10 [7724cb6] feat(overflow): [1m] upgrade suggestion (maybeSuggest1mUpgrade)
  - [FILES] 1: src/gyccode/session/overflow.ts

- [OK] 2026-08-11 [28f9702] fix(compaction): clear frozen truncation cache after compaction
  - [FILES] 2: src/gyccode/session/compaction.ts, src/gyccode/session/message-v2.cache.test.ts

- [OK] 2026-08-11 [034910f] fix(llm): repair request.ts structure and thinking budget injection
  - [FILES] 3: src/gyccode/provider/transform.test.ts, src/gyccode/session/llm.ts, src/gyccode/session/llm/request.ts

- [OK] 2026-08-11 [165dbc1] docs(compose): add five-metrics capability closure plan and full-eval report
  - [FILES] 2: docs/compose/plans/2026-08-10-model-capability-five-metrics-closure.md, docs/compose/reports/model-capability-five-metrics-full-eval-2026-08-10.md

- [OK] 2026-08-11 [ad0c429] feat(compaction): pivot partial compaction (up_to) via summarize API
  - [FILES] 6: docs/compose/specs/2026-08-11-pivot-partial-compaction-design.md, src/gyccode/server/routes/instance/httpapi/groups/session.ts, src/gyccode/server/routes/instance/httpapi/handlers/session.ts, src/gyccode/session/compaction-pivot.test.ts, src/gyccode/session/compaction.ts, src/schema/v1/session.ts

- [OK] 2026-08-11 [6657a3c] docs(eval): correct thinkback mislabel
  - [FILES] 2: docs/claude-code-capability-gap-analysis.md, docs/compose/reports/model-capability-five-metrics-full-eval-2026-08-10.md

- [OK] 2026-08-11 [d73432c] docs(agents): add mandatory post-task reflection/learning rule
  - [FILES] 1: AGENTS.md

- [OK] 2026-08-11 [8d66918] fix(copilot): fall back to all usable models when picker set is empty (free plans)
  - [FILES] 1: src/gyccode/plugin/github-copilot/copilot.ts

- [OK] 2026-08-11 [81b5226] 修复 Windows 控制台乱码并打通 provider 凭据可用性
  - [FILES] 3: src/gyccode/auth/index.ts, src/gyccode/provider/provider.ts, src/tui/terminal-win32.ts

- [OK] 2026-08-11 [65950fb] 修复 session list 只显示 1 条：dedupe 内容指纹改用 part 表（原误用遗留空表 session_message）
  - [FILES] 2: src/core/session/dedupe.test.ts, src/core/session/dedupe.ts

- [OK] 2026-08-11 [d8c8444] 优化 DeepSeek 官方通道缓存命中：日期移出前缀+记忆会话级固定+微压缩阈值0.9/前缀保留20，新增 cache-probe 实测脚本
  - [FILES] 6: scripts/cache-probe.mjs, src/gyccode/session/compaction.ts, src/gyccode/session/microcompact-select.test.ts, src/gyccode/session/microcompact-select.ts, src/gyccode/session/prompt.ts, src/gyccode/session/system.ts

- [OK] 2026-08-11 [9799f73] 修正日期缓存方案：DeepSeek 对 system 任何变化整段失效，日期改为注入最新 user 消息（实测跨天轮 92.9% vs 0%），新增 cache-compare 对照脚本
  - [FILES] 3: scripts/cache-compare.mjs, src/gyccode/session/prompt.ts, src/gyccode/session/system.ts

- [OK] 2026-08-11 [943527c] 缓存增量预算护栏：小上下文窗口模型(DeepSeek 128K)单条工具输出注入≤1.5K字符/单消息≤24K字符，冻结决策保前缀稳定；cache-probe 支持 toolRows 参数，实测120轮小增量综合命中率98.31%达标
  - [FILES] 4: scripts/cache-probe.mjs, src/gyccode/session/message-v2.cache.test.ts, src/gyccode/session/message-v2.ts, src/gyccode/session/prompt.ts

- [OK] 2026-08-11 [798a458] feat(ops): 新增数据目录维护脚本 maintain-data（dry-run/checkpoint/clean）并记录 2026-08-11 资源优化过程（记忆提取失败冷却+small_model 修复已在并行提交落地）
  - [FILES] 2: docs/RESOURCE-OPTIMIZATION-2026-08-11.md, scripts/maintain-data.mjs

- [OK] 2026-08-11 [dc5f2ce] feat(ops): maintain-data 新增 --prune-events 事件增量保留（空闲>24h 会话裁剪 part.updated 中间快照，保留每 part 最新一条）；删除 571MB 备份残留并记录
  - [FILES] 2: docs/RESOURCE-OPTIMIZATION-2026-08-11.md, scripts/maintain-data.mjs

- [OK] 2026-08-11 [e7babdc] 编码治理：read/子进程/ripgrep 编码探测与自适应解码（UTF-8 严格失败回退 GB18030），配置解析统一剥离 BOM，worklog 兼容 GBK；新增 core/util/text-encoding 工具与测试
  - [FILES] 16: README.md, scripts/worklog-sync.mjs, src/core/config.ts, src/core/process.ts, src/core/ripgrep.ts, src/core/ripgrep/binary.ts ...

- [OK] 2026-08-11 [1462ef9] docs(ops): 记录 event 保留期 8h 实际裁剪（12h 不裁 9h 空闲会话，改 8h 回收 9MB→3.6MB）与多实例收敛（3→1，仅留当前实例 6544）
  - [FILES] 1: docs/RESOURCE-OPTIMIZATION-2026-08-11.md

- [OK] 2026-08-11 [4b4bb19] P0-2 方案A落地：iconv-lite 编码感知写回，GBK/GB18030 文件读改写不再乱码
  - [FILES] 10: package.json, src/core/file-mutation.ts, src/core/tool/apply-patch.ts, src/core/tool/edit.ts, src/core/util/text-encoding.test.ts, src/core/util/text-encoding.ts ...

- [OK] 2026-08-11 [7db72f9] 修复26处TS类型错误+底部区对齐+provider向导简化：编码/BOM/prompt/消息/向导类型清零，subagent-footer统一usage limit格式并补状态显示，custom-provider保存即用，compose同步脚本与上下文侧边栏增强
  - [FILES] 23: build.mjs, scripts/sync-compose.mjs, src/core/util/text-encoding.test.ts, src/gyccode/effect/runtime-flags.ts, src/gyccode/session/message-v2.date.test.ts, src/gyccode/session/message-v2.ts ...

- [OK] 2026-08-11 [a198a62] 极简主义清理：删除无生产引用的 src/ui 组件库（157文件），仅保留 TUI 音效包 @gyccode/ui/audio，修复 jsxDEV 测试崩溃，全量测试 353 全绿
  - [FILES] 1559: src/ui/assets.d.ts, src/ui/assets/favicon/apple-touch-icon-v3.png, src/ui/assets/favicon/apple-touch-icon.png, src/ui/assets/favicon/favicon-96x96-v3.png, src/ui/assets/favicon/favicon-96x96.png, src/ui/assets/favicon/favicon-v3.ico ...

- [OK] 2026-08-11 [72f46be] 修复TUI启动抖动：固定dark模式立即渲染，不再等待终端主题探测
  - [FILES] 2: src/tui/app.tsx, src/tui/context/theme.tsx

- [OK] 2026-08-11 [8f79e8e] 修复会话默认标题UTC时间与本机不一致：改用本地时间格式化，兼容旧Z格式标题识别
  - [FILES] 4: src/core/session.ts, src/core/util/date.ts, src/gyccode/session/session.ts, src/tui/util/session.ts

- [OK] 2026-08-12 [da08605] 修复 LLM 流空闲超时：默认 300s 提升至 600s，idle timeout 错误改为可自动重试
  - [FILES] 9: src/core/util/date.test.ts, src/core/util/date.ts, src/core/v1/config/config.ts, src/gyccode/session/llm-timeout.test.ts, src/gyccode/session/llm-timeout.ts, src/gyccode/session/retry.test.ts ...

- [OK] 2026-08-12 [4656ac6] 稳定性：全局 LLM 流并发闸，解决 10 子代理并行打爆通道与 CPU 峰值
  - [FILES] 4: src/core/v1/config/config.ts, src/gyccode/session/llm-timeout.test.ts, src/gyccode/session/llm-timeout.ts, src/gyccode/session/llm.ts

- [OK] 2026-08-12 [3e4813b] 修复 SSE wrapSSE 定时器泄漏与 mDNS 错误静默
  - [FILES] 4: src/core/aisdk.test.ts, src/core/aisdk.ts, src/gyccode/provider/provider.ts, src/gyccode/server/mdns.ts

- [OK] 2026-08-12 [bfcec9d] 修复 Session.patch read-modify-write 竞态：新增 per-session keyed lock
  - [FILES] 3: src/gyccode/session/keyed-lock.test.ts, src/gyccode/session/keyed-lock.ts, src/gyccode/session/session.ts

- [OK] 2026-08-12 [a11497d] 激活 dream 记忆合成 + wrapSSE 去重 + 死代码清理
  - [FILES] 8: src/core/aisdk.ts, src/gyccode/memory/dream-runner.test.ts, src/gyccode/memory/dream-runner.ts, src/gyccode/memory/team.ts, src/gyccode/provider/provider.ts, src/gyccode/session/proactive.ts ...

- [OK] 2026-08-12 [56491fa] 清理幽灵目录与废弃代码，修复 benchmark 并行 flaky
  - [FILES] 41: src/gyccode/benchmark/benchmark.test.ts, src/gyccode/cli/keybindings.ts, src/gyccode/effect/bootstrap-runtime.ts, src/plugin/example-workspace.ts, src/plugin/example.ts, src/plugin/index.ts ...

- [OK] 2026-08-12 [b8d69e1] 修正 benchmark 测试过时路径
  - [FILES] 1: src/gyccode/benchmark/benchmark.test.ts

- [OK] 2026-08-12 [6ca0026] debug 插件 /tmp 路径改为平台无关 + 新增架构评估报告
  - [FILES] 2: docs/compose/reports/2026-08-12-architecture-convergence.md, src/gyccode/control-plane/dev/debug-workspace-plugin.ts

- [OK] 2026-08-12 [3b5dc7c] 新增待设计清单 docs/compose/TODO-DESIGN.md（7 项待决策 + 已决策追溯）
  - [FILES] 1: docs/compose/TODO-DESIGN.md

- [OK] 2026-08-12 [7511c3f] 新增硬件性能审计报告（六问题深挖）
  - [FILES] 1: docs/compose/reports/2026-08-12-hardware-perf-audit.md

- [OK] 2026-08-12 [9997d77] 优化: v2 LLM Delta 事件改为 publishLive 不落库（治本）
  - [FILES] 1: src/core/session/runner/publish-llm-event.ts

- [OK] 2026-08-12 [6d25c24] 新增 db cleanup 子命令：清理孤儿事件 + VACUUM + WAL checkpoint
  - [FILES] 1: src/gyccode/cli/cmd/db.ts

- [OK] 2026-08-12 [617a687] 优化 TUI 流式渲染：scrollback commit 30ms 时间节流
  - [FILES] 1: src/gyccode/cli/cmd/run/footer.ts

- [OK] 2026-08-12 [ab240ed] 内存优化: scrollback 语法高亮默认关闭（GYCCODE_SYNTAX_HIGHLIGHT=1 恢复）
  - [FILES] 1: src/gyccode/cli/cmd/run/theme.ts

- [OK] 2026-08-12 [ee269ce] 内存优化: markdown/code 渲染降为纯文本（GYCCODE_SYNTAX_HIGHLIGHT=1 恢复）
  - [FILES] 1: src/gyccode/cli/cmd/run/scrollback.surface.ts

- [OK] 2026-08-12 [9d55434] 缓存命中率闭环: 新增 db cache 诊断命令
  - [FILES] 1: src/gyccode/cli/cmd/db.ts

- [OK] 2026-08-12 [59b2472] 更新硬件性能审计报告：记录内存专项（降级渲染）+ 缓存闭环结论
  - [FILES] 1: docs/compose/reports/2026-08-12-hardware-perf-audit.md

- [OK] 2026-08-12 [f2949e6] 幻觉率优化: beast/trinity/gpt 提示词补充统一幻觉防护段落
  - [FILES] 3: src/gyccode/session/prompt/beast.txt, src/gyccode/session/prompt/gpt.txt, src/gyccode/session/prompt/trinity.txt

- [OK] 2026-08-12 [f9dd559] 缓存命中率优化: openai-compatible provider 补设 promptCacheKey
  - [FILES] 1: src/gyccode/provider/transform.ts

- [OK] 2026-08-12 [8300e4f] 架构ROUND3: 中间态事件不落库治本DB膨胀+幻觉防护全模型覆盖+bun直跑冷启动1.26s+ERROR日志限流
  - [FILES] 11: bin/gyc, docs/compose/reports/2026-08-12-arch-round3.md, src/core/observability/logging.ts, src/gyccode/session/processor.ts, src/gyccode/session/prompt/anthropic.txt, src/gyccode/session/prompt/codex.txt ...

- [OK] 2026-08-12 [b3ad5cc] UI调整: 工作区Context摘要从首页移至会话侧边栏展示
  - [FILES] 2: src/tui/routes/home.tsx, src/tui/routes/session/sidebar.tsx

- [OK] 2026-08-12 [463fd17] 配置: LLM流增加first_token_timeout_ms首token超时配置, 空流快速失败不再阻塞主循环
  - [FILES] 7: .temp-stab.cjs, src/core/v1/config/config.ts, src/gyccode/session/llm-timeout.test.ts, src/gyccode/session/llm-timeout.ts, src/gyccode/session/llm.ts, src/gyccode/session/retry.test.ts ...

- [OK] 2026-08-12 [795db12] 清理: 移除误提交的.temp-stab.cjs临时调试脚本并加入gitignore
  - [FILES] 2: .gitignore, .temp-stab.cjs

- [OK] 2026-08-12 [e3546d8] 稳定性: LLM首事件快速失败+重试总时长上限, 修复provider超时导致runLoop静默阻塞数分钟
  - [FILES] 5: src/gyccode/session/llm-timeout.test.ts, src/gyccode/session/llm-timeout.ts, src/gyccode/session/llm.ts, src/gyccode/session/retry.test.ts, src/gyccode/session/retry.ts

- [OK] 2026-08-12 [a379b5d] perf: 第三轮架构审查修复 - 缓存反模式/记忆搜索/死依赖清理
  - [FILES] 20: build.mjs, docs/architecture-review-2026-08-12-round2.md, docs/architecture-review-2026-08-12-round3.md, package.json, scripts/verify-external.mjs, src/core/database/database.ts ...

- [OK] 2026-08-12 [f4c0aa5] build: 构建前清理 dist 目录，避免多轮构建产物残留叠加
  - [FILES] 1: build.mjs

- [OK] 2026-08-12 [b080c58] docs: 新增 gyc-cli vs Claude Code 29 项能力对比 + 金指标评估
  - [FILES] 1: docs/claude-code-capability-comparison.md

- [OK] 2026-08-12 [c8e4dad] 重构: 剥离 opencode 外部依赖，SDK/plugin 客户端本地化（纯自研化第一阶段）
  - [FILES] 242: docs/BUG-REVIEW-2026-08-12-round2.md, docs/BUG-REVIEW-2026-08-12.md, package.json, src/core/config/plugin/external.ts, src/core/plugin.ts, src/core/plugin/host.ts ...

- [OK] 2026-08-12 [43cd794] 品牌: 阶段 3 品牌清理——替换 30 处品牌暴露字符串（纯自研化收尾）
  - [FILES] 17: scripts/brand-clean.py, src/core/plugin/provider/kilo.ts, src/core/plugin/provider/llmgateway.ts, src/core/plugin/provider/nvidia.ts, src/core/plugin/provider/openrouter.ts, src/core/plugin/provider/vercel.ts ...

- [OK] 2026-08-12 [2c41ae7] 文档: 修正能力对比报告 4 处失实（AI 独立复核）——gyc 占优 21→18，持平 7→10
  - [FILES] 1: docs/claude-code-capability-comparison.md

- [OK] 2026-08-12 [aeaba1a] 合规: 双 LICENSE 落地 + README 派生关系披露（纯自研化 P0）
  - [FILES] 2: LICENSE-gyc, README.md

- [OK] 2026-08-12 [a86802e] 基础设施: P1 去 opencode 化——Web UI 可配置 + 安装链路自持 + GitHub App 检测本地化
  - [FILES] 4: scripts/install.sh, src/gyccode/cli/cmd/github.handler.ts, src/gyccode/installation/index.ts, src/gyccode/server/shared/ui.ts

- [OK] 2026-08-12 [8ef59c7] 文档: 新增去 opencode 化 Roadmap（自建后端三项：账号/分享/额度）+ README 引用
  - [FILES] 2: README.md, docs/ROADMAP-2026-08-12.md

- [OK] 2026-08-12 [7e71567] 基础设施: P1 剩余三项全部落地——自建账号/分享/额度服务 + 客户端全端点可配置
  - [FILES] 9: README.md, docs/ROADMAP-2026-08-12.md, services/README.md, services/account/server.ts, services/share/server.ts, src/core/plugin/provider/gyccode.ts ...

- [OK] 2026-08-12 [13d9b88] 基础设施: 补最后两处漏网——CLI 登录 URL 可配置 + 社交卡片自建 SVG
  - [FILES] 3: services/share/server.ts, src/gyccode/cli/cmd/account.ts, src/gyccode/cli/cmd/github.handler.ts

- [OK] 2026-08-12 [6a8652f] 文档: 内核依赖评估——vendored opencode 代码（8.98 万行）规模/风险/选项分析
  - [FILES] 1: docs/OPENCODE-KERNEL-EVALUATION-2026-08-12.md

- [OK] 2026-08-12 [e437d0b] 内核升级: vendored opencode 基线 v1.18.14 → 1.18.16（11 文件 TUI 层补丁，保留全部本地化）
  - [FILES] 12: docs/OPENCODE-KERNEL-EVALUATION-2026-08-12.md, src/tui/clipboard.ts, src/tui/component/prompt/index.tsx, src/tui/config/index.tsx, src/tui/context/sync.tsx, src/tui/routes/session/index.tsx ...

- [OK] 2026-08-12 [641fbf0] P0-2 前缀稳定: memories 从 system 移出, 注入最后 user 消息增量（对齐 pi CH 99.9% 机制）
  - [FILES] 1: src/gyccode/session/prompt.ts

- [OK] 2026-08-12 [c849c9e] P1-1a deepseek 链路观测增强: CH 趋势视图 + 超时审计日志
  - [FILES] 2: src/gyccode/cli/cmd/db.ts, src/gyccode/provider/provider.ts

- [OK] 2026-08-13 [55c77d6] P1 修复: @include 指令展开失效——withIncludes Effect 未 yield* 被模板字符串转储
  - [FILES] 2: src/gyccode/session/instruction-system-spec.test.ts, src/gyccode/session/instruction.ts

- [OK] 2026-08-13 [d0ba368] 重构: 代码去重精炼批次——PKCE/资源格式化/path-display/slug/context-metrics 提取共享模块 + schema-error 中间件收敛 + id.ts 改用 schema/identifier + DeepSeek CH 缓存 token 解析
  - [FILES] 43: src/core/config/plugin/provider.ts, src/core/plugin/models-dev.ts, src/core/plugin/provider/gyccode.ts, src/core/plugin/provider/openai.ts, src/core/plugin/variant.ts, src/core/util/pkce.ts ...

- [OK] 2026-08-13 [79da22c] 修复: BUG-REVIEW P2 批次——objcpp 扩展名补点/jdtls 临时目录退出清理/transport-ide shell 注入防护(单引号+整数化)/原子写失败清理 tmp 孤儿/冗余 400 条件精简/browser 超时后监听清理/resume 文案乱码
  - [FILES] 12: src/core/plugin/provider/snowflake-cortex.ts, src/gyccode/lsp/server.ts, src/gyccode/lsp/serverExtensions.test.ts, src/gyccode/mcp/browser.ts, src/gyccode/mcp/transport-ide.ts, src/gyccode/mcp/transportIde.test.ts ...
