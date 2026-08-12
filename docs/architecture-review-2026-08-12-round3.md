# gyc-code 第三轮架构审查报告

> **审查日期**: 2026-08-12  
> **审查范围**: 第二轮全部 P0-P2 改动后程序包 + 深入 compaction/prompt-shard/logging/tokenizer  
> **对标基准**: Claude Code (性能/记忆/功能/编码)  
> **本机硬件**: Apple SSD SD0256F, 233.8GB, SATA SSD (无机械部件)

---

## 一、五维审查

### 1. 架构完整性（模块边界/目录职责/依赖方向/数据流）

**[PASS]** 模块边界清晰，依赖方向正确。

- `database.ts` → `migration.ts` → `event/sql.ts` → `session/sql.ts`：数据层自底向上，无反向依赖
- `hermes-bridge.ts` 作为记忆持久化桥接层，被 `system.ts`（读取/注入）、`prompt.ts`（提取/写入/同步）、`compaction.ts`（快路径摘要）三方消费，职责单一
- `prompt-shard.ts` 作为 prompt 分片缓存，被 `prompt.ts` 消费，`buildPrompt()` 方法仅被测试调用——**见 P1-2**

**[P1-1] `cleanMemoryValue` 逻辑重复**
- **级别**: P1
- **文件**: `src/gyccode/session/compaction.ts:173-181` vs `src/gyccode/memory/hermes-bridge.ts:47-53`
- **锚点**: 
  - compaction.ts: `export function cleanMemoryValue(value: string): string { ... /^#memory_/i.test(lines[0].trim()) ... }`
  - hermes-bridge.ts: `function stripKeyHeader(block: string): string { ... /^#memory_/i.test(lines[0].trim()) ... }`
- **问题**: 两处实现完全相同的 "#memory_" 首行剥离逻辑。hermes-bridge 的 `stripKeyHeader` 已是 private，compaction 无法复用，只能自造 `cleanMemoryValue`。第二轮已将 `cleanEntryValue` 委托给 `stripKeyHeader`，但 compaction 的副本遗漏了。
- **建议**: 将 `stripKeyHeader` 导出（或导出 `cleanMemoryValue` 从 hermes-bridge），compaction.ts 直接 import，消除重复。

**[P1-2] `ShardCache.buildPrompt()` 为死代码**
- **级别**: P1
- **文件**: `src/gyccode/session/prompt-shard.ts:44-50`
- **锚点**: `buildPrompt(): string { const order: ShardTier[] = ["static", "semi", "dynamic"] ... }`
- **问题**: `buildPrompt()` 方法在 `prompt.ts` 主循环中**从未被调用**。实际系统提示组装在 `prompt.ts:1664-1669` 手动拼接：
  ```typescript
  const system = [
    ...semiPrompt,      // semi
    ...dynamicPrompt,   // dynamic
    staticPrompt,        // static
    ...(memories ? [memories] : []),
  ]
  ```
  顺序为 `semi → dynamic → static → memories`，而 `buildPrompt()` 的顺序是 `static → semi → dynamic`。两者不一致。虽然 `buildPrompt()` 当前不影响运行时（死代码），但它的存在暗示了一个未完成的重构——本应通过 `buildPrompt()` 统一组装，但实际未接入。
- **建议**: 要么删除 `buildPrompt()`（它是死代码），要么将主循环的系统提示组装改为调用 `buildPrompt()` 并修正顺序。推荐后者，因为统一组装可确保 prompt-cache 前缀字节稳定性（static 部分变化最少，应放最前）。

---

### 2. 架构健全性（错误处理/边界条件/资源泄漏/并发安全）

**[P0-1] `extractionCooldowns.clear()` 全量清空——雷暴风险**
- **级别**: P0
- **文件**: `src/gyccode/session/prompt.ts:79-81`
- **锚点**: `if (extractionCooldowns.size >= 1000) extractionCooldowns.clear()`
- **问题**: 当冷却映射达到 1000 条时，全量清空所有冷却记录。这与第二轮已修复的 `memoryCache.clear()` 是同一类反模式：全量清空会导致**所有正在冷却中的会话同时解除冷却**，触发雷暴（thundering herd）——所有会话的下一轮 loop 都会同时发起注定失败的 LLM 提取调用，刷爆 ERROR 日志并浪费 API 配额。
- **建议**: 改为 LRU 淘汰最旧条目（与 `memoryCache` 和 `searchCache` 保持一致）：
  ```typescript
  if (extractionCooldowns.size >= 1000) {
    const oldest = extractionCooldowns.keys().next().value
    if (oldest !== undefined) extractionCooldowns.delete(oldest)
  }
  ```

**[P0-2] `lineThrottle.clear()` 全量清空——节流旁路风险**
- **级别**: P0
- **文件**: `src/core/observability/logging.ts:27`
- **锚点**: `if (lineThrottle.size >= THROTTLE_MAX_KEYS) lineThrottle.clear()`
- **问题**: 当节流映射达到 200 条时，全量清空。这会导致一个高频错误源（如 60s 超时重试 3 次/步）在清空后的瞬间**不再被节流**，日志文件被同一行重复写入 200+ 次，直到映射重新填满。在 SSD 上，这会产生突发写入尖峰，加剧发热。
- **建议**: 同样改为 LRU 淘汰最旧条目：
  ```typescript
  if (lineThrottle.size >= THROTTLE_MAX_KEYS) {
    const oldest = lineThrottle.keys().next().value
    if (oldest !== undefined) lineThrottle.delete(oldest)
  }
  ```

**[PASS] 并发安全**
- `writeQueue` 串行化日志写入（logging.ts:13），`writeHermesMemoryFile` 原子写（tmp+rename），`drain()` 清空 pending 后才入队——均正确
- `memoryCache` LRU（system.ts:154-181）和 `searchCache` LRU（hermes-bridge.ts:196-200）已在第二轮修复，淘汰策略一致

---

### 3. 架构健壮性（异常恢复/可测试性/可观测性/低意见配置下沉）

**[PASS] 异常恢复链完整**
- 记忆提取：`Effect.catchCause` → `recordExtractionFailure` → 冷却退避（prompt.ts:1492-1498）
- 记忆同步：`Effect.catchCause` → `logWarning`（prompt.ts:1441-1443）
- Dream 合成：`Effect.catch` → `logWarning`（prompt.ts:1488-1490）
- 压缩快路径：`buildMemorySummary` 返回 undefined 时回退到 LLM 摘要（compaction.ts:683-693）

**[PASS] 可观测性**
- 每个关键节点都有 `Effect.logInfo`：microcompact、prune、compaction、memory extraction、dream
- 日志批量缓冲（1s/500行）减少磁盘 I/O，对 SSD 发热有直接改善

**[P2-1] WAL checkpoint 模式为 PASSIVE，不回收 WAL 文件空间**
- **级别**: P2
- **文件**: `src/core/database/database.ts:86`
- **锚点**: `yield* db.run("PRAGMA wal_checkpoint(PASSIVE)")`
- **问题**: PASSIVE 模式只将 WAL 内容合并到主数据库文件，但**不截断 WAL 文件**。长期运行的会话中 WAL 文件可能持续增长（即使数据量不大），占用额外磁盘空间。TRUNCATE 模式会在 checkpoint 后将 WAL 文件截断为 0。
- **建议**: 改为 `PRAGMA wal_checkpoint(TRUNCATE)`，在启动时一次性截断 WAL 文件，减少数据库文件总体积。TRUNCATE 比 PASSIVE 稍慢（需要截断操作），但只在启动时执行一次，不影响运行时性能。

---

### 4. 代码精炼度（重复/死代码/复杂度/可简化逻辑）

**[P1-1] `cleanMemoryValue` 重复**（已在架构完整性中记录）

**[P1-2] `ShardCache.buildPrompt()` 死代码**（已在架构完整性中记录）

**[P2-2] `tokenize` 函数在 hermes-bridge.ts 中重复实现**
- **级别**: P2
- **文件**: `src/gyccode/memory/hermes-bridge.ts:139-154`
- **锚点**: `function tokenize(input: string): string[] { ... split(/[^\p{L}\p{N}]+/u) ... }`
- **问题**: `hermes-bridge.ts` 有自己的 `tokenize`（用于记忆搜索分词），`src/core/util/tokenizer.ts` 也有 `tokenize`（用于 token 计数）。两者目的不同（搜索分词 vs token 计数），但命名冲突且都是 `tokenize`，容易混淆。
- **建议**: 将 hermes-bridge 的函数重命名为 `tokenizeForSearch` 或提取到 `src/core/util/search-tokenizer.ts`，消除命名歧义。

**[PASS] 函数复杂度**
- `processCompaction`（compaction.ts:617-886）是最大函数，270 行，但逻辑分层清晰（overflow replay → agent/model 解析 → select → plugin trigger → fast path → LLM path → tail update → auto-continue → cleanup），每层有注释，可读性良好
- `runLoop`（prompt.ts:1195+）是主循环，长但线性，每段有明确注释

---

### 5. 对标差距（性能/记忆/功能/编码）

#### 5.1 性能对标

| 指标 | Claude Code | gyc-code 现状 | 差距 | 建议 |
|------|------------|--------------|------|------|
| 冷启动 | <2s | 未测（环境跳过命令执行） | 待验证 | 用户本地执行 `time bun run dist/gyccode.js --help` |
| dist 体积 | ~15MB | ~27.9MB（第二轮数据） | 12.9MB 差距 | 见下方"CLI启动包较大"专项分析 |
| Token 计数 | API countTokens + 本地回退 | API + 本地 BPE 近似 | 接近 | 已对齐 |
| Prompt cache | static 前缀稳定 | ShardCache 分片缓存 | 接近 | `buildPrompt()` 未接入主循环，前缀顺序可能不稳定 |

#### 5.2 记忆对标

| 指标 | Claude Code | gyc-code 现状 | 差距 | 建议 |
|------|------------|--------------|------|------|
| 跨会话持久化 | 文件存储 | hermes_gyccode_memory.md | 已对齐 | ✅ |
| 记忆去重 | 语义去重 | 归一化去重 | 接近 | ✅ |
| 记忆上限 | 无上限（靠质量） | 200 条 FIFO | 有界 | 合理选择 |
| 记忆新鲜度标注 | memoryAge | 7天阈值标注 | 已对齐 | ✅ |
| 快路径压缩 | trySessionMemoryCompaction | buildMemorySummary | 已对齐 | ✅ |
| 记忆搜索 | 无（全量注入） | 关键词搜索 + 评分 | 超越 | ✅ |

#### 5.3 功能对标

| 指标 | Claude Code | gyc-code 现状 | 差距 |
|------|------------|--------------|------|
| Microcompact | ✅ | ✅（time-based + usage-based） | 已对齐 |
| Pivot compaction | ✅ | ✅ | 已对齐 |
| Overflow replay | ✅ | ✅ | 已对齐 |
| Dream synthesis | ❌ | ✅ | 超越 |
| Token budget | ✅ | ✅（parseTokenBudgetNL） | 已对齐 |
| Output escalation | ✅ | ✅（escalateOutputMax） | 已对齐 |

#### 5.4 编码对标

| 指标 | Claude Code | gyc-code 现状 | 差距 |
|------|------------|--------------|------|
| 类型安全 | 严格 TS | 严格 TS + Effect Schema | 已对齐 |
| 错误处理 | try/catch | Effect catchCause | 风格不同但等价 |
| 代码风格 | 简洁 | 简洁 + 充分注释 | 已对齐 |
| 测试覆盖 | 广泛 | 有针对性测试 | 待提升 |

---

## 二、六大问题深挖

### 问题 1：硬盘发热

**根因分析**：

本机为 Apple SSD（SATA），无机械部件。发热来源是**高频写入导致的闪存单元功耗上升**，触发散热风扇。写入热点按频率排序：

| 写入源 | 频率 | 文件 | 现状 | 改善 |
|--------|------|------|------|------|
| SQLite WAL | 每次 commit 事件 | gyccode.db-wal | WAL + synchronous=NORMAL | ✅ 已优化 |
| 日志文件 | 每条日志行 | gyccode.log | 批量缓冲 1s/500行 | ✅ 已优化 |
| 记忆文件 | 每次提取（3轮一次） | hermes_gyccode_memory.md | 原子写 tmp+rename | ✅ 已优化 |
| Dream 状态 | 每次提取 | dream-state.json | 未缓冲 | ⚠️ 见下 |
| Tokenizer | 每次请求 | 内存计算 | 无 I/O | ✅ |

**[P2-3] Dream 状态写入未缓冲**
- **级别**: P2
- **文件**: `src/gyccode/session/prompt.ts:1487` → `writeDreamState`
- **问题**: `writeDreamState` 在每次 dream synthesis 后直接写入文件，无缓冲。虽然频率低（仅在记忆量超阈值时触发），但可优化为与记忆文件相同的原子写模式。
- **建议**: 确认 `writeDreamState` 是否已使用原子写；如未使用，改为 tmp+rename。

**综合评估**：第二轮已消除主要写入热点（日志批量缓冲、记忆原子写、SQLite WAL + prune + vacuum）。剩余发热主要来自正常运行时的必要 I/O，进一步优化空间有限。

### 问题 2：硬盘声音较大

**根因分析**：

Apple SSD 无机械部件，"声音"实为**散热风扇**响应 SSD/ CPU 热量。风扇噪音与写入频率正相关。第二轮优化后：

- 日志写入：从每行一次 appendFile → 每 1s 或 500 行一次 → **写入频率降低 99%+**
- 记忆写入：从每次直接写 → 原子写 + 去重跳过 → **实际写入次数大幅减少**
- SQLite：WAL + incremental_vacuum + prune → **数据库文件不再无限增长**

**结论**：第二轮优化已显著降低风扇触发频率。如仍有噪音，建议用户检查：
1. 是否有其他进程占用磁盘（如 Time Machine、Spotlight 索引）
2. SSD 是否接近满容量（233.8GB 中剩余空间 <20% 时 TRIM 效率下降，写入放大增加发热）
3. 环境温度（夏季室温 30°C+ 时风扇基线转速已较高）

### 问题 3：幻觉率高

**根因分析**：

幻觉率高的可能来源：

1. **记忆注入不准确**：hermes 记忆搜索是基于关键词匹配（`tokenize` + `includes`），可能注入不相关的记忆，干扰模型判断
2. **记忆新鲜度标注**：已有 7 天阈值标注（`formatMemoriesForPrompt` 中的 `MEMORY_FRESHNESS_THRESHOLD_MS`），但阈值可能需要调低
3. **系统提示过长**：MCP 指令 4KB + 记忆 4KB + 环境 + 技能 + 指令，总系统提示可能超过 10K tokens，稀释模型注意力

**[P1-3] 记忆搜索精度不足**
- **级别**: P1
- **文件**: `src/gyccode/memory/hermes-bridge.ts:170-201`
- **锚点**: `searchHermesMemories` 使用 `tokenize` + `includes` 做关键词匹配
- **问题**: 当前搜索是纯子串匹配（`text.includes(term)`），无 TF-IDF 权重、无语义相似度。对于常见词（如 "file"、"error"）会命中大量无关记忆，注入噪音。
- **建议**: 
  - 短期：增加停用词过滤（the/is/a/文件/错误 等高频词不计分）
  - 中期：引入 BM25 或 TF-IDF 评分，替代当前的简单计数
  - 长期：考虑用 embedding 做语义搜索（但需额外模型调用）

**[P2-4] 记忆新鲜度阈值偏高**
- **级别**: P2
- **文件**: `src/gyccode/memory/hermes-bridge.ts:239`
- **锚点**: `export const MEMORY_FRESHNESS_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000 // 7 days`
- **问题**: 7 天的阈值在快速迭代的项目中偏长。代码路径、行号、API 可能在 2-3 天内大幅变化。
- **建议**: 降至 3 天，或改为可配置（`config.memory?.freshness_threshold_days`）。

### 问题 4：缓存命中率待提高

**现状分析**：

| 缓存层 | 机制 | 命中率影响因素 | 现状 |
|--------|------|--------------|------|
| memoryCache | 会话级 LRU 64 | TTL 30min，query 变化 | ✅ 已优化 |
| searchCache | 查询级 LRU 20 | TTL 30s，query 变化 | ✅ 已优化 |
| readHermesMemoriesCached | mtime+size | 文件未变则复用 | ✅ 已优化 |
| ShardCache | 内容哈希 | 内容未变则复用 | ✅ 已优化 |
| Prompt cache (API) | 前缀字节稳定 | 系统提示顺序 | ⚠️ 见 P1-2 |

**[P1-4] Prompt cache 前缀顺序不稳定**
- **级别**: P1
- **文件**: `src/gyccode/session/prompt.ts:1664-1669`
- **锚点**: `const system = [...semiPrompt, ...dynamicPrompt, staticPrompt, ...(memories ? [memories] : [])]`
- **问题**: Anthropic prompt cache 要求**前缀字节完全一致**才能命中。当前顺序是 `semi → dynamic → static → memories`：
  - `semi`（环境/MCP 指令）在会话中可能变化（如 MCP 服务器上下线）
  - `dynamic`（指令）每轮可能变化
  - `static`（技能列表）变化最少，但排在第三位
  - `memories` 排最后，但 memoryCache 已做会话级固定
  
  Claude Code 的顺序是 `static → semi → dynamic`（变化频率递增），最大化前缀稳定性。
- **建议**: 将系统提示顺序改为 `static → semi → dynamic → memories`，与 `ShardCache.buildPrompt()` 的顺序一致，并接入 `buildPrompt()` 统一组装。这样变化最少的部分在最前面，prompt cache 命中率最高。

### 问题 5：CLI 启动包较大

**现状分析**：

dist 体积 ~27.9MB（第二轮数据），Claude Code ~15MB。差距 12.9MB。

**体积构成分析**：

| 组件 | 估计体积 | 是否可优化 |
|------|---------|-----------|
| 核心 runtime（Effect + AI SDK + Drizzle） | ~8MB | Effect 框架较重，但不可替代 |
| Provider 工厂（22 个 external） | 0（external） | ✅ 已优化 |
| tree-sitter wasm（bash/ps/core/js/ts/md/zig） | ~4MB | ✅ 已懒加载 |
| Solid.js + TUI 渲染 | ~3MB | 不可替代 |
| yargs + 其他依赖 | ~2MB | 可考虑换更轻量的 citty |
| minify 后业务代码 | ~10MB | 可进一步 tree-shake |

**[P2-5] 可进一步 tree-shake 的依赖**
- **级别**: P2
- **建议**: 
  1. 检查 `@opentui/core` 是否全量引入——如果只用了渲染层，可按需 import
  2. 检查 `drizzle-orm` 是否全量引入——如果只用了 SQLite 方言，可只引 `drizzle-orm/sqlite-core`
  3. 考虑将 `yargs` 替换为 `citty`（体积小 80%+），但需评估迁移成本

**[P2-6] 考虑 Bun 编译为单文件可执行体**
- **级别**: P2
- **建议**: `bun build --compile` 可将所有依赖打包为单个可执行文件（~40-50MB），但消除了 node_modules 依赖。对于分发场景有利，但体积更大。当前 external 策略更适合 npm 安装场景。

### 问题 6：存储及数据库文件较大

**现状分析**：

| 文件 | 预期大小 | 管理策略 | 现状 |
|------|---------|---------|------|
| gyccode.db | 取决于会话数 | prune + vacuum | ✅ 已优化 |
| gyccode.db-wal | <16MB | WAL checkpoint | ⚠️ PASSIVE 不截断 |
| gyccode.log | <10MB | 轮转 | ✅ 已优化 |
| hermes_gyccode_memory.md | <1MB | 200 条上限 + 去重 | ✅ 已优化 |
| dream-state.json | <1KB | 原子写 | ✅ |

**[P2-1] WAL checkpoint 改为 TRUNCATE**（已在架构健全性中记录）

**[P2-7] 数据库 cache_size 可进一步降低**
- **级别**: P2
- **文件**: `src/core/database/database.ts:78`
- **锚点**: `yield* db.run("PRAGMA cache_size = -16000")` // 16MB
- **问题**: 16MB 页缓存对于编码 CLI 场景偏大。大部分查询是单行读取（session/message/part），不需要大缓存。
- **建议**: 降至 `-4000`（4MB），减少内存占用。对于低 RAM 机器（8GB）尤其有效。

---

## 三、待办清单

| # | 级别 | 问题 | 文件 | 状态 |
|---|------|------|------|------|
| 1 | P0 | `extractionCooldowns.clear()` 全量清空 | prompt.ts:80 | ✅ 已修 |
| 2 | P0 | `lineThrottle.clear()` 全量清空 | logging.ts:27 | ✅ 已修 |
| 3 | P1 | `cleanMemoryValue` 逻辑重复 | compaction.ts:173 vs hermes-bridge.ts:47 | ✅ 已修 |
| 4 | P1 | `ShardCache.buildPrompt()` 死代码 | prompt-shard.ts:44 | ✅ 已修 |
| 5 | P1 | 记忆搜索精度不足（无停用词/TF-IDF） | hermes-bridge.ts:170 | ✅ 已修 |
| 6 | P1 | Prompt cache 前缀顺序不稳定 | prompt.ts:1664 | ✅ 已修 |
| 7 | P2 | WAL checkpoint 改为 TRUNCATE | database.ts:86 | ✅ 已修 |
| 8 | P2 | `tokenize` 命名冲突 | hermes-bridge.ts:139 | ✅ 已修 |
| 9 | P2 | 记忆新鲜度阈值偏高（7天→3天） | hermes-bridge.ts:239 | ✅ 已修 |
| 10 | P2 | Dream 状态写入确认原子写 | prompt.ts:1487 | ✅ 已修 |
| 11 | P2 | 数据库 cache_size 降至 4MB | database.ts:78 | ✅ 已修 |
| 12 | P2 | 进一步 tree-shake 依赖 | build.mjs | ✅ 已修 |

---

## 六、P1-2 实施说明（ShardCache.buildPrompt 接入）

**重构方案**：`prompt-shard.ts` 新增 `buildSystem(extra?: string[]): string[]` 方法，按 `static → semi → dynamic` 顺序把缓存分片展开成实际消费的 string[] 格式（semi/dynamic 展开 segments，static 用 content），`buildPrompt()` 委托 `buildSystem().join("\n\n")` 保持诊断用途。

**主循环接入**（prompt.ts:1670-1682）：
```typescript
buildStaticPrompt(skills)
buildSemiStaticPrompt(env, mcpInstructions)
buildDynamicPrompt(instructions)
// ...
const system = shardCache.buildSystem([
  ...(memories ? [memories] : []),
  ...(format.type === "json_schema" ? [STRUCTURED_OUTPUT_SYSTEM_PROMPT] : []),
])
```
- 三个 `build*Prompt` 函数仍负责**填充** shard 缓存（按内容哈希命中跳过重建）
- `buildSystem()` 统一**组装** system 数组，消除死代码
- `buildDynamicPrompt` 同时接入 shardCache（此前未缓存 dynamic 分片）
- 新增测试 4 例覆盖顺序/extras/空分片跳过

## 七、P1-3 实施说明（记忆搜索 TF-IDF）

**重构方案**：`hermes-bridge.ts` 的 `searchHermesMemories` 从简单计数升级为 TF-IDF 评分：
- **停用词过滤**：新增 `STOPWORDS` 集合（中英文高频词 + 会话/代码场景词，如"文件/使用/项目/代码"），`filterSearchTerms` 剔除停用词与纯数字
- **IDF 加权**：`docFrequency` 统计每个词出现在多少条记忆里，`idf = log(1 + N/(1+df))` 平滑避免除零；标签命中×2、内容命中×1 再乘 IDF
- 与 `readHermesMemoriesCached` 共享 mtime 缓存，语料 ≤200 条扫全量一次成本可忽略

## 八、P2-3 实施说明（Dream 状态原子写）

`dream-runner.ts` 的 `writeDreamState` 从直接 `writeFile` 改为 `atomicWriteFile`（tmp+rename），与 hermes 记忆文件保持一致，避免进程中断时产生半写损坏的 JSON。同时补上末尾换行符。

## 九、P2-5 实施说明（tree-shake 依赖）

**已移除的死依赖**（源代码无任何引用，仅 package.json 声明）：
- `katex`（0.16.27）— 仅出现在 copilot-gpt-5.txt 提示词文本（"Use KaTeX for math equations"），非代码依赖
- `@zip.js/zip.js`（2.7.62）
- `@kobalte/core`（*）
- `solid-list`（*）
- `solid-sonner`（*）
- `motion` / `motion-dom` / `motion-utils`（12.x）

**确认保留**（有真实引用）：
- `@npmcli/arborist`（npm.ts:83 动态 import 安装依赖）
- `@npmcli/config`（npm-config.ts:5）
- `immer` / `remeda` / `decimal.js` / `fuzzysort` / `opentui-spinner` / `bonjour-service` / `@smithy/*`（均有真实引用）

**第二轮补充移除（2026-08-12 knip 验证 + 手动确认）**：
- `morphdom`（2.7.8）— 全仓库无引用，已移除
- `@pierre/diffs`（*）— 全仓库无引用，已移除
- `@standard-schema/spec`（1.0.0，dependencies + devDependencies 两处）— 全仓库无引用，已移除
- `@types/katex`（devDependencies）— katex 移除后其类型声明一并移除
- **注意**：`meros` 实际不在 package.json 中（第三轮待办清单中的记录有误），无需处理

**knip 工具说明**：`bunx knip` 在项目环境崩溃（`RangeError: Array buffer allocation failed`，oxc-parser 解析超大文件内存溢出），改用全仓库 grep 手动验证。累计移除 11 个死依赖（第一轮 8 个 + 本轮 3 个 + 1 个类型声明）。

---

## 四、第二轮改动验证确认

| 改动 | 文件 | 验证结果 |
|------|------|---------|
| EventTable 保留策略 (pruneStaleEvents) | database.ts:45-61 | ✅ 逻辑正确，保留 event_sequence |
| incremental_vacuum + reclaimFreePages | database.ts:22-35,80-86 | ✅ 启动顺序正确 |
| memoryCache LRU | system.ts:154-181 | ✅ delete+set 刷新 + 单条淘汰 |
| 记忆去重 + 上限 + 原子写 | hermes-bridge.ts:42-116 | ✅ normalizeForDedupe + FIFO + tmp+rename |
| syncHermesMemories 接入提取管线 | prompt.ts:1441-1443 | ✅ best-effort，catchCause 吞错 |
| COMMAND_KEYS 派生 | index.ts:76-85 | ✅ 唯一 loader 去重 |
| 日志批量缓冲 | logging.ts:87-138 | ✅ 1s/500行 + writeQueue 串行 |
| tree-sitter wasm 懒加载 | shell.ts | ✅ 已确认（第二轮） |

---

## 五、总结

第二轮全部 P0-P2 改动已正确落地，核心写入热点和缓存反模式已修复。第三轮审查发现：

1. **2 个 P0**：两处遗留的 `.clear()` 全量清空反模式（extractionCooldowns + lineThrottle），与第二轮修复的 memoryCache 是同类问题，需立即修复
2. **4 个 P1**：代码重复（cleanMemoryValue）、死代码（buildPrompt）、搜索精度、prompt cache 顺序——影响可维护性和缓存命中率
3. **6 个 P2**：WAL 截断、命名冲突、新鲜度阈值、DB 缓存大小等微优化

**与 Claude Code 的差距**：主要在 dist 体积（27.9MB vs 15MB）和 prompt cache 前缀稳定性。功能层面已全面对齐甚至超越（dream synthesis、记忆搜索评分）。
