# gyc 三端对标 Claude Code / Codex 差距分析

> 日期：2026-08-23
> 对标基准：Claude Code（sandbox / bughunter / 命令白名单 / 会话断点）、Codex CLI（自动调试循环 / 会话恢复 / 沙箱）
> 范围：gyc CLI（v1 gyccode）、gyc TUI（src/tui）、gyc Web（src/webapp + src/server，走 v2 core runner）三端一并核查
> 方法：源码逐维度核查（src/gyccode、src/core、src/tui、src/webapp、src/server、src/llm）

---

## 总体结论

1. 基础层（读/写/改/检索/权限/超时/compaction/缓存）完成度较高，约 60%～70%，三端基本对齐。
2. 核心差异化卖点（Compose/Spec/Solo 融合编排）目前是「技能提示词集合」，缺「流程编排引擎 + 用户自定义工作流 + 自动闭环（反思/断点/调试循环）」，这是最大卖点缺口。
3. 安全侧三端不一致：v1（CLI/TUI）有高危命令拦截，v2（Web 执行链）没有；无 OS 级沙箱；无命令白名单配置。
4. 反思复盘循环、步骤断点、自动调试循环、代码库索引、子任务成本汇总均为缺失或占位状态。

---

## 一、基础代码读取 / 文件修改 / 多文件上下文加载

| 能力 | CLI(v1) | TUI(v1) | Web(v2) | 说明 |
|------|---------|---------|---------|------|
| 读文件 | read + read-before-write | 同左 | read + read-filesystem | v2 支持一次读多文件 |
| 写文件 | write | 同左 | write | 已覆盖 |
| 编辑 | edit / patch / apply_patch | 同左 | edit / apply-patch | 已覆盖 |
| 检索 | glob / grep / lsp | 同左 | glob / grep | v2 无 lsp 工具 |
| 增量读缓存 | read-cache 已覆盖 | 同左 | 缺失 | v1 独有 |
| 大文件截断/摘要 | truncate / summarize 已覆盖 | 同左 | 未核查 | v2 无对应工具 |
| 批量读目录 | add-dir 已覆盖 | add-dir 已覆盖 | 缺失 | 三端不一致 |
| diff/回滚 | revert-diff / undo / redo | 同左 | DiffView | 已覆盖 |

**增强建议**
- P1：v2 补齐 summarize/truncate 与 read-cache，避免 Web 端大文件/重复读取浪费 token。
- P1：多文件批量读取的 token 预算控制需三端统一（按 token 预算自动截断）。
- P2：v2 补 lsp 工具，缩小与 Claude Code LSP 集成差距。

---

## 二、Compose / Spec / Solo 融合编排工作流（核心差异化卖点）

**现状**
- 三模式已实现：plan / build / compose（src/gyccode/agent/agent.ts:170-220），TUI 与 Web（ModeSwitcher.tsx）均已接通。
- compose 技能包 17 个：ask / brainstorm / debug / execute / feedback / merge / new-skill / parallel / plan / report / review / subagent / tdd / verify / worktree / gyc-effect-ts-fixes / gyc-perf-optimization（内置捆绑 bundle.gen.ts）。
- MiMo actor 适配：src/gyccode/tool/actor.ts（run / spawn / wait / cancel，后台子代理需环境变量开关）。
- qoder Spec 对应雏形：plan 技能 + plan.md；trea Solo 对应雏形：subagent / actor run。

**核心差距（卖点缺口）**
- P0 无「流程编排引擎」：compose 技能是静态提示词，靠模型自觉按序调用；无流程定义文件（YAML/JSON）、无步骤状态机、无 DAG/并行控制、无失败重定向。
- P0 无「用户自定义工作流配置」：步骤、入口、模型、验证门槛均不可配置。
- P1 Spec 驱动闭环未固化：spec.md 到任务拆解到实现到验证到 spec 更新的生命周期没有代码级保障。
- P1 Solo 深度模式未固化：长任务持久化、断点恢复、单代理深度执行没有产品化。
- P1 TUI/Web 无工作流步骤进度可视化（仅 todo 面板，无阶段/步骤状态机展示）。

---

## 三、任务拆解 / 子 Agent 调度 / 反思复盘 / 步骤断点

**现状**
- task / task-manage（子会话创建、深度防御、权限派生、task_id 恢复子会话）已覆盖。
- actor（MiMo 适配，run 阻塞 / spawn 后台 + wait/cancel）已覆盖（spawn 默认关闭）。
- swarm（多 agent 消息）、general subagent、todo 已覆盖。
- TUI subagent-footer / dialog-subagent 已覆盖；Web 无子代理面板。

**缺失/差距**
- P0 反思复盘循环：源码无 reflect / 复盘实现；建议在 compose 增加「review 后复盘」技能 + 会话级 step-summary 沉淀。
- P0 步骤断点：无 checkpoint / 断点续跑；task_id 只能恢复子会话，主任务步骤无法断点恢复。
- P1 子任务编排：spawn 默认需实验开关，且无「并行扇出 + 依赖合并」编排层。
- P1 Web 端无子代理调度展示/操作。

---

## 四、终端命令执行沙箱 / 命令白名单 / 高危拦截 / 超时终止

**现状**
- v1（CLI/TUI）：shell/security.ts 14 类危险模式，blocked / dangerous / warning 三级，已覆盖；超时 + forceKill 已覆盖。
- v2（Web）：core/tool/bash.ts 超时（默认 2min / 上限 10min）、forceKillAfter 3s、输出 1MB 截断已覆盖；无高危拦截（文件内有明确 TODO）。
- 权限三端统一：ask/allow/deny + external_directory + question 已覆盖。

**缺失/差距**
- P0 Web 端高危拦截缺失，三端行为不一致（v2 bash.ts 未移植 classifyCommand）。
- P0 无 OS 级沙箱：对标 Claude Code（Seatbelt/bubblewrap）、Codex（sandbox）均有，gyc 仅权限询问，等保 3 级入侵防范存在合规风险。
- P1 命令白名单不可配置：permission 仅工具级，无法按命令前缀（如 git push / rm）配置 ask/deny；v1 有 BashArity TODO，v2 无。
- P2 tree-sitter 解析审批（v2 TODO）；P2 PowerShell/cmd 专用处理（v2 TODO，Windows 关键路径）。

---

## 五、Token 精准统计（单次任务 / 子步骤累计 / 项目会话）

**现状**
- message.tokens 持久化（input/output/reasoning/cache.read/cache.write/cost）三端共用。
- TUI：context-metrics（会话累计、cache 命中率）+ tps 已覆盖；Web：StatusBar cost/tokens 已覆盖；CLI：gyc stats（全局/按模型/日均成本）已覆盖。

**缺失/差距**
- P1 单次任务粒度统计：TUI/Web 无「本次 prompt 任务」成本面板（context-metrics 是会话级）。
- P1 子步骤累计：task / actor / swarm 子会话 token 未汇总到父会话（源码无 cost 汇总字段）。
- P2 项目维度统计：CLI stats 无按项目聚合。
- P2 统一定价表：cost 依赖 provider 返回值，本地无单价表，/usage 额度展示缺失。

---

## 六、长上下文裁剪 / 代码库索引 / 增量上下文缓存

**现状**
- compaction：v2 SessionCompaction（自动 / 溢出后 compactAfterOverflow）+ config/compaction（auto/prune/keep/buffer）已覆盖。
- 缓存：llm/cache-policy auto（tools+system+tail:2 滚动断点、Anthropic 4 断点配额）+ bedrock/openai 协议缓存已覆盖。
- v1 read-cache 增量读缓存已覆盖；message-v2 截断统计已覆盖。

**缺失/差距**
- P1 代码库索引缺失：无 bm25 / 符号表 / embedding 索引，大仓库靠 ripgrep 全量扫描；建议引入文件指纹 + 符号表增量索引。
- P1 跨会话上下文缓存：无会话恢复时的上下文复用（Codex 有 session restore）。
- P2 上下文预算自动分页 / 按重要性优先级裁剪策略未配置化。

---

## 七、自动调试循环（报错捕获 / 日志解析 / 自主修复 / 重试上限）

**现状**
- compose:debug 技能（四阶段：根因到修复到验证）已覆盖（提示词级，靠模型自觉）。
- retry.ts：429/5xx 重试上限 5 次、总时长 2min、retry-after 硬上限已覆盖。
- provider-error / tool-error 分类已覆盖。

**缺失/差距**
- P0 无代码级自动调试循环：报错捕获到日志解析到自主修复到验证到重试计数上限未实现。
- P1 bughunter 命令为占位：TUI/CLI 命令面板有名字（session.bughunter），后端无实现。
- P2 测试失败自动定位（test 到最小复现到修复到重跑）未固化。

---

## 八、配置文件（agent 规则 / 模型路由 / 额度策略 / 工作流）

**现状**
- agent 配置：model / variant / request / system / description / mode / steps / permissions 已覆盖。
- provider / mcp / plugin / command / compaction / reference / lsp / watcher / experimental 已覆盖。
- AGENTS.md 加载（全局 + 项目 + @include）已覆盖（instruction-context.ts）。
- 模型路由：llm/route（endpoint / executor / transport / 协议层）已覆盖。
- account / credential 已覆盖。

**缺失/差距**
- P1 工作流自定义配置：无 workflow 定义文件（与维度二联动，卖点核心）。
- P1 额度策略配置：无 budget / quota 用户级策略（account 仅基础数据）。
- P1 模型路由策略配置：缺「按任务类型 / 成本约束 / 优先级」的用户级路由规则。
- P2 TUI/Web 配置管理界面：TUI /config 命令缺失，Web SettingsModal 范围有限。

---

## 三端一致性问题清单（重点）

1. Web（v2 bash）无高危拦截，CLI/TUI（v1 shell）有，行为不一致。
2. TUI/CLI 命令面板占位项：bughunter / ultraplan / insights / advisor / security-review 三端均无后端实现。
3. 运维命令（cost/usage/doctor）TUI/Web 覆盖不足。
4. 子任务成本三端均不汇总。
5. 批量读目录 add-dir 仅 v1/TUI 有。

---

## 建议优先级路线图

**P0（差异化卖点，先做）**
1. 工作流编排引擎 + 用户自定义 workflow 配置（Compose / Spec / Solo 融合落地）。
2. 反思复盘循环 + 步骤断点（checkpoint + 续跑）。
3. 自动调试循环 debug-loop（报错捕获到日志解析到修复到验证到重试上限）。

**P1（安全 / 一致性）**
4. v2 bash 高危拦截对齐 v1（Web 补齐 classifyCommand）。
5. 命令前缀级白名单配置 + OS 级沙箱方案（等保 3 入侵防范）。
6. 子任务成本汇总 + 单任务统计面板（三端）。

**P2（体验 / 成本）**
7. 代码库增量索引（文件指纹 + 符号表）。
8. 跨会话上下文缓存、路由 / 额度策略配置化、Web 配置界面。

---

## 结论

gyc 基础能力已对标 60%～70%；真正的差异化空间集中在「可编排的工作流引擎 + 自动闭环（反思 / 断点 / 调试循环）」三件套。安全侧需先解决 Web 端高危拦截缺失与 OS 沙箱问题，满足等保 3 级要求后再谈对外售卖。