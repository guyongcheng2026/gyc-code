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


---

## 九、产品形态与商业化（谷总追加任务）

### 9.1 CLI 二进制客户端
- 现状：bin/gyc 为 Node launcher，构建产物 dist/（ESM bundle + 内嵌 webapp + compose bundle），运行时依赖 Node/Bun 与 node_modules（provider SDK、node-pty、koffi 外部化）。
- 差距：
  - P1 无单文件原生二进制：未使用 bun --compile / pkg 打包，对外分发需用户自装 Node。
  - P1 安装/分发渠道单一：已有 Installation（npm/github/choco）与 gyc upgrade，但无原生安装包（msi/exe/dmg）。
  - P2 多平台构建矩阵（win/mac/linux）未建立。

### 9.2 VSCode 插件
- 现状：无 VSCode 扩展目录；仅有内置 LSP（vscode-eslint 依赖下载）。
- 差距：
  - P1 新建插件：命令面板提交任务到本地/云端 Agent、侧边栏查看执行日志与会话、diff 视图。
  - P1 后端复用现有 v2 server API（src/server 已含 HTTP + SSE），工作量可控。
  - P2 云端 Agent 对接（与商业化后端联动）。

### 9.3 本地/项目级/全局配置分离
- 现状：全局（xdg config）已覆盖、项目 .gyccode/ 已覆盖、GYCCODE_CONFIG / GYCCODE_CONFIG_DIR 覆盖已覆盖、AGENTS.md（全局+项目+@include）已覆盖；v1/v2 config 双栈并存。
- 差距：
  - P1 三端配置合并顺序与优先级未文档化，v1/v2 config 并存易分裂。
  - P2 项目配置脚手架（gyc init 生成 .gyccode/config.json + AGENTS.md）。
  - P2 TUI/Web 配置编辑界面（TUI /config 命令缺失）。

### 9.4 版本自动更新检查
- 现状：gyc upgrade 命令已覆盖；TUI worker 启动时自动检查（src/gyccode/cli/tui/worker.ts:85）已覆盖。
- 差距：
  - P1 无更新提醒 UI：TUI/CLI 启动无版本提示 badge，Web 无。
  - P1 无更新渠道策略（stable/beta、跳过版本、自动升级开关）。
  - P2 检查频控与匿名上报策略未定义。

### 9.5 商业化后端最小版本（P1，内测后期上线）
| 子项 | 现状 | 差距 |
|------|------|------|
| 用户账号/登录鉴权 | server 仅单密码 Basic Auth（GYCCODE_SERVER_USERNAME/PASSWORD）；account.ts 是第三方 AI 服务账号体系 | P1 引入第三方 Auth（已有 @openauthjs/openauth 可复用），用户注册/登录/JWT |
| 额度/积分系统 | 无 quota/credit 表 | P1 免费额度 + 订阅额度 + 单任务扣减 |
| 用量日志 | message.tokens 已持久化，CLI stats 可统计 | P1 新增任务级 usage_log（token/耗时/模型/失败原因），三端统一上报 |
| 简易管理面板 | webapp 无 admin 视图 | P1 用量仪表盘 + 成本监控，扩展 server /admin 路由组 |
| 订阅状态管理 | 无 | P1 仅状态标记（active/trial/cancelled/expired），支付对接延后 |

**商业化落地建议**
- 复用 v2 server（src/server）扩展 /admin 路由组；鉴权升级多用户 JWT。
- usage_log 与现有 message.tokens 打通，避免双写。
- 管理面板放 webapp 新路由 admin/，沿用现有组件风格。

---


---

## 十、评测与质量（P1）

**现状**
- benchmark.test.ts 仅有基础冒烟（验证 compose 技能系统存在性）。
- 无 SWE-Bench 接入、无企业垂直测试集、无失败样本库、无反馈表单。

**差距**
- P1 接入 SWE-Bench：harness 需支持「任务 = 代码修改 + 测试验证」模式（可复用 compose verify 技能），输出 JSON 报告（pass@1 / 耗时 / token 消耗）。
- P1 自建企业 Java/Spring/Vue 垂直用例集：与 ECP / HR 项目联动，形成任务题库（任务描述 + 基线 + 验证脚本 + 参考实现）。
- P1 错误案例收集 / 失败样本库：运行时捕获（会话失败事件 + tool error + 权限拒绝）落库，定期回归迭代优化。
- P1 内测反馈表单：Web 表单或第三方问卷，关联会话 ID，回流失败样本库。

---

## 十一、资质与文档（P2）

**现状**
- README 基础介绍已覆盖；docs/ 有内部工作与评估文档；LICENSE 为 MIT。

**差距**
- P2 软著申请材料：源代码文档（前 60 页 / 后 30 页格式）、软件说明书、申请表。
- P2 用户文档：CLI 命令手册（可由 --help 自动生成）、插件使用文档、编排模式说明（plan / build / compose + workflow）。
- P2 合规文档：隐私政策、用户协议、AI 生成内容免责声明。
- P2 公开材料：README 完善、GitHub 公开文档、演示案例仓库（demo 项目 + 演示录屏）。

---

## 十二、暂不纳入 MVP（延后迭代）

- Web 端完整控制台（当前 webapp 定位为会话 UI，不做完整控制台）。
- 团队空间（协作、共享会话、成员管理）。
- 多租户系统（租户隔离、租户管理）。
- JetBrains 全系列插件（VSCode 插件为 P1 优先，JetBrains 延后）。
- Docker 私有化企业部署包（镜像编排、一键部署）、等保适配与完整审计日志——注：等保三级（身份鉴别 / 访问控制 / 安全审计 / 入侵防范 / 数据完整性 / 保密性 / 备份恢复）为合规硬性要求，基础版需先行满足最小合规（登录审计、权限留痕），企业版再补完整留存、防篡改与日志导出。
- 完整企业工单、客户管理系统（先以最小管理面板承载用量统计与成本监控）。

> 该边界与 9.5 商业化后端「单用户 + 管理面板」最小版本呼应，避免过早引入多租户复杂度。

## 结论（更新）

gyc 基础能力已对标 60%～70%；真正的差异化空间集中在「可编排的工作流引擎 + 自动闭环（反思 / 断点 / 调试循环）」三件套。安全侧需先解决 Web 端高危拦截缺失与 OS 沙箱问题，满足等保 3 级要求。产品形态侧，CLI 原生二进制与 VSCode 插件是「对外可触达」的必需项；商业化后端（账号/额度/用量日志/管理面板/订阅标记）当前接近 0，需在 P1 内测后期前立项补齐。

## 结论

gyc 基础能力已对标 60%～70%；真正的差异化空间集中在「可编排的工作流引擎 + 自动闭环（反思 / 断点 / 调试循环）」三件套。安全侧需先解决 Web 端高危拦截缺失与 OS 沙箱问题，满足等保 3 级要求后再谈对外售卖。