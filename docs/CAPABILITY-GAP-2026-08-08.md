# gyc-code vs Claude Code 能力清单覆盖评估与追赶计划

日期：2026-08-08（基于 gyc-cli 源码实时核查，锚点为 `C:\Users\谷勇成\gyc-cli\src`）
对标清单：《Claude Code 源码能力全面复用分析报告》（2026-08-05，A–G 候选 + 已抽 4 包）
方法：逐文件静态核查 + 关键链路调用点验证（区分"已实现"与"已接线"）

---

## 〇、结论摘要

gyc-cli 对 Claude Code 能力清单的**整体覆盖度约 85%**：A/B/E/F/G 与已抽 4 包基本全覆盖且部分为超集；
**真正的硬差距集中在记忆系统（C）与上下文详情（D）**；另有 3 处"已实现但未接线/受限"（microcompact 未接入、WebSearch 被 provider 门控、token 估算无垫高）。

| 模块 | 覆盖度 | 一句话结论 |
|------|--------|-----------|
| 已抽 4 包（prompt/tool-runtime/query/agent） | ✅ 100% | 均有等价实现且更完整（见 §一） |
| A 核心工具集（8 工具） | ✅ 88% | 7/8 全覆盖；WebSearch 被 provider 门控 |
| B 技能系统 | ✅ 100% | 超集：多目录发现 + 远程索引 + compose + 7 内置技能 |
| C 记忆系统 | ⚠️ 50% | 后台提取/整合齐全；**无相关性检索、无时间衰减** |
| D 上下文管理 | ⚠️ 80% | CLAUDE.md/AGENTS.md 加载 ✅；**git 状态仅布尔** |
| E 历史记录 | ✅ 90% | 会话历史+输入历史齐全；pasteStore 缺失（低价值） |
| F 成本追踪 | ✅ 90% | `gyc stats` 统计维度超 Claude；**无预算主动告警** |
| G 任务管理 | ✅ 90% | TodoWrite+Task 超集；无独立 TaskList 工具 |

**追赶优先级**：P0 记忆相关性检索 → P1 git 详情/WebSearch 解绑/microcompact 接线/token 垫高 → P2 时间衰减/预算告警/TaskList/pasteStore。

---

## 一、已抽 4 包逐项对照（全部 ✅）

| 已抽包 | Claude Code 源 | gyc 等价实现 | 锚点 |
|--------|---------------|-------------|------|
| prompt-assembler | `constants/prompts.ts` + `systemPromptSections.ts` | 系统提示组装 + 分片缓存 | `src/gyccode/session/system.ts`、`session/prompt-shard.ts`、`session/llm/request.ts` |
| tool-runtime | `services/tools/toolExecution.ts` | 工具执行 + 截断 + 权限策略 + 插件 Hook | `src/gyccode/tool/tool.ts`、`tool/registry.ts`、`permission/` |
| query-engine | `QueryEngine.ts` | 多轮循环 + 处理器 + 流式 LLM + 429 熔断 | `src/gyccode/session/prompt.ts`（69K）、`session/processor.ts`、`session/llm.ts`、`session/retry.ts` |
| agent-orchestrator | `tools/AgentTool/` | 子代理 + 编排 + swarm 协调 + 权限派生 | `src/gyccode/agent/agent.ts`、`tool/task.ts`、`tool/swarm.ts`、`agent/subagent-permissions.ts` |

补充：`src/STRUCTURE.md` 已建 9 个门面文件（main.tsx/context.ts/history.ts/commands.ts/Tool.ts/Task.ts/QueryEngine.ts/tools.ts/setup.ts），目录结构对齐已完成。

---

## 二、候选 A：核心工具集（8 项）

| Claude 工具 | gyc 等价 | 状态 | 核实要点 |
|-------------|---------|------|---------|
| FileEditTool | `tool/edit.ts`（EditTool）+ `tool/apply_patch.ts`（ApplyPatchTool） | ✅ 覆盖 | GPT 系模型自动切 apply_patch（`registry.ts` tools 筛选） |
| FileReadTool | `tool/read.ts` + `tool/read-cache.ts` | ✅ 覆盖（超集） | 50KB/2000 行双层限制 + 图片/PDF 嗅探 + **mtime/size 去重返回 `<file unchanged>`**（read.ts 已接线） |
| FileWriteTool | `tool/write.ts` | ✅ 覆盖 | — |
| GlobTool | `tool/glob.ts` | ✅ 覆盖 | 固定 100 条 + 截断提示 |
| GrepTool | `tool/grep.ts` | ✅ 覆盖 | ripgrep + 100 条限制 |
| BashTool | `tool/shell.ts` + `tool/shell/security.ts` | ✅ 覆盖 | 危险命令分类 + 权限询问 + 流式落盘回 tail |
| WebFetchTool | `tool/webfetch.ts` | ✅ 覆盖 | 5MB 上限 + 内容截断 |
| WebSearchTool | `tool/websearch.ts` + `tool/mcp-websearch.ts` | ⚠️ 受限 | `registry.ts` `webSearchEnabled()` 仅 gyccode provider 或 exa/parallel flag 启用，**其他 provider 下模型看不到该工具** |

额外超集：TaskTool（子代理任务）、SwarmTool（并行队友）、TodoWriteTool、SkillTool、BriefTool（主动通知）、QuestionTool、PlanExitTool、LspTool、code-mode（实验）。

---

## 三、候选 B：技能系统（✅ 全面覆盖）

| Claude 模块 | gyc 等价 | 状态 |
|-------------|---------|------|
| SkillTool | `tool/skill.ts` | ✅ 按名加载 + ripgrep 列目录 + `<skill_content>` 注入 |
| loadSkillsDir | `skill/index.ts` + `skill/discovery.ts` | ✅ 超集：`.claude/skills`、`.agents/skills`、`{skill,skills}/**/SKILL.md`、`**/SKILL.md` 多模式发现 + 远程索引下载缓存 + compose bundle 技能 |
| bundledSkills | `skill/bundled/`（7 个：brainstorm/debug/loop/review/stuck/tdd/verify）+ 内置 customize-gyccode | ✅ 覆盖 |
| 提示词瘦身 | `system.ts` skills 段 `verbose:false` | ✅ 与 Claude 一致的"列表 + 按需加载"模式 |

---

## 四、候选 C：记忆系统（⚠️ 最大差距区，覆盖 50%）

| Claude 模块 | gyc 等价 | 状态 |
|-------------|---------|------|
| memdir 索引 | `memory/hermes-bridge.ts`（读/写 hermes_gyccode_memory.md） | ⚠️ 文件桥仅"全量读/追加写"，**无索引、无检索** |
| findRelevantMemories | 无等价 | ❌ **缺失（P0）** |
| memoryAge（时间衰减） | 无等价 | ❌ 缺失（P2） |
| memoryTypes | `memory/` 内部 HermesMemoryEntry | ✅ 有结构 |
| 自动提取 | `memory/extract.ts`（每 3 轮、deepseek-chat、去重） | ✅ 覆盖 |
| 自动整合 | `memory/dream.ts`（24h/5 会话/10 条触发） | ✅ 覆盖 |
| 团队记忆 | `memory/team.ts` | ✅ 有实现（默认关闭） |

**差距 C-1【P0】无相关性检索**：Claude 用 Sonnet 选择器从记忆索引里挑最相关的 ~256 token 注入系统提示；gyc 目前记忆要么全量读要么不读，长记忆文件会直接膨胀上下文或完全不可达。追赶时先做"关键词/标签启发式粗筛 + 4KB 预算截断"（低资源友好），LLM 选择器作为 P2 可选。

---

## 五、候选 D：上下文管理（⚠️ 覆盖 80%）

| Claude 模块 | gyc 等价 | 状态 |
|-------------|---------|------|
| context.ts | `src/context.ts` 门面 + `session/system.ts` environment | ✅ 工作目录/平台/日期/references 列表 |
| gitStatus | `system.ts` 仅 `Is directory a git repo: yes/no` | ⚠️ **缺失详情（P1）**：无 branch/dirty/untracked/最近提交 |
| getUserContext（CLAUDE.md） | `session/instruction.ts` | ✅ 超集：AGENTS.md + CLAUDE.md + CONTEXT.md，全局 + 项目 globUp 向上查找 |
| 分片缓存 | `session/prompt-shard.ts` | ✅ 等价 systemPromptSections |

---

## 六、候选 E：历史记录（✅ 覆盖 90%）

| Claude 模块 | gyc 等价 | 状态 |
|-------------|---------|------|
| history.ts 会话记录 | `session/message-v2.ts`（SQLite 消息/部件持久化）+ `session.ts` | ✅ 覆盖 |
| 输入历史 | `cli/cmd/run/prompt.shared.ts`（200 条环形去重） | ✅ 覆盖 |
| 会话恢复 | `cli/cmd/session.ts` + `session.ts` | ✅ 覆盖 |
| pasteStore | 无 | ⚠️ 缺失（P2，低价值：剪贴板哈希去重） |

---

## 七、候选 F：成本追踪（✅ 覆盖 90%）

| Claude 模块 | gyc 等价 | 状态 |
|-------------|---------|------|
| cost-tracker | `cli/cmd/stats.ts`（`gyc stats`） | ✅ 覆盖（维度更多）：总会话/消息/成本/input/output/reasoning/cache read/write/工具使用/模型使用/每日成本/每会话中位数 |
| costHook | `session/message-v2.ts` tokens 持久化 | ✅ 覆盖 |
| 预算告警 | 无 | ⚠️ 缺失（P2）：无"预算阈值 → 主动提示/截断" |

---

## 八、候选 G：任务管理（✅ 覆盖 90%）

| Claude 工具 | gyc 等价 | 状态 |
|-------------|---------|------|
| TodoWriteTool | `tool/todo.ts`（todowrite，SQLite 持久化） | ✅ 覆盖 |
| TaskCreateTool | `tool/task.ts`（TaskTool：创建/运行子代理，前台/后台） | ✅ 覆盖（超集，含后台模式） |
| TaskListTool | 无独立工具（`session list` 命令兜底） | ⚠️ 缺失（P2） |

---

## 九、跨切能力对照（STRUCTURE.md 已映射，抽检确认）

| 能力 | gyc 锚点 | 状态 |
|------|---------|------|
| MCP 协议 | `mcp/index.ts`：stdio/SSE/StreamableHTTP/WS + OAuth + catalog + browser | ✅ 覆盖 |
| 插件系统 | `plugin/`：marketplace/install/loader + 8 个 provider 插件 | ✅ 覆盖 |
| 上下文压缩 | `session/compaction.ts`：prune + 熔断 + tool 输出截断；**microcompact 已定义未接线** | ⚠️ 部分 |
| 权限系统 | `permission/`：4 模式 + 分类器 + arity + evaluate/ask/reply | ✅ 覆盖 |
| 主动/proactive | `session/proactive.ts` + `tool/brief.ts` | ✅ 覆盖 |
| LSP | `tool/lsp.ts` + `src/lsp/` | ✅ 覆盖 |
| 语音 | `src/gyccode/audio`（audio-capture 绑定） | ✅ 覆盖 |
| token 预算 | `session/token-budget.ts`（自然语言解析）+ `core/util/token.ts`（chars/4 + JSON ×2） | ⚠️ 估算无垫高（P2） |

---

## 十、追赶计划

### P0（最高优先级，1 项）

**P0-1 记忆相关性检索（memdir 等价）**
- 目标：长记忆文件不再全量注入/完全不可达，按相关性取 ~4KB 注入系统提示
- 实现：`memory/hermes-bridge.ts` 增加 `searchMemories(query, limit)`（标签/关键词粗筛 + 按访问时间排序）+ `session/system.ts` 或 instruction 注入点接入预算截断；`extract.ts` 为记忆条目补 tags/updatedAt 字段（当前格式无元数据）
- 锚点：`memory/hermes-bridge.ts`、`memory/extract.ts`、`session/system.ts`
- 工作量：0.5–1 天；收益：记忆可用性从"全或无"变"按需"，省 token 且提升长会话一致性

### P1（4 项）

**P1-1 git 状态详情注入**
- 目标：系统提示含 branch/dirty 文件数/未跟踪数/最近提交摘要（省 token 版：只输出精简 15–20 行 + 截断提示）
- 实现：`session/system.ts` environment 段增加 `git status --porcelain` 统计聚合；缓存 5 秒避免每轮重跑
- 锚点：`session/system.ts:environment`；工作量：0.5 天

**P1-2 WebSearch 解绑 provider 门控**
- 目标：非 gyccode provider（openrouter/anthropic 等）也能用 websearch（有 key 时）
- 实现：`tool/registry.ts` `webSearchEnabled()` 改为"provider 配置声明 + 能力探测"，默认放开 openai-compatible 系
- 锚点：`tool/registry.ts:webSearchEnabled`；工作量：0.5 天

**P1-3 microcompact 接线**
- 目标：本地零 API 成本清理旧工具结果（token 使用率 ≥85% 且会话空闲时）
- 实现：`session/compaction.ts` 的 `microcompact()` 已有（0.85 阈值/缓存前缀保留/熔断），在 `session/prompt.ts` 循环 step 开始处按 `overflow.usable()` 触发；注意缓存前缀 10 条保留
- 锚点：`session/compaction.ts:microcompact`、`session/overflow.ts:usable`；工作量：0.5 天

**P1-4 token 估算垫高**
- 目标：估算接近实际，压缩/溢出触发更准
- 实现：`core/util/token.ts` 增加 ×4/3 保守系数（Claude 同款）；验证后接入 compaction 触发阈值
- 锚点：`core/util/token.ts`；工作量：0.5 天

### P2（4 项，低资源约束下按性价比排序）

**P2-1 记忆时间衰减**：`memory/` 增加 lastAccess 排序，注入时近期优先；工作量 0.5 天
**P2-2 成本预算告警**：`cli/cmd/stats.ts` + 会话运行中，读配置预算阈值 → TUI 提示 + 日志；工作量 0.5 天
**P2-3 TaskList 工具**：`tool/task.ts` 增加 list/status 子工具（swarm 已具备队友列表，可复用）；工作量 0.5 天
**P2-4 pasteStore**：输入框粘贴内容哈希去重（低价值，可缓）；工作量 0.5 天

### 执行顺序与验证

1. 按 P0-1 → P1-1→P1-4 → P2 顺序推进，每项改动保持"低内存/低 CPU/低 IO"（MacBook Air 2015 4GB 硬约束）
2. 每项完成后：`bun run build`（约 16–22s）→ 冒烟 `node bin/gyc --version` / `providers list` / `models` → 端到端 `gyc run --model <provider>/<model>` 输出 OK
3. P0-1/P1-3 完成后跑一次长会话验证 token 下降与 cache 命中（对比 `gyc stats` 前后数据）

---

*本报告与 `docs/CC-BENCHMARK-2026-08-08.md` 互补：前者是五维对标 + 22 项措施，本报告聚焦 A–G 能力清单逐项覆盖核查并已剔除"报告落盘后已完成"的项（Read 去重、聚合预算、落盘预览、提示词瘦身均已接线）。*