# gyc-cli 对标 Claude Code 三指标差距评估与改进设计

- 日期：2026-08-10
- 状态：设计稿
- 对标对象：`E:\AI项目备份\Claude Code 源码资料\extracted-source\extracted-source\src`（Claude Code 2.1.88）
- 改进对象：`C:\Users\谷勇成\gyc-cli`（gyc-code，1291 个 TS/TSX，约 19.5 万行）
- 目标：在三指标（任务成功率 / 幻觉率 / 每任务真实成本）上 100% 达到 Claude Code 对应能力并超越

## [S1] 评估方法

- 纯源码机制差距评估（用户确认），不做运行 benchmark 实测。
- 每个结论带文件路径 + 行号锚点（锚点代码），不臆造；未覆盖处明确标注"未检"。
- 差距分级：P0（直接影响三指标、缺失或严重不足）/ P1（重要但非阻断）/ P2（建议）。
- 交付物：本设计文档（评估报告）+ 分阶段（P0→P1→P2）代码改进，每阶段独立验证（`bun test` + `bun tsc --noEmit`）。

## [S2] 三指标差距评估总表

### S2.1 任务成功率（Task Success Rate）

| 编号 | 机制 | Claude Code 实现 | gyc-cli 现状 | 差距 | 锚点 |
|---|---|---|---|---|---|
| S1 | 持续循环判定 | `needsFollowUp`：有 tool_use 就继续直到纯文本收尾或硬限制（query.ts:557,1062） | `finish !== "tool-calls"` 即退出（prompt.ts:1191-1205）；模型提前 `stop` 不自动继续 | P0 | gyc: prompt.ts:1191 |
| S2 | 输出截断恢复 | escalate 64k + "Resume directly" 注入续跑×3（query.ts:1188-1250） | 有 resumes<8 续写（prompt.ts:1167），无 64k escalate | P1 | gyc: prompt.ts:1167 |
| S3 | reactive compact | 413 先 collapse drain→reactive compact→放弃（query.ts:1065-1183） | 已有基础版：ContextOverflowError→needsCompaction→compaction.create（processor.ts:624-636）；无 collapse drain 降级链 | P1 | gyc: processor.ts:624 |
| S4 | 跨会话记忆自动提取 | extractMemories：每 loop 结束 fork agent 提取（extractMemories.ts） | extract.ts/dream.ts/team.ts 全部死代码，仅手动 CLI 写 | **P0** | gyc: memory/extract.ts（无调用） |
| S5 | 会话内记忆（SessionMemory） | 后台 fork agent 维护 session-memory/*.md，compact 时注入（sessionMemory.ts） | 无 | P1 | — |
| S6 | 任务管理工具 | TaskCreate/List/Get/Stop/Output/Update 全套 | 仅 task/swarm，无 list/get/stop 独立工具 | P1 | gyc: tool/task.ts |
| S7 | 计划文件持久化/恢复 | plan 文件 + copyPlanForResume + compact 后重建（plans.ts） | plan 文件存在，resume 重建未知 | P2 | gyc: session.ts:333 |

### S2.2 幻觉率（Hallucination Rate）

| 编号 | 机制 | Claude Code 实现 | gyc-cli 现状 | 差距 | 锚点 |
|---|---|---|---|---|---|
| H1 | 写入前强制 Read | FileWrite 强制先读 + mtime 防陈旧写（FileWriteTool.ts:198-219） | edit.txt 仅提示，代码层无强制；edit 有 mtime TOCTOU 防护（edit.ts:160-168）；read-cache 是内存缓存无"已读状态"跟踪 | **P0** | gyc: tool/write.ts, edit.ts |
| H2 | file_unchanged 桩 | Read 返回 "File unchanged since last read"（FileReadTool.ts:540-573） | 已有 `<file unchanged>`（read-cache.ts:3） | ✅ 已有 | gyc: read-cache.ts:3 |
| H3 | 记忆 freshness 标注 | 读记忆注入 "memory is N days old, verify"（memoryAge.ts:33-53） | 无 | P1 | — |
| H4 | WebSearch 强制引用 | 结果附 "You MUST include the sources"（WebSearchTool.ts:426-428） | 无 | P1 | gyc: tool/websearch.ts |
| H5 | TodoWrite 验证提醒 | 关闭3+任务且无验证步骤→提醒验证（TodoWriteTool.ts:76-113） | 无 | P2 | gyc: tool/todo.ts |
| H6 | 大结果 LLM 摘要 | WebFetch 用 Haiku 按 prompt 总结（WebFetchTool/utils.ts:484-529） | 仅截断落盘，无 LLM 摘要 | P1 | gyc: tool/truncate.ts |
| H7 | 工具结果聚合预算+cache 冻结 | MAX 200k + 替换决策冻结保 cache（toolResultStorage.ts:769-909） | 有 MAX_AGGREGATED_TOOL_CHARS=100k（message-v2.ts:55），无 cache 决策冻结 | P1 | gyc: message-v2.ts:55 |
| H8 | Grep/Glob 截断告知 | 显式截断标记 + appliedLimit 回传（GrepTool.ts:266-277） | 已有 "Results truncated..."（grep.ts） | ✅ 已有 | gyc: grep.ts |

### S2.3 每任务真实成本（True Cost Per Task）

| 编号 | 机制 | Claude Code 实现 | gyc-cli 现状 | 差距 | 锚点 |
|---|---|---|---|---|---|
| C1 | prompt cache 字节级稳定 | partitionByPriorDecision 冻结替换决策 + 排序稳定（toolResultStorage.ts:649-667） | 无决策冻结；聚合预算每次重算（message-v2.ts:60-88） | **P0** | gyc: message-v2.ts:60 |
| C2 | token budget 续跑 | `+500k`/`use 2M tokens` + checkTokenBudget 续跑（query/tokenBudget.ts:45-93） | token-budget.ts 死代码，未接线 | **P0** | gyc: session/token-budget.ts |
| C3 | session memory compact 优先 | 先试 session memory 再 fork agent（autoCompact.ts:288-310） | 直接用 compaction agent 摘要 | P1 | gyc: compaction.ts |
| C4 | microcompact 时间触发 | 60min gap 清工具结果保 cache（microCompact.ts:422-444） | 有 0.85 阈值 microcompact（compaction.ts:26），无时间触发 | P2 | gyc: compaction.ts:26 |
| C5 | 便宜模型摘要工具 | Haiku 做工具/WebFetch 摘要 | 无 | P1 | — |

## [S3] P0 阶段改进设计（第一批）

P0 为对三指标影响最大、缺失最严重的 4 项：S4（记忆自动提取）、H1（read-before-write 强制）、C1（prompt cache 稳定）、C2（token budget 续跑）。

### P0-1：记忆自动提取接线（S4）→ 任务成功率 + 幻觉率 + 成本

**现状**：`src/gyccode/memory/extract.ts` 已实现 `shouldExtract`/`formatExtractionPrompt`/`persistExtractedMemories` 等完整函数，但无任何调用点（死代码）。`dream.ts`/`team.ts` 同样未接线。hermes-bridge 只有读侧检索注入（system.ts:144-152），无自动写侧。

**设计**：
1. 新增 `src/gyccode/memory/extraction-runner.ts`：封装一轮记忆提取 Effect——从当前 session 最近 N 轮消息生成提取 prompt，调用便宜模型（默认 `deepseek/deepseek-chat`，可配置），解析结果，`persistExtractedMemories` 写入。
2. 接线到主循环：在 `src/gyccode/session/prompt.ts` 的 `runLoop` 中，每轮 step 递增后检查 `shouldExtract(step)`（默认每 3 轮），触发后台异步提取（`Effect.forkIn(scope)` + `Effect.ignore`，与 goal.evaluate 同模式，失败不阻塞主循环）。
3. 去重：`deduplicateMemories` 已有，提取前读取现有记忆去重。
4. 权限与安全：提取只读最近消息文本，不调用工具；写入仅限 memory 文件。
5. 配置：新增 `core/v1/config/config.ts` 字段 `memory.extraction`（enabled/minTurns/model/maxMemories，默认 enabled:true 保守开启，因为这是对标核心能力；提供开关关闭）。

**验证**：单元测试 `extraction-runner.test.ts`（mock 模型输出 → 断言写入 hermes 文件、去重生效）；`bun test`。

### P0-2：read-before-write 强制（H1）→ 幻觉率

**现状**：write/edit 无代码级"先读后写"强制；read-cache 仅存内容，未跟踪"本会话是否 Read 过"。

**设计**：
1. 扩展 `src/gyccode/tool/read-cache.ts`：新增 `hasRead(filepath)` / `markRead(filepath)` 状态（记录最近 Read 时间戳）。
2. `write.ts`：文件已存在时，若本会话未 Read 过该文件 → 返回错误 `File has not been read in this session. Read it first with the read tool to confirm current content.`（对齐 Claude Code FileWriteTool errorCode 2）。
3. `edit.ts`：同逻辑；`replaceAll` 大范围编辑时强制先读。
4. 保留现有 mtime TOCTOU 防护（edit.ts:160-168），二者叠加。
5. 注意兼容：`apply_patch.ts`、`snapshot`、内部写流程（非模型调用）不走此检查（通过 ctx 标记 bypass，如 `ctx.bypassReadCheck` 或工具内部调用用专用入口）。

**验证**：工具测试（未读先写→报错；读后写→通过；绕过路径不受影响）；`bun test`。

### P0-3：prompt cache 字节级稳定（C1）→ 成本

**现状**：`message-v2.ts:60-88` 的 `aggregateToolCaps` 每轮重算截断预算，截断决策不冻结；只要工具输出不变，重放前缀理论稳定，但无显式冻结保障，且微压缩/替换策略可能随轮次漂移，导致 prompt cache 前缀失效。

**设计**：
1. 引入"截断决策冻结"：在 `aggregateToolCaps` 计算结果后，把每个 callID 的 `keep` 字符数作为决策写入 part 的 metadata（如 `part.state.metadata.truncationDecision = { callID, keep }`），后续轮次若该 part 已存在决策则直接复用，不再重算。
2. 保证确定性排序：对 tool parts 按 `callID` 稳定排序后遍历（当前按 Map 插入序，需显式稳定）。
3. 将冻结决策持久化到 transcript（`part.state.metadata` 随消息落库），`--resume` 后一致（对齐 Claude Code reconstructContentReplacementState）。
4. 降低 `MAX_AGGREGATED_TOOL_CHARS` 下的首轮不确定性：第一轮即记录决策。

**验证**：单元测试（同一消息序列两次序列化 → 字节级一致；决策写入 metadata；resume 后复用）；`bun test`。

### P0-4：token budget 续跑接线（C2）→ 成本 + 任务成功率

**现状**：`token-budget.ts` 的 `parseTokenBudget`/`parseTokenBudgetNL` 死代码；主循环无 token 预算续跑概念，模型 `stop` 即退出。

**设计**：
1. 在主循环 `prompt.ts` 停止判定（`prompt.ts:1191-1205`）之前，解析最后一条用户消息中的 token 预算指令（`+500k`/`use 2M tokens` 等，复用 `parseTokenBudgetNL`）。
2. 若检测到预算且当前轮次累计 token 未达预算 → 不退出，注入 synthetic user 消息 "Stopped at X% of token target... Keep working — do not summarize."（对齐 Claude Code utils/tokenBudget.ts:66-73），继续循环。
3. 预算状态跟踪：`runLoop` 内维护 `budgetRemaining`；续跑达 `COMPLETION_THRESHOLD`（0.9）或收益递减（连续 3 次增量 <500 tokens）时停止（对齐 query/tokenBudget.ts:45-93）。
4. 预算来源：用户消息内指令，或 CLI 参数（`gyc run --budget 500k`）；session 元数据持久化。
5. 与现有 resumes 续写（finish=length）互不冲突，分别在各自触发条件生效。

**验证**：单元测试（`+500k` 解析、续跑判定、收益递减停止）；`bun test`。

## [S4] P1 阶段改进设计（第二批）

1. **S2 输出截断 escalate**：`finish === "length"` 且无工具调用时，第一次尝试将 `maxOutputTokens` 从 32k escalate 到 64k（transform.ts:18 OUTPUT_TOKEN_MAX 之上，对齐 ESCALATED_MAX_TOKENS=64k），失败再走 resumes 注入。
2. **S5 SessionMemory**：会话内后台 fork agent 维护 `session-memory/*.md`（当前状态/错误修正/工作日志分区，2000 token/区、12000 token 总预算），compact 时注入截断后的记忆（对齐 sessionMemory.ts + truncateSessionMemoryForCompact）。
3. **S6 任务管理工具**：新增 `task_list`/`task_get`/`task_stop` 工具（对齐 TaskListTool/TaskGetTool/TaskStopTool），基于现有 BackgroundJob/background 服务暴露查询与停止。
4. **H3 记忆 freshness**：读 hermes 记忆文件时按 mtime 注入 `<system-reminder>This memory is N days old...verify against current code</system-reminder>`（对齐 memoryAge.ts:33-53）。
5. **H4 WebSearch 强制引用**：websearch 结果末尾追加 "REMINDER: You MUST include the sources above in your response..."（对齐 WebSearchTool.ts:426-428）。
6. **H6 大结果 LLM 摘要**：WebFetch 大内容（>100KB）用便宜模型按 prompt 总结（对齐 WebFetchTool/utils.ts:484-529），替代纯截断。
7. **H7/C1 工具结果预算冻结**：P0-3 的扩展，落地 `toolResultStorage` 等价层（若 message-v2 已覆盖则合并）。
8. **C5 便宜模型摘要工具**：新增内部 `summarize` 服务（用 deepseek-chat/haiku 类便宜模型），供 WebFetch/大工具结果使用。

## [S5] P2 阶段改进设计（第三批）

1. **S7 计划文件 resume 重建**：compact 后重建 plan 附件（对齐 compact.ts:545-548）。
2. **C4 microcompact 时间触发**：距上一条 assistant 超 gapThresholdMinutes（默认 60）时清中间工具结果（对齐 microCompact.ts:422-444）。
3. **C3 session memory compact 优先**：compaction 先试 session memory 摘要，失败再 fork agent。
4. **H5 TodoWrite 验证提醒**：关闭 3+ 任务且无验证步骤时提醒验证。
5. **S3 collapse drain 降级链**：413 恢复增加 collapse drain 层级（对齐 contextCollapse.recoverFromOverflow）。

## [S6] 验证策略

- 每阶段完成后：`bun test`（全量）+ `bun tsc --noEmit`（类型检查）+ 针对改动模块的定向测试。
- 三指标间接度量：新增机制均有单元测试覆盖；不做端到端模型评测（用户确认）。
- 回归：改动不触碰工作区已有未提交改动（当前有 19 个文件未提交，属上一会话遗留，评估时不改它们）。

## [S7] 范围与排除

- 不做：模型本身更换、基准测试套件扩展、文档类交付。
- 改动边界：只改本设计列出的模块；每个 P 阶段独立 commit。
- 排除的探索偏差修正：gyc grep 截断已有（H8 已达标）、reactive compact 基础版已有（S3 降为 P1）。

## [S8] 提交与同步

- 遵循 AGENTS.md：每次 commit 后 `.githooks/post-commit` 自动 push origin + 同步 Obsidian 工作流水。
- commit 粒度：每个 P0 子项一个 commit，message 前缀 `feat(benchmark):` 或 `feat(session):`。
