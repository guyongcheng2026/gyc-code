# 模型能力层五指标差距闭合 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 gyc cli 在「上下文长度、代码理解深度、推理能力、多语言支持、长会话稳定性」5 指标 100% 达到 Claude Code 2.1.88 并超越。

**Architecture:** 全部改动为纯函数 + 配置项 + 轻量接线，遵循现有 output-cap/rules/keybind 模式（config Schema 新字段 → resolve* 纯函数 → 调用处接线 → TDD）。不引入新依赖。

**Tech Stack:** TypeScript / Effect 4 / bun test / bun tsc

**参考报告:** docs/compose/reports/model-capability-five-metrics-full-eval-2026-08-10.md

---

### Task 1: 三级上下文告警状态机（指标1/P1）

**Covers:** 指标 1 — calculateTokenWarningState

**Files:**
- Create: `src/gyccode/session/overflow.ts`（修改，新增函数）
- Test: `src/gyccode/session/overflow.test.ts`

- [ ] **Step 1: 写失败测试**：`calculateTokenWarningState` 输入 used/limit/输出上限，输出 percentLeft + isAboveWarning/isAboveError/isAboveBlocking 三级布尔。仿真 Claude：warning=limit−20K−reserved、error=limit−13K−reserved、blocking=limit−3K−reserved。
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：overflow.ts 增加 `ContextLevel` 类型与 `calculateTokenWarningState(used, limit, opts)` 纯函数，三个 buffer 常量 `WARNING=20000/ERROR=13000/BLOCKING=3000`。
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 2: per-block token 估算（指标1/P1）

**Covers:** 指标 1 — perBlockTokenEstimate

**Files:**
- Modify: `src/core/util/token.ts`
- Test: `src/core/util/token.test.ts`

- [ ] **Step 1: 写失败测试**：对含 text/image/tool_use/thinking 的 blocks JSON，`Token.estimateBlocks()` 分块估算：text→tokenizer、image→2000、tool_use→JSON 长度/3、thinking→text。
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：token.ts 新增 `estimateBlocks(blocks)` 遍历各 block type 累加，然后 JSON.stringify 包裹开销兜底。
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 3: 模型自适应思考默认开启（指标3/P1）

**Covers:** 指标 3 — shouldEnableThinkingByDefault

**Files:**
- Modify: `src/gyccode/provider/transform.ts`（variants 区）
- Test: `src/gyccode/provider/transform.test.ts`

- [ ] **Step 1: 写失败测试**：`shouldEnableThinkingByDefault(model, cfg)` — 模型声明 adaptive/thinking variants 且用户未显式禁用时返回 true
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：新增 `shouldEnableThinkingByDefault` 纯函数（检测 variants 含 adaptive/thinking 档位 + config.thinking.disabled 检查），在 request prep 中调用于未显式指定时默认启用。
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 4: 提示缓存破坏检测（指标5/P1）

**Covers:** 指标 5 — cache read anchor + drift detection

**Files:**
- Modify: `src/gyccode/session/llm.ts`
- Create: `src/gyccode/session/cache-anchor.ts`
- Test: `src/gyccode/session/cache-anchor.test.ts`

- [ ] **Step 1: 写失败测试**：`detectCacheDrift(prevCacheRead, curCacheRead, prevInputTokens)` — cache read 降幅>5% 且降幅>2K tokens → drift 标记
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：llm.ts 事件流中记录每次 usage.cache.read，压缩/提示变更后对比基线触发告警（仅日志/事件，不改行为）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 5: LSP git-ignore 位置过滤（指标2/P2）

**Covers:** 指标 2 — filterGitIgnoredLocations

**Files:**
- Modify: `src/gyccode/tool/lsp.ts`
- Test: `src/gyccode/tool/lsp.test.ts`

- [ ] **Step 1: 写失败测试**：结果含 git-ignore 文件时被过滤（mock check-ignore）
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：lsp.ts 新增 `filterGitIgnoredLocations(locations)` — 批量 git check-ignore（BATCH=50），非 git 仓库跳过
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 6: LSP 结果 100K 截断（指标2/P2）

**Covers:** 指标 2 — maxResultSizeChars

**Files:**
- Modify: `src/gyccode/tool/lsp.ts`

- [ ] **Step 1: 写失败测试**：超 100K 结果截断 + 标记
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：lsp.ts 结果格式化后按 `MAX_RESULT_SIZE_CHARS=100_000` 截断，附截断标记
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交`

### Task 7: 输出上限槽位预留 8K→64K（指标1/P2）

**Files:**
- Modify: `src/gyccode/session/llm/output-cap.ts`
- Test: `src/gyccode/session/llm/output-cap.test.ts`

- [ ] **Step 1: 写失败测试**：默认输出上限收窄到 8K 槽位，escalate 到 64K
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：`resolveOutputTokenMax` 缺省槽位 8K（保留 finish=length escalate 到 64K）；保留 config 覆盖优先
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 8: 思考预算显式配置（指标3/P2）

**Files:**
- Modify: `src/core/v1/config/config.ts`（llm Schema）
- Modify: `src/gyccode/provider/transform.ts`

- [ ] **Step 1: 写失败测试**：`llm.thinking_budget_tokens` 配置注入 adaptive 模型
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：config.ts 加 `thinking_budget_tokens` 字段；transform variants 读取注入
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 9: 压缩后会话缓存清理（指标5/P2）

**Files:**
- Modify: `src/gyccode/session/compaction.ts`

- [ ] **Step 1: 写失败测试**：压缩成功后清会话级缓存
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：processCompaction 成功后重置会话状态缓存（对齐 Claude postCompactCleanup）
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交**

### Task 10: [1m] 升级引导提示（指标1/P2）

**Files:**
- Modify: `src/gyccode/session/overflow.ts` 或 prompt.ts

- [ ] **Step 1: 写失败测试**：上下文超 70% 且模型支持 1M 时返回升级提示文案
- [ ] **Step 2: 跑测试确认失败**
- [ ] **Step 3: 实现**：溢出判定时附加 `[1m]` 升级提示
- [ ] **Step 4: 跑测试确认通过**
- [ ] **Step 5: 提交`
