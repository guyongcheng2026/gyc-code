# 主题 A：速度 —— 现状取证

## 1. 冷启动初始化

现状：入口链路已做 V8 compile cache 与进程复用，但 `--version` 冷启动实测仍在 3.7–5.9s 量级；TUI 侧做了并行化。

- `bin/gyc:12-35` V8 compile cache，注释自述「~15MB bundle 每次启动省 50-100ms」（已确认）
- `bin/gyc:121-140` Node 直跑 dist，缺 heap flag 时 `spawnSync` **再起一个进程**；`bin/gyc:145` 无 dist 回退 Bun `--smol` 跑 TS 源码（已确认）
- `src/gyccode/index.ts:48-57` `loadDotenv` **串行**读 3 个 .env 文件（已确认）
- `src/gyccode/index.ts:141-147` `--version` 早退，注释含实测 **5871/5246/3748ms**（已确认）
- `src/gyccode/command-registry.ts:9-38` 命令按需 `import()`（已确认）
- `src/cli/cmd/tui.ts:164-177` worker 尽早创建与主进程并行，注释自述 worker 模块图 ~2.6s；`tui.ts:181-191` 轮询 RPC ready（20ms 间隔 / 15s deadline）；`tui.ts:206` `configPromise` 提前 fire 不 await，注释自述 config ~1.2s；`tui.ts:246-249` 升级检查 `setTimeout().unref()` 后台化（已确认）

缺口：dotenv 仍串行；非 TUI 路径（`bin/gyc` 双进程）未核实是否每次都触发。

## 2. 首 token 与流式处理

现状：事件侧**每 token 即发、无节流**且 delta **不进 SQLite**；节流只在 TUI 渲染侧做了一次 30ms 合流。

- `src/gyccode/session/processor.ts:322-328`、`:589` 逐块 `updatePartDelta`，无批处理（已确认）
- `src/gyccode/session/session.ts:965-973` `updatePartDelta` 为 `Effect.fnUntraced`，仅 `events.publish`，不落库（已确认）
- `src/core/session/projector.ts` 中 `part.delta|PartDelta` **零命中** → delta 不进 SQLite（已确认）
- `src/gyccode/session/llm.ts:426-431` `fromAsyncIterable` → `mapEffect(toLLMEvents)` 逐 chunk 转换，无合批（已确认）
- `src/tui/context/delta-flush.ts:7` `DELTA_FLUSH_MS = 30`；`delta-flush.ts:21-42` 单 timer 合流（已确认）
- `src/tui/context/sync.tsx:240` `pendingDeltas` Map、`:267` 建控制器、`:242-266` `batch()` 一次提交（已确认）
- `src/tui/fallback/capability.ts:90-94` plain TTY 10fps / 否则 60fps；`src/tui/routes/session/index.tsx:389` 流式 60fps、非流 30fps（已确认）
- 非 TUI 路径 `src/cli/cmd/run/stream-cli.ts:159-269` 直接 `process.stdout.write`，**无节流**（已确认）

缺口：**首 token 时延（TTFT）无任何测量字段或上报点**——`resolveFirstTokenTimeout` 仅用于超时判定（`src/gyccode/session/llm-timeout.ts:51-55`），无人测「首事件实际到达耗时」（未找到）。

## 3. 超时与重试

现状：LLM 重试为硬编码常量；流超时与 MCP 超时可配置。

- `src/llm/route/executor.ts:38-40` `MAX_RETRIES=2`、`BASE_DELAY_MS=500`、`MAX_DELAY_MS=10_000`，模块内 `const`，**无 config 读取路径**（已确认）
- `executor.ts:377-383` 带抖动指数退避 `500 * 2**attempt * (0.8~1.2)`，截断到 10s；服务端 `Retry-After` 取 `min(retryAfter, 10s)`（已确认）
- `executor.ts:390-398` 带 `Retry-After` 时预算压到 `min(retries,1)`（已确认）
- `executor.ts:93` 可重试状态 `429/503/504/529`（已确认）
- `src/gyccode/session/llm-timeout.ts:22-23` 空闲 600s、首事件 180s；`:40-65` 三者均可由 `gyccode.json` 覆盖（已确认）
- `src/gyccode/tool/actor.ts:17` 工具默认超时 **600s**，`actor.ts:412` 应用；`src/gyccode/tool/shell.ts:767` 退出码等待硬编码 5s（已确认）
- `src/gyccode/mcp/index.ts:40` 默认 30s，`:783-793` 配置优先级链完整（已确认）
- MCP 重连退避基数与上限：`src/gyccode/mcp/index.ts:576-584` `scheduleReconnect`/`canRetry`/`plan.exhausted`（**推断**具体基数未逐行核实）

缺口：LLM 重试参数不可配置；工具超时不可配置。

## 4. 并发瓶颈

现状：全局 SQLite 串行信号量 + 投影串行上卷，是最硬的并发天花板。

- `src/core/database/sqlite.node.ts:139-140` `Semaphore.make(1)` + `withPermits(1)` → **所有 SQL 串行**；`:141-148` 事务独占；`sqlite.bun.ts:156-157` 同构（已确认）
- `sqlite.node.ts:183-191` 已做 WAL + `synchronous=NORMAL` + `busy_timeout=5000` + 16MB cache（已确认）
- `src/core/session/projector.ts:178-185` `rollupUsage` 对祖先链 `concurrency: 1` 严格串行；`:195-243` 每层 4 次串行 SQL（已确认）
- `src/gyccode/session/keyed-lock.ts:14` LRU 200、`edit.ts:37-64` per-file 锁、`:107` 包住整个编辑（已确认）
- `src/core/util/flock.ts:25-30` 跨进程锁 `staleMs 60s` / `timeoutMs 5min` / 退避 100ms–2s 带 ±30% 抖动（已确认）
- `src/gyccode/session/llm-timeout.ts:34` 默认最大并发流 **3**；`llm.ts:405-419` permit 持满整个流生命周期，等待 permit 自身 30s 超时，`:410-415` 争用 >200ms 打 logInfo（已确认）
- 无全局工具并发上限：`registry.ts:471`、`read.ts:134`、`swarm.ts:238` 标注 `concurrency: "unbounded"`（已确认）

## 5. 性能埋点

现状：有 TUI/ACP 打点与 OTel span，**但无 TTFT、无 telemetry 上报**。

- `src/tui/util/timing.ts:6-15` `GYCCODE_TUI_TIMING=1` 才写 stderr，16 处调用点（已确认）
- `src/gyccode/acp/profile.ts:3-42` `GYCCODE_ACP_PROFILE=1`（已确认）
- 真实 OTel span：`src/core/database/sqlite.node.ts:155-158` 设 `ATTR_DB_SYSTEM_NAME="sqlite"`；`src/core/util/flock.ts:352-359` `Flock.acquire`/`release` span（已确认）
- 并发争用埋点 `src/gyccode/session/llm.ts:410-415`（已确认）
- `metrics`/`telemetry`/`latency` 无上报出口；**TTFT 未找到**（未找到）

---

# 主题 B：Token 消耗 —— 现状取证

## 1. 上下文裁剪与压缩

现状：有自动 compaction + token 预算双机制，并保留 8k token 尾部。

- `src/core/session/compaction.ts:13` `DEFAULT_KEEP_TOKENS = 8_000`（已确认）
- `compaction.ts:125` 默认档 `{ auto: true, buffer: DEFAULT_BUFFER, tokens: DEFAULT_KEEP_TOKENS }`（已确认）
- `compaction.ts:177` `buildPrompt` 带 `previousSummary` + `context`（已确认）
- `compaction.ts:192`、`:246` summary 输出预算取 `maxTokens ?? route.defaults.limits?.output`（已确认）
- `src/core/session/context-epoch.ts`、`history.ts`、`message-updater.ts` 同属压缩链路（已确认存在）

## 2. prompt / KV cache 复用

现状：多协议各自实现 cache breakpoint，并有独立命中率统计与断点治理。

- 协议侧落地：`src/llm/protocols/anthropic-messages.ts`、`bedrock-converse.ts`、`openai-responses.ts`（已确认）
- 锚点治理：`src/gyccode/session/cache-anchor.ts`、`src/llm/cache-breakpoints.test.ts`（已确认）
- 命中率统计：`src/core/session/cache-rate.ts:87` `promptCacheStats`；`:47` `CACHE_WINDOW_MS = 10min`；`:144-150` 分别累计 `prefixHit` / `steadyHit`（已确认）
- 缺失归因：`cache-rate.ts:59` `classifyMiss`（已确认）

## 3. 工具 schema 体量

- `src/gyccode/tool/registry.ts:85-89` 注册表按 `custom` / `builtin` / `task` / `read` / `swarm` 分组（已确认）
- `src/gyccode/tool/` 下共 **69** 个 `.ts` 文件（含各工具实现与测试）（已确认）

缺口：未核实 builtin 组实际注册条目数与 schema 序列化后总体积（未找到）。

## 4. 输出截断上限

现状：shell 与工具描述有明确上限，read/grep/glob 走统一 `Truncate`。

- `src/gyccode/tool/shell.ts:19` 统一走 `./truncate`（已确认）
- `shell.ts:48` `MAX_METADATA_LENGTH = 30_000`，`:422-423` 超限保留**尾部** 30k（已确认）
- `shell.ts:792` 超限落盘并回 `Full output saved to: {file}`；`:803`、`:862`、`:882` 带 `truncated` 标记（已确认）
- `shell.ts:141` `MAX_DEPTH = 8`（JSON 截断深度）（已确认）

## 5. token 统计与预算控制

- `src/core/session/cost-advisor.ts` 为成本/预算侧入口（已确认存在）
- `src/core/session/compaction.ts`、`message-updater.ts`、`src/gyccode/session/llm.ts` 均引用预算/maxTokens 字段（已确认存在）
- TUI 侧：`src/tui/routes/session/subagent-footer.tsx` 展示用量（已确认存在）

缺口：未核实是否存在**硬性 token 预算上限**（超限即拒绝/降级）还是仅提示（推断为仅提示，未确认）。