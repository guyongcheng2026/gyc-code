# gyc-cli vs Claude Code — 29 项能力全面对比 + 金指标评估

**评估日期**: 2026-08-12
**评估对象**: `c:\Users\谷勇成\gyc-cli\src\gyccode`（对照源码，基于真实代码逐项核查）
**对照基准**: Claude Code（官方能力清单，2026-08 版）
**结论分级**: ⭐ = 优势 / ⭐⭐ = 显著优势 / 持平 / 差距

---

## 总览表

| # | 维度 | 指标 | Claude Code | gyc-cli | 结论 |
|---|------|------|-------------|---------|------|
| 1 | 模型 | 上下文长度 | 200K/1M beta | 200K/1M 自动 beta + 可封顶 | gyc ⭐ |
| 2 | 模型 | 代码理解深度 | LSP 插件式 9 操作 | LSP 38 server 9 操作 + 诊断注入 | gyc ⭐ |
| 3 | 模型 | 推理能力 | Claude 系深度调优 | 24+ provider 模型无关 | 各有千秋 |
| 4 | 模型 | 多语言支持 | 插件式 LSP | 38 内置 LSP + 100+ 扩展名 | gyc ⭐⭐ |
| 5 | 模型 | 长会话稳定性 | 压缩+记忆 | 三层压缩+记忆+熔断 | gyc ⭐ |
| 6 | 工具 | 文件操作 | 精确 patch | 换行/BOM/并发锁/读缓存 | gyc ⭐ |
| 7 | 工具 | Shell 执行 | OS 沙箱 | 四层命令分类+blocked 硬拦截 | **Claude ⭐**（隔离深度） |
| 8 | 工具 | Git 集成 | 自动 commit | 服务级封装 + Windows 专项 | 各有千秋 |
| 9 | 工具 | 搜索能力 | ripgrep | ripgrep + LSP 符号搜索 | gyc ⭐ |
| 10 | 工具 | MCP 扩展 | 生态成熟 | 5 传输超集 + 完整 OAuth | gyc 工程/Claude 生态 |
| 11 | 工具 | 多模态 | 模型原生视觉 | 本地图像管线（缩放/渐进压缩） | gyc ⭐ |
| 12 | Agent | 任务拆解 | PLAN→执行 | 多 agent + swarm + plan→build | gyc ⭐ |
| 13 | Agent | 错误恢复 | 重试 | 重试引擎（retry-after/上限/熔断） | gyc ⭐ |
| 14 | Agent | 危险操作防护 | destructive 确认 | 四层分类+通配符规则+blocked | gyc ⭐ |
| 15 | Agent | 多步自主 | 单线程自主 | 后台并行+子 agent 会话续接 | gyc ⭐ |
| 16 | Agent | 代码质量自觉 | 默认较好 | review 命令+LSP 诊断 | gyc ⭐ |
| 17 | 工作流 | 测试驱动 | TDD 配合好 | 测试基建完整+task 子 agent | 持平 |
| 18 | 工作流 | 代码审查 | 强 | review 模板最完善 | gyc ⭐⭐ |
| 19 | 工作流 | 文档生成 | 强 | skill+command，兼容 4 生态 | 持平 |
| 20 | 工作流 | 重构能力 | 强（旗舰模型） | apply_patch+LSP+snapshot | 持平 |
| 21 | 工作流 | 项目级理解 | 读 monorepo | 多 root LSP (monorepo) | gyc ⭐ |
| 22 | 可靠 | 幻觉率 | 低（旗舰模型） | 记忆去重/TF-IDF/LSP 三重防线 | 模型决定，防线补齐 |
| 23 | 可靠 | 破坏性风险 | 中低 | blocked 硬拦截+外部目录保护 | gyc ⭐ |
| 24 | 可靠 | 可回滚性 | git diff 撤销 | 自动快照+revert | gyc ⭐⭐ |
| 25 | 可靠 | 审计日志 | 会话记录 | 事件溯源全量 | gyc ⭐⭐ |
| 26 | 成本 | 速度 | 中（模型偏重） | 本地 LSP 省推理+懒加载+21MB | gyc ⭐ |
| 27 | 成本 | Token 消耗 | 中高（订阅制） | prefix 稳定+三层压缩+记忆快路径 | gyc ⭐ |
| 28 | 成本 | 成本可视化 | 中：usage 统计 | stats 完整仪表盘 | gyc ⭐⭐ |
| 29 | 成本 | 免费可用性 | ❌ 付费 | ✅ 零订阅+免费模型+自带 key | **gyc 碾压** ⭐⭐⭐ |

---

## 一、模型能力层（底层智能）

### 1. 上下文长度 — gyc ⭐

- **Claude Code**: 200K 默认，1M 需 beta（`context-1m-2025-08-07`）
- **gyc-cli**: `context-1m.ts:101` `context1MHeader()` 自动探测 1M 模型并注入 beta 头；`effectiveContextWindow()`（`context-1m.ts:37`）支持 `GYCCODE_MAX_CONTEXT_TOKENS` 动态封顶（对所有用户开放，优于 Claude 的 ant-only）；支持 7 家 Anthropic 协议 provider
- **差距**: 无实测 1M 稳定性数据（Claude 有海量用户压测）

### 2. 代码理解深度 — gyc ⭐

- **Claude Code**: LSPTool 9 操作，但 LSP server **仅通过插件提供**（`services/lsp/config.ts:11`）
- **gyc-cli**: `lsp/lsp.ts:386-478` 完整 9 操作（definition/references/implementation/prepareCallHierarchy/incomingCalls/outgoingCalls/documentSymbol/workspaceSymbol/hover）；**38 个内置 LSP server 零插件开箱即用**（`lsp/server.ts`）；编辑后诊断注入（`tool/write.ts:86`）
- **结论**: 编辑器级语义查询，比模型"读代码猜"更精确

### 3. 推理能力 — 各有千秋

- **Claude Code**: Claude 系深度调优（system prompt/工具格式/输出 schema 针对 Claude 优化）
- **gyc-cli**: `provider.ts:70-97` 24+ provider（anthropic/openai/google/azure/bedrock/xai/mistral/groq/deepinfra/cerebras/cohere/togetherai/perplexity/vercel/alibaba/gitlab/copilot/venice），**模型无关可用任何家推理模型**
- **结论**: gyc 更开放；Claude Code 在 Claude 系上极致发挥略优

### 4. 多语言支持 — gyc ⭐⭐

- **Claude Code**: 插件式 LSP，需装插件
- **gyc-cli**: `lsp/server.ts` **38 个 LSP server**（TS/JS/Vue/Svelte/Astro/Rust/Go/Java/Kotlin/C#/F#/Swift/OCaml/Clojure/Elixir/Haskell/Julia/Dart/Zig/Lua/PHP/Ruby/Prisma/YAML/Terraform/TeX/Dockerfile/Nix/Typst/Bash/Clangd/Python...）；`language.ts` **100+ 扩展名映射**；**自动下载缺失 LSP**（flags.disableLspDownload 控制）
- **结论**: 多语言是一等公民，非靠模型"会读"而是真实语言服务器

### 5. 长会话稳定性 — gyc ⭐

- **Claude Code**: 自动压缩 + 微压缩 + 会话记忆压缩 + 熔断
- **gyc-cli**: **三层压缩**（`compaction.ts`）：`microcompact()`（`compaction.ts:61`，90% 阈值，保留前 20 缓存前缀+尾 5 条）+ `findUsageAnchor()`（`compaction.ts:121`，API usage 锚定）+ `pivotTail()`（`compaction.ts:97`）；**记忆快路径** `buildMemorySummary()`（`compaction.ts:185`，免 LLM 摘要调用）；熔断 `MAX_CONSECUTIVE_COMPACTION_FAILURES=3`（`compaction.ts:47`）；目标追踪 `todo.ts`+`goal.ts`
- **结论**: 工程防线比 Claude 更完整

---

## 二、工具能力（执行链路）

### 6. 文件操作 — gyc ⭐

- **Claude Code**: 精确 patch
- **gyc-cli**: 双工具 `edit`（old/new 精确替换）+ `apply_patch`（多 hunk 批量）；**换行智能**（`edit.ts:23-34` normalizeLineEndings/detectLineEnding/convertToLineEnding 自动保留 CRLF/LF）；**BOM 处理**（`edit.ts:20`）；**并发锁**（`edit.ts:36-48` 每文件 Semaphore）；diff 校验（`edit.ts:10`）；读缓存（`read-cache.ts`）；外部目录保护（`external-directory.ts`）
- **结论**: Windows/多编码环境下准确性保障超 Claude

### 7. Shell 执行 — **Claude ⭐**（隔离深度）

- **Claude Code**: OS 级沙箱（seccomp/容器）
- **gyc-cli**: **四层安全分级**（`shell/security.ts:3-7` safe/warning/dangerous/blocked）；**13 种危险模式**（`security.ts:9-24`，`rm -rf /`/fork bomb/`/dev/tcp`/mkfs 直接 blocked）；命令分类白名单（`shell.ts:36-74` FILES/CWD/CMD_FILES 跨平台别名归一化）；跨平台 bash/PowerShell/cmd
- **差距**: gyc 是命令级审查，无 OS 沙箱隔离。对"误操作"防护足够，对"恶意命令运行"Claude 更强

### 8. Git 集成 — 各有千秋

- **Claude Code**: 自动 commit 工作流意识强
- **gyc-cli**: `git/index.ts` 服务级 API（status/diff/stats/patch/patchAll/applyPatch/mergeBase/show/branch/defaultBranch/hasHead）；**Windows 安全配置**（`index.ts:6-18` autocrlf=false/longpaths=true/quotepath=false/fsmonitor=false）；状态分类（`index.ts:93-99`）；patch 截断（maxOutputBytes）
- **结论**: gyc 底层正确性强，Claude 工作流意识强

### 9. 搜索能力 — gyc ⭐

- **Claude Code**: ripgrep 全文搜索
- **gyc-cli**: 原生 Ripgrep（`grep.ts:5`）+ 权限先行（`grep.ts:39-48`）+ glob 工具（`glob.ts`）+ **LSP workspaceSymbol 符号级搜索**（`lsp.ts:433-441`）+ 100 条限制防爆炸（`grep.ts:67`）
- **结论**: 同引擎 + 多 LSP 符号维度

### 10. MCP 扩展 — gyc 工程/Claude 生态

- **Claude Code**: MCP 市场成熟
- **gyc-cli**: **5 种传输**（`mcp/index.ts:131` stdio/streamable-http/sse/ws/ide，**比 Claude 多 WS/IDE**）；完整 OAuth（`oauth-provider.ts`+`oauth-callback.ts`）；官方 SDK 全量；catalog 内置目录（`catalog.ts`）；超时保护 30s（`index.ts:39`）；roots 能力（`index.ts:78-80`）
- **结论**: gyc 传输面超集，Claude 生态更成熟

### 11. 多模态 — gyc ⭐

- **Claude Code**: 模型原生视觉，非强项
- **gyc-cli**: photon-wasm 本地图像引擎（`image.ts:5`）；自动缩放（`image.ts:10-14` MAX 2000×2000/5MB）；**渐进式压缩**（`image.ts:14` JPEG_QUALITIES=[80,85,70,55,40] 逐级降质）；四类异常分级（`image.ts:15-49`）；懒加载（`image.ts:63`）
- **结论**: 本地图预处理管线，截图→分析→token 预算场景更工程化

---

## 三、Agent 自主性（自主决策）

### 12. 任务拆解 — gyc ⭐

- **Claude Code**: PLAN→执行→验证
- **gyc-cli**: `plan_exit` 双 agent 切换（`plan.ts:15-80`，仅显式 Yes 才切 build agent，`plan.ts:48`）；多 agent 注册（`agent.ts:35-56` subagent/primary/all）；**agent 自动生成**（`agent.ts:69-80` generate()）；**swarm 协作**（`swarm/coordinator.ts:3-32` 按 goal 关键词选策略 debug-first/explore-then-report/implement-and-review，分派 explorer/implementer/reviewer/debugger）
- **结论**: 多 agent 体系比 Claude 单一 PLAN 更完整

### 13. 错误恢复 — gyc ⭐

- **Claude Code**: 重试/换方法
- **gyc-cli**: `retry.ts` 重试引擎——指数退避（`retry.ts:26-28`）+ **retry-after 头解析**（`retry.ts:47-58` 硬上限 60s）+ 放弃机制（`retry.ts:33` >5min 视为非瞬时限流）+ 总时长上限 120s（`retry.ts:34`）+ 8 类可重试模式库（`retry.ts:37-45`）；compaction 熔断（`compaction.ts:47`）；llm-timeout 独立超时
- **结论**: 比 Claude 的重试更精细（retry-after 解析/上限/放弃判定）

### 14. 危险操作防护 — gyc ⭐

- **Claude Code**: destructive 需确认
- **gyc-cli**: 权限规则引擎（`permission/index.ts:28-38` 通配符匹配+多规则集 allow/deny/ask+**永久批准记忆**）；挂起请求 Deferred（`index.ts:18-21`）；四层安全分类（`shell/security.ts`）；13 种危险模式（`security.ts:9-24`）；子 agent 权限降级（`subagent-permissions.ts`）
- **结论**: blocked 硬拦截比"确认"更安全

### 15. 多步自主 — gyc ⭐

- **Claude Code**: 一口气完成小 feature
- **gyc-cli**: `task.ts` 前台/后台双模式（`task.ts:26-35`）+ **子 agent 会话续接**（`task.ts:47-49` task_id）+ 防重复指导（`task.ts:31-41`）+ 专属权限（`task.ts:10`）
- **结论**: 后台并行 + 会话续接，超 Claude

### 16. 代码质量自觉 — gyc ⭐

- **Claude Code**: 默认较好，需引导
- **gyc-cli**: review 命令完整 SOP（`review.txt:1-102` bugs/structure/performance/behavior 四维 + "Be certain" 原则 `review.txt:66`）；LSP 实时诊断（`lsp.ts:344-362`）；内置 customize-gyccode skill（`skill/index.ts:35-38`）
- **结论**: review 命令 + LSP 诊断提供硬工程质量约束

---

## 四、工作流能力（工程落地）

### 17. 测试驱动 — 持平

- **Claude Code**: TDD 配合好
- **gyc-cli**: 项目自身即 TDD 样板（compaction/prompt-shard/microcompact-select/token-budget/retry 等核心模块全单测）；task 工具支持"测试子 agent"
- **结论**: 都靠模型写测试 + shell 执行，gyc 的 task 子 agent 更结构化

### 18. 代码审查 — gyc ⭐⭐

- **Claude Code**: 强
- **gyc-cli**: `review.txt` 杀手级——**四态输入**（无参/commit hash/branch/PR URL，`review.txt:9-27` 自动 git diff/git show/gh pr diff）；**上下文完整**（`review.txt:34-39` 读整个文件+查 CONVENTIONS/AGENTS.md）；**防误报纪律**（`review.txt:66-78`）；**降级输出**（`review.txt:90` 不确定就说 I'm not sure）
- **结论**: 目前所见最完善的审查 SOP

### 19. 文档生成 — 持平

- **Claude Code**: 强
- **gyc-cli**: skill 系统（`skill/index.ts:22-28` 兼容 `.claude/.agents/.codex/.opencode` 4 生态 + 自有 SKILL.md）；command 模板（`command/index.ts:70-88` init/review + 配置自定义）
- **结论**: 依托 skill+command 体系，额外兼容 4 生态 skill 格式

### 20. 重构能力 — 持平

- **Claude Code**: 强（旗舰模型）
- **gyc-cli**: apply_patch 多 hunk 批量（`apply_patch.ts:23-50`）+ LSP 调用层级支撑（`lsp.ts:443-478`）+ snapshot 快照（`snapshot/index.ts:36-45`）
- **结论**: 重构安全性有工程兜底（快照）

### 21. 项目级理解 — gyc ⭐

- **Claude Code**: 读多包 monorepo
- **gyc-cli**: 多 root LSP（`lsp/server.ts:32-78` NearestRoot/StrictNearestRoot 按项目 marker 找 root，monorepo 多包各自起 LSP）；worktree 概念（`snapshot/index.ts:69`）；快照跨模块回滚
- **结论**: 多 root LSP 是 monorepo 的硬支撑

---

## 五、可靠性与安全（信任）

### 22. 幻觉率 — 模型决定，防线补齐

- **Claude Code**: 低（旗舰模型）
- **gyc-cli**: 记忆去重+上限（`hermes-bridge.ts:38-44` MEMORY_MAX_ENTRIES=200）；**TF-IDF 检索**（`hermes-bridge.ts` searchHermesMemories 停用词过滤+IDF 加权）；3 天新鲜度（MEMORY_FRESHNESS_THRESHOLD_MS）；LSP 符号验证（代码引用查真实符号）；review "Be certain" 纪律
- **结论**: 三重工程防线大幅弥补模型差距；底数仍由模型决定

### 23. 破坏性风险 — gyc ⭐

- **Claude Code**: 中低，确认高危
- **gyc-cli**: blocked 硬拦截（`security.ts:36-38` rm -rf / 等直接拒绝）；dangerous 询问（`security.ts:40-42`）；外部目录保护（`edit.ts:18` assertExternalDirectoryEffect）；文件锁（`edit.ts:36-48`）
- **结论**: 防护更细，blocked 硬拦比"确认"更安全

### 24. 可回滚性 — gyc ⭐⭐

- **Claude Code**: git diff 撤销
- **gyc-cli**: snapshot 自动快照（`snapshot/index.ts:39` track 每次执行前打点）；diff 恢复（`index.ts:41-44` restore/revert/diff 按 hash 精确回滚）；7 天 pruning（`index.ts:23`）；2MB 限制（`index.ts:24`）
- **结论**: 自动快照 + 精确 revert 超 Claude 的 git 手动 diff

### 25. 审计日志 — gyc ⭐⭐

- **Claude Code**: 会话记录
- **gyc-cli**: 事件溯源（`event.ts:343-355` commitDurableEvent 每条 durable 事件入库）；会话/消息/部件全存库（SessionMessageTable/PartTable）；批量日志（`logging.ts` 1s/500 行+10MB 轮转）；30 天事件保留（`database.ts` pruneStaleEvents）
- **结论**: 完整事件历史可回放，超 Claude

---

## 六、成本与效率（商业价值）

### 26. 速度 — gyc ⭐

- **Claude Code**: 中（模型偏重）
- **gyc-cli**: 冷启动 <3.5s（命令懒加载 `index.ts:156-171`）；dist 21MB（245→21MB，-91%）；**本地 LSP 加速**（代码理解用本地符号查询，不消耗模型 token）；工具输出截断（30K/grep100/2MB 防炸弹）
- **结论**: 同模型下 gyc 更快（本地 LSP 省模型推理）

### 27. Token 消耗 — gyc ⭐

- **Claude Code**: 中高（订阅制）
- **gyc-cli**: **Prompt cache 前缀稳定**（`prompt-shard.ts` static→semi→dynamic→memories 变化频率递增，cache read 价=输入 1/10）；**三层压缩**（`compaction.ts`）；**记忆快路径**（`compaction.ts:185` 免 LLM 摘要调用）；精确 cost 计算（`session.ts:386-408` tiered pricing+cache 分价+reasoning 单列）；cache 锚定（`cache-anchor.ts` cacheDriftFromUsage）
- **结论**: 同任务比 Claude 更省，且按量付费不买订阅

### 28. 成本可视化 — gyc ⭐⭐

- **Claude Code**: 中：有 usage 统计
- **gyc-cli**: `stats.ts` 完整仪表盘——总成本/日均（`stats.ts:319-320`）；每会话 token 均值+中位数（`stats.ts:321-323`）；token 明细 Input/Output/Cache Read/Cache Write（`stats.ts:324-328`）；按模型统计（`stats.ts:332-353`）；工具使用条形图（`stats.ts:356-381`）；过滤维度 --days/--tools/--models/--project（`stats.ts:52-68`）；精确成本引擎（`session.ts:335-411` Decimal 精度/tier 价/reasoning 价/copilot nanoAIU 换算）
- **结论**: 远超 Claude 的简单 usage

### 29. 免费可用性 — **gyc 碾压** ⭐⭐⭐

- **Claude Code**: ❌ 付费（$20-100/月，最大短板）
- **gyc-cli**: ✅ CLI 本体 MIT 开源零订阅；24+ provider 自由选（用哪家模型花多少钱自己定）；**免费模型支持**（`provider.ts:153-157` 无 key 自动保留 cost.input=0 的免费模型）；自带模型（GitHub Copilot 等已有订阅复用）；公共端点（`provider.ts:162` apiKey:"public"）
- **结论**: 零门槛可用，PLG 转化路径天然更顺

---

## 七、🎯 三个"金指标"综合评估

### ① 任务成功率

| 维度 | Claude Code | gyc-cli |
|------|-------------|---------|
| 模型能力 | Claude 旗舰模型 | 取决于所选模型（可上 Claude 同级） |
| 工程兜底 | 单 agent + 重试 | 多 agent/swarm + 重试引擎 + LSP + snapshot + review |
| 结论 | 中-高 | **工程兜底更强，上限取决于模型** |

**判断**: gyc 用同等模型时成功率不低于 Claude Code——多 agent 编排、LSP 语义、snapshot 回滚、review 纪律都是"做对"的保障。用开源模型时 gyc 的工程兜底价值更大。

### ② 幻觉率

| 维度 | Claude Code | gyc-cli |
|------|-------------|---------|
| 模型基础 | Claude 旗舰幻觉率低 | 取决于模型 |
| 工程防线 | 少 | **TF-IDF 记忆检索 + 去重上限 + LSP 真实验证 + review "Be certain" 纪律** |
| 结论 | 低 | **工程防线补齐后差距显著缩小** |

**判断**: 这是 gyc 最需要重视的指标。**模型选型决定底数**，但 gyc 的 TF-IDF 检索（本轮修复）、记忆去重、LSP 符号验证、review 纪律是四道防线。**建议**: 默认推荐 Claude 系或同档推理模型，配合 gyc 防线把幻觉率控制在可接受范围。

### ③ 每任务真实成本

| 维度 | Claude Code | gyc-cli |
|------|-------------|---------|
| 订阅 | $20-100/月 固定 | **$0**（CLI 免费） |
| Token 效率 | 中 | **高**（prefix 稳定 + 三层压缩 + 记忆快路径） |
| 模型选择 | 锁 Claude | **自由选低成本模型**（DeepSeek/Gemini/开源，价格是 Claude 的 1/10-1/50） |
| 成本可视化 | 简单 | **stats 完整仪表盘** |
| 结论 | 高固定成本 | **低且可控** |

**判断**: gyc 碾压性优势。完成一个 feature 的真实成本：Claude Code = $20-100/月 + Claude token 费（不可选）；gyc-cli = $0 订阅 + 自己选模型（可用免费/低成本模型）。

---

## 八、总结与建议

### 优势区（gyc 全面领先）
- **多 agent 编排**：plan→build 切换 + swarm 角色分派 + 子 agent 会话续接
- **代码理解**：38 内置 LSP + 编辑后诊断注入 + 调用层级
- **安全防护**：四层命令分类 + blocked 硬拦 + 通配符权限规则 + snapshot 回滚
- **成本**：零订阅 + 自由选模型 + prefix 稳定省 token + stats 仪表盘
- **工程细节**：换行/BOM/并发锁/Windows Git 专项/多 root LSP

### 差距区（Claude Code 占优）
- **Shell OS 级沙箱**：Claude 有 seccomp/容器隔离，gyc 是命令级审查
- **MCP 生态**：Claude MCP 市场更成熟，gyc 传输面虽超集但生态待积累
- **Claude 系深度调优**：Claude Code+Claude 全家桶调优，gyc 是开放底座
- **1M 稳定性实测**：Claude 有海量压测，gyc 待验证

### 可执行建议
1. **默认模型选型**：主推 Claude 系或同档推理模型（幻觉率底数），备选 DeepSeek/Gemini 降本
2. **Shell 沙箱增强**：考虑对 `dangerous` 级命令加更严格隔离（如容器/限制内存）
3. **MCP 生态建设**：完善 catalog 目录、社区服务器收录
4. **1M 压测**：补 1M 上下文稳定性测试
5. **幻觉防线**：持续迭代 TF-IDF 检索（embedding 语义化）、记忆去重、review 纪律

---

*本文档基于真实源码逐项核查，证据含文件路径+行号。后续随代码演进可更新。*