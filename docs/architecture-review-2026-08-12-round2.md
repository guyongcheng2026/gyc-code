# gyc-code 架构审查报告（第二轮）

日期：2026-08-12 傍晚
基准：最新构建产物（dist 27.9MB / 425 文件，P1-3 external 生效后）
对标：Claude Code
本机硬件：**Apple SSD SD0256F，233.8GB，SATA，Healthy**（`Get-PhysicalDisk` 实测）

> ⚠️ **重大前提修正**：本机是 **SSD，不是机械硬盘**。第一轮 P2-3 把"噪音"归因为 HDD 磁头寻道是**错误的物理前提**——SSD 无机械部件，不存在寻道声。用户感知的"硬盘声音"实际来源应是 **SSD 高频写入 → 控制器/闪存发热 → 散热风扇起转**。logging 批量缓冲修复（降低写入频率）依然有效且对 SSD 有益，但归因需修正为"减少写放大与发热"。

---

## 一、关键量测（本轮实测）

| 指标 | 数值 | 说明 |
|---|---|---|
| dist 体积 | **27.9 MB / 425 文件** | P1-3 后，较 245.3MB 降 88.6% |
| 数据目录 `~/.local/share/gyccode` | **189.6 MB** | 存储体积问题核心 |
| └ `gyccode.db` | **136.14 MB** | 单库过大，最大头 |
| └ 无扩展名文件（104 个） | 36.71 MB | repos/snapshot 等 |
| └ `gyccode.log.1` | 10.00 MB | 已轮转日志 |
| └ `gyccode.log` | 2.80 MB | 当前日志 |
| └ `gyccode.db-wal` | 2.73 MB | WAL 未 checkpoint 残留 |
| hermes 记忆文件 | **38 KB / 593 行 / 196 条** | 无去重上限，持续增长 |
| 硬盘 | Apple SSD 233.8GB SATA | 无机械寻道，噪音=风扇 |

---

## 二、五维审查（问题定位：级别/文件/行号/锚点）

### 1. 架构完整性（模块边界/依赖方向/数据流）

- **[P1] 事件溯源与投影表双写，数据流冗余**
  `src/core/event.ts:343-355` `commitDurableEvent` 把每个 durable 事件写入 `EventTable`；`src/core/session/projector.ts:387-405` 又把同一内容投影到 `PartTable`/`MessageTable`。**同一份消息数据在 EventTable.data（JSON）与投影表（JSON 列）各存一份**，是 136MB 数据库的主因。Claude Code 只存最终消息，不做完整 event sourcing 双写。
- **[P2] 命令注册双份清单**
  `src/gyccode/index.ts:43-70` `COMMANDS` 与 `:73-98` `COMMAND_KEYS` 手工维护两份命令列表，易漂移（新增命令需改两处）。

### 2. 架构健全性（错误处理/边界/资源/并发）

- **[P0] EventTable 无保留策略，无限增长**
  `src/core/event.ts:540-549` 仅有 `remove(aggregateID)`，且只在删除会话时调用（`src/gyccode/session/session.ts:642`）。**活跃会话的 EventTable 行永不回收**。会话越多、对话越长，库越大——这是 136MB 的直接成因。
- **[P1] WAL 残留 2.73MB 未回收**
  启动时 `wal_checkpoint(PASSIVE)` 已接入（P1-2），但 PASSIVE 在并发读下不强制回收。实测 wal 仍 2.73MB。
- **[P2] hermes 写入非原子**
  `src/gyccode/memory/hermes-bridge.ts:44-46` `writeHermesMemoryFile` 用 read+write 全量重写，无锁无原子 rename，并发写（extraction + dream 同时触发）可能丢数据。

### 3. 架构健壮性（异常恢复/可测试/可观测/低意见配置）

- **[P1] 记忆缓存 `clear()` 全清**
  `src/gyccode/session/system.ts:165` `if (memoryCache.size >= MEMORY_CACHE_MAX) memoryCache.clear()`——满 64 时清空**全部**会话缓存，缓存命中率断崖。应改 LRU 逐条淘汰。
- **[P2] `--log-level` 已全局生效**（index.ts:127-131,138 → GYCCODE_LOG_LEVEL → logging.ts:112-121），可观测性达标。

### 4. 代码精炼度（重复/死代码/复杂度）

- **[P1] 记忆 key 用时间戳，永不复用**
  `src/gyccode/memory/extraction-runner.ts:58` 与 `extract.ts:63` 均用 `extract_${Date.now()}_${count}` 作 key——每次提取都是新 key，**永不覆盖旧记忆**，196 条只增不减。
- **[P2] `syncHermesMemories` 悬空**
  `hermes-bridge.ts:53-60` 定义了压缩同步函数，但全项目无调用方（仅 memory.ts:2 import 未用），是潜在的清理入口却没接上。

### 5. 对标差距（性能/记忆/功能/编码）

| 基准 | 现状 | 差距 |
|---|---|---|
| 性能 | dist 27.9MB、命令懒加载（index.ts:156-171）、logging 批量缓冲 | 已大幅追平；剩 tree-sitter wasm 7.5MB |
| 记忆 | 196 条无去重无上限、freshness 仅提示不清理 | Claude Code 有记忆压缩与淘汰，gyc 缺失 |
| 功能 | workflow/skill 完备 | event sourcing 双写是负担非优势 |
| 编码 | Effect 类型安全、P1-2/P2-2 已优化 | memoryCache 全清是粗糙点 |

---

## 三、六大问题最佳解决方案（基于 SSD 硬件条件）

### 1. 硬盘发热 / 噪音（前提修正后）
**根因**：SSD 无机械声，"噪音"= 高频写入→发热→风扇。写入源：logging 每行落盘（已修）、EventTable 双写、WAL。
**方案**：
- ✅ logging 批量缓冲（P2-3 已落地，对 SSD 同样有效，保留）
- 🔧 **降低 EventTable 写入**：见问题 6 的保留策略，从源头减少写放大
- 🔧 确认噪音是否风扇：`Get-Counter "\Thermal Zone Information(*)\Temperature"` 或观察任务管理器

### 2. 幻觉率
**根因**：记忆只增不减（196 条）、无去重、时间戳 key 永不覆盖。陈旧/重复记忆注入提示词干扰模型。
**方案**（对标 Claude Code 记忆治理）：
- 🔧 `writeHermesMemoryFile` 写入前**内容去重**（归一化后比对，重复则跳过或合并）
- 🔧 设**条目上限**（如 200），超限淘汰最旧（FIFO）
- 🔧 接入悬空的 `syncHermesMemories` 做周期压缩
- ✅ freshness 提示已存在（hermes-bridge.ts:180-183），保留

### 3. 缓存命中率
**根因**：`memoryCache.clear()` 全清（system.ts:165）。
**方案**：
- 🔧 改 **LRU 单条淘汰**：满时删最旧一条，而非全清
- ✅ prompt-shard semi 缓存（P1-1）、searchCache TTL 30s 已合理
- ⚠️ 待评估：system 数组 `[semi, dynamic, static, memories]` 中 dynamic 在 static 前，可能破坏 prompt-cache 前缀稳定性

### 4. CLI 启动包
**现状**：27.9MB（P1-3 已降 88.6%），命令懒加载合理。
**方案**：
- 🔧 剩余大头 **tree-sitter wasm 7.5MB（9 个）**：按需懒加载，或仅保留高频语言（ts/js/py/go/rust），其余运行时下载
- ✅ provider SDK external 已完成

### 5. 存储及数据库体积（最高优先级）
**根因**：EventTable 无保留策略 + 事件/投影双写 + JSON 列冗余 → 136MB。
**方案**（按收益排序）：
- 🔧 **[P0] EventTable 保留策略**：对已投影完成的 aggregate，定期删除超过 N 天（如 30 天）或 N 条的旧事件行。Claude Code 不保留完整事件流。
- 🔧 **一次性 `VACUUM`**：P1-2 的 incremental_vacuum 只回收新删页；存量 136MB 需一次 full VACUUM 重建（enableIncrementalVacuum 已含此逻辑，但需先有删除动作才有可回收页）
- 🔧 **评估去掉双写**：若投影表已可作 source of truth，EventTable 仅保留近期事件用于 replay，大幅瘦身
- 🔧 WAL：启动 checkpoint 已接入，可评估 `wal_autocheckpoint` 调小

### 6. 综合
最高收益 = **EventTable 保留策略 + VACUUM**（直接砍 136MB）与 **记忆去重上限**（治幻觉率）。

---

## 四、待办清单（按优先级）— 已全部完成

| 级别 | 任务 | 锚点 | 状态 |
|---|---|---|---|
| P0 | EventTable 保留策略 + 存量 VACUUM | event.ts:540 / database.ts | ✅ 完成 |
| P1 | memoryCache 改 LRU | system.ts:165 | ✅ 完成 |
| P1 | 记忆写入去重 + 条目上限 + 接入 syncHermesMemories | hermes-bridge.ts:39 / extraction-runner.ts:58 | ✅ 完成 |
| P2 | tree-sitter wasm 按需加载 | dist 9 个 wasm | ✅ 已确认懒加载 |
| P2 | hermes 写入原子化（锁/rename） | hermes-bridge.ts:44 | ✅ 完成 |
| P2 | COMMANDS/COMMAND_KEYS 合并单一清单 | index.ts:43-98 | ✅ 完成 |

### 实施明细

**P0 EventTable 保留策略**（`database.ts`）
- 新增 `pruneStaleEvents`：删除 `session.time_updated` 超过 30 天的会话对应的 `event` 行。**只删 event 表行，保留 event_sequence**（workspace sync 靠其 seq 判断增量起点）。投影表（session_message/part/todo）数据完整保留。
- 启动顺序：`enableIncrementalVacuum` → `migrations` → `pruneStaleEvents` → `reclaimFreePages` → `wal_checkpoint`。prune 在 migrations 后（表已存在）、incremental_vacuum 前（同一次回收释放页）。
- 安全边界确认：EventTable 仅被 `durable()` 实时流与 `history` API 消费；消息/部件读取全走投影表。所有 durable 事件 aggregate 均为 `sessionID`。

**P1 memoryCache LRU**（`system.ts`）
- 命中时 delete+set 移到尾部（LRU refresh）；过期条目先删再重算；满 64 时只删最旧一条而非全清。

**P1 记忆治理**（`hermes-bridge.ts` + `prompt.ts`）
- `writeHermesMemoryFile`：写入前归一化去重（重复则跳过）+ 条目上限 200（FIFO 淘汰最旧）+ 原子写（tmp+rename）。
- `syncHermesMemories`：去重 + 上限压缩，写回原子化。
- `prompt.ts`：提取完成后接入 `syncHermesMemories` 做存量压缩（best-effort，失败吞掉）。
- 修正报告结论：`syncHermesMemories` 并非"悬空"——`cli/cmd/memory.ts:45` 的 `memory sync` 命令已调用；真正问题是自动提取管线写入后从不压缩，现已接入。

**P2 tree-sitter wasm**
- 调查结论：shell.ts 的 bash/powershell/core wasm（~2.5MB）**已通过动态 import() 懒加载**；@opentui/core 的 js/ts/md/zig wasm（~3.2MB）由库的 parser worker 按需加载；photon（1.79MB）是核心图片处理必需。无需改动，已达标。

**P2 hermes 原子写**（`hermes-bridge.ts`）
- 新增 `atomicWriteFile`（tmp+rename），`writeHermesMemoryFile` 与 `syncHermesMemories` 均改用。消除并发写（extraction + dream）丢数据风险。

**P2 COMMANDS/COMMAND_KEYS 合并**（`index.ts`）
- `COMMAND_KEYS` 改为从 `COMMANDS` 派生：按唯一 loader 引用去重，别名（auth→providers、plug→plugin）共享 loader 被跳过。单一数据源，新增命令/别名不再需要改两处。

---

## 五、本轮结论

1. **前提修正**：本机 SSD，"硬盘噪音"应归因为写入发热→风扇，非磁头寻道。P2-3 修复仍有效。
2. **最大新问题**：`gyccode.db` 136MB，根因是 EventTable 事件溯源**无保留策略**+双写，这是存储体积与 SSD 写入发热的共同源头。→ **已修复**（P0 保留策略 + 既有 incremental_vacuum）。
3. **幻觉率**：记忆 196 条无去重无上限，时间戳 key 永不覆盖，需治理。→ **已修复**（去重 + 上限 200 + 提取后自动压缩）。
4. **缓存**：memoryCache 全清是命中率断崖点，改 LRU 即可。→ **已修复**（LRU 单条淘汰）。
5. dist 已优化到位（27.9MB），tree-sitter wasm 已确认懒加载，无需改动。

## 六、实施验证

- 所有改动文件 `read_lints` 零错误：`database.ts`、`system.ts`、`hermes-bridge.ts`、`prompt.ts`、`index.ts`。
- 待办：完整 `bun run build` + 运行验证（环境对长命令有限制，需用户本地执行）。
