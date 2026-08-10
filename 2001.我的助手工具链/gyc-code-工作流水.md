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
