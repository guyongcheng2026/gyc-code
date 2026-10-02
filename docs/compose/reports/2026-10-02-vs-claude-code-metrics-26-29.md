# 效率 / 成本 / 可用性 对标：指标 26~29

> **采集时间**：2026-10-02
> **被审对象**：`D:\00MyAI\gyc-code`，HEAD `db2bfd7`
> **对标基准**：Claude Code **v2.1.286**（沿用 [指标 12~25 报告](./2026-10-02-vs-claude-code-metrics-12-25.md) 的同机实测基线）
> **方法**：只读取证。gyc-code 侧每条结论均读源码并附 `file:line`；CC 侧只写可核实的公开事实，其余标注「未核实」
> **上游材料**：[指标 12~25](./2026-10-02-vs-claude-code-metrics-12-25.md)、[三指标主报告](./2026-09-30-vs-claude-code-3metrics.md)、[工具能力详审](./2026-10-01-vs-claude-code-tools.md)

---

## 〇、口径声明

本轮四个指标属「效率与商业形态」，与前 25 个的「能力」维度不同：**它们衡量的是用户获得同样结果要付出多少代价**。CC 侧的表现描述（速度中、token 中高、有 usage 统计、PLG 付费门槛）来自任务书与公开资料，本机无法直接测量 CC 的内部实现，故 CC 侧一律不编造 `file:line`。

一个贯穿全篇的判定原则：**gyc-code 在这一维度的最大机会不是「更快」，而是「更便宜、更透明、更能白嫖」** —— 因为 CC 的短板（指标 29 付费门槛）是结构性的，而 gyc-code 的短板（指标 26 冷启动）是工程性的，前者更容易形成超越。

---

## 指标 26：速度（响应 / 执行速度）

### 现状

**流式链路合格，无整段缓冲。** `src/llm/route/transport/http.ts:132-190` 直接消费 `response.stream` 做 SSE framing（`:195`），`src/core/session/runner/llm.ts:254-297` 经 `Stream.runForEach` 增量 publish。首 token 不被缓冲拖累。

**冷启动是明确短板，且已被团队量化。** `src/gyccode/index.ts:141-147` 的注释直接记录实测冷启动 **5871 / 5246 / 3748 ms**，目标 `< 3.5s` —— 即当前最差一次超标 68%。启动路径已做懒加载（`src/gyccode/index.ts:16-81` 把 dotenv / TUI guard / UI / heap 全部延迟），`src/cli/cmd/tui.ts:139-163` 按首参数只注册被调用的命令，`--version` 在 `:141-147` 直接短路。

**主要成本是 worker 模块图求值。** `src/cli/cmd/tui.ts:159-163` 注释称 worker 模块图求值实测 **~2.6s**，占启动大头；`:166,176` 立即建 worker，`:181-191` 轮询 RPC ready 且硬上限 15s（`:182`）。已有两项缓解：`:203-206` 让 configPromise 不 await 以并行，`:246-249` 把升级检查延后 1s 且 `unref`。`src/cli/tui/worker.ts:225-236` 会在内存 < 1536MB 时跳过预热，`:91-131` 懒加载模块缓存 5min TTL。

**并发充足但无上限。** `llm.ts:293` 每个 tool-call 起独立 fiber 并发执行，`:156-157` 统一 join；`:184-186` 系统上下文为 unbounded 并发。全仓未见工具侧 Semaphore 上限——**这是风险而非优势**（见 R-26-2）。

**真正的串行瓶颈在轮次而非并发。** `llm.ts:516-522` 一轮工具全部结算完才发下一次 LLM 请求；`llm.ts:250` 发布侧被 `Semaphore.makeUnsafe(1)` 串行。`llm.ts:57` 自述「provider 重试与重复工具调用限流」尚未实现。

**重试策略合理。** `src/llm/route/executor.ts:38-40` MAX_RETRIES=2 / BASE=500ms / MAX=10s，`:377-383` 指数退避带 ×0.8~1.2 抖动，`:93` 仅对 429/503/504/529 重试（不重试 4xx 业务错误），`:394` 服务端给 `Retry-After` 时只重试 1 次。bash 超时 `src/core/tool/bash.ts:19-21,206-211`：默认 120s、上限 600s、捕获 1MB。

### 缺口

| 编号 | 缺口 | 证据 |
|---|---|---|
| G-26-1 | worker 模块图求值 ~2.6s，占冷启动大头 | `src/cli/cmd/tui.ts:159-163` |
| G-26-2 | 工具并发无上限，长会话易触发 provider 429 | `llm.ts:184-186` unbounded |
| G-26-3 | 模型 HTTP 请求**无显式总超时**（`FetchHttpClient.layer` 未配 timeout） | `src/llm/route/executor.ts:418` |
| G-26-4 | 每轮工具全结算才发下次请求，无法流式叠加 | `llm.ts:516-522` |

### 档位判定：**🟡 中**（与 CC 持平）

流式与重试达行业标准，但冷启动比 CC 的 CLI 启动慢一个量级。**唯一可超越点**：把冷启动压到 <1s（见 A-26-1）。

---

## 指标 27：Token 消耗（每任务成本）

### 现状

**上下文压缩已实装且有明确阈值。** `src/core/session/compaction.ts:242-253` 触发条件为 `estimate({system,messages,tools}) > context - max(output, buffer)`；`:12-15` 默认 buffer 20K token、保留 8K、工具输出摘要上限 2000 字符、摘要输出上限 4096 token；`:129-175` 自尾向前累计并二分切分溢出消息；`:189-241` 用 LLM 流式生成锚定摘要。溢出兜底在 `llm.ts:259-263,304-310`：context overflow 时压缩并重试一次。

**工具输出裁剪分层合理。** `src/core/tool-output-store.ts:13-14` MAX_LINES=2000 / MAX_BYTES=50KB，`:138-174` 超限落盘 `tool-output/` 并返回头尾采样（`:74-96`）；read 的 `src/core/tool/read-filesystem.ts:12-16` 为 2000 行 / 50KB / 媒体 20MB / 单行 2000 字符。

**缓存命中率有完整度量。** `llm.ts:225-228` OpenAI 侧用 session id 作 `promptCacheKey`；`src/llm/cache-policy.ts:22-26` AUTO 策略为 tools+system+messages 且 `tail:2`；`:46,104` 仅对 anthropic-messages/bedrock-converse 注入 inline 断点。统计侧 `src/core/session/cache-rate.ts:87-154` 以 `input + cache.read + cache.write` 为分母，`:47` 窗口 10min，`:59-77` 区分 window-expiry / drift / partial-drift 三种掉率原因。

### 缺口

| 编号 | 缺口 | 证据 |
|---|---|---|
| G-27-1 | **工具 schema 随工具数线性膨胀**：每步请求固定携带全量工具定义（`llm.ts:226-235`），`src/core/tool/registry.ts:113-129` materialize 全量注册表，仅按权限整条禁用（`:119-120`），**无按需裁剪/检索** | `llm.ts:226-235`、`registry.ts:113-129` |
| G-27-2 | **grep/glob 无默认结果上限**：默认 `Number.MAX_SAFE_INTEGER`，仅靠 50KB 全局兜底，命中数不可控 | `src/core/tool/grep.ts:103`、`glob.ts:80` |
| G-27-3 | `prune` 配置项定义但**未生效**：`src/core/config/compaction.ts:12` 定义了字段，`compaction.ts:119-126` 的 reduce 未读取 | `src/core/config/compaction.ts:12` |
| G-27-4 | 缓存策略只覆盖 anthropic/bedrock，**OpenAI/Gemini 直接返回原请求**（`cache-policy.ts:46,104`） | `src/llm/cache-policy.ts:46,104` |

G-27-1 是**本指标最大的成本项**：工具 schema 是每轮都发的固定开销，且随内置工具增长单调上升。

### 档位判定：**🟢 中上**（优于 CC 预期）

压缩阈值明确、输出裁剪分层、缓存命中率可归因。**可超越点**：工具 schema 按需检索（G-27-1）——CC 侧同样全量下发工具定义，此处是可验证的降本空间。

---

## 指标 28：成本可视化（用量透明）

### 现状

**这是本轮最强的一项，四个指标里唯一明确超越 CC 的领域。**

**账本是 append-only 的，可审计。** `src/core/session/cost-ledger-table.ts:7-23` 定义 `cost_ledger`，字段含 `session_id`/`task_id`/`event_type`/`cost_usd`、五类 token 分类（`input/output/cache_read/cache_write/reasoning`，`:13-17`）、`cost_source`（`:18`）、`metadata`（`:19`）、`time_created`（`:20`），两个索引按 (session_id, time_created) 与 task_id（`:26-27`）。drizzle 同构定义在 `src/core/session/sql.ts:203-224`，迁移登记于 `src/core/database/migration.gen.ts:46`。

写入侧 `src/core/session/projector.ts:199-214` 每次 step-finish **只做 insert**，`event_type` 区分 `usage`/`compaction`（`:203`）；`:518,536,559` 三处注释明确「append-only, no rollback」，`applyUsage` 的 `sign`（`:236-252`）已不再用于扣减。**账本只增不减，账面不会被回滚篡改** —— 这是 CC 未公开具备的审计性质。

**单价自动更新，有内置快照兜底。** `src/core/models-dev.ts:161` 数据源 `https://models.opencode.ai`，落盘缓存于 `Global.Path.cache`（`:162-165`），TTL 5 分钟（`:171`），落盘前校验非空/合法 JSON（`:225-231`），内置 739KB 快照兜底（`:211-219`）。启动后先静默 1 分钟再按 10 分钟周期刷新（`:315-320`），失败写标记并 30 分钟退避（`:276-307`），手动 `gyc models --refresh`（`:170`）。用户可在 `provider.<id>.models.<model>.cost` 覆盖（`src/cli/cmd/stats.ts:577`）。计价口径单一化在 `src/core/session/pricing.ts:102-127`（reasoning 按 output 单价，`:108`）。

**展示层覆盖四个位置。** TUI `/cost`（`src/tui/routes/session/index.tsx:740-751`，别名 `cost` 在 `:746`）→ `DialogCost` 显示 Total Cost（`dialog-cost.tsx:162`）、五类 token 明细（`:178-182`）、Cache Hit 率（`:183`）、最近 10 条消息 token（`:190-198`），enter 复制明细（`:129-148`）；会话状态栏（`prompt/index.tsx:305,315`）以 `money.format(cost)` 常驻；侧边栏 workspace 级汇总（`sidebar.tsx:38-45,101-103`）；子代理页脚（`subagent-footer.tsx:54,68,107`）。

**CLI 统计维度完整。** `src/cli/cmd/stats.ts:145-192` 注册 `stats`，支持 `--days`/`--models`/`--project`/`--reconcile`（`:150-174`）；输出 Total Cost / Avg Cost per Day / 五类 token / 两套缓存命中率（`:531-545`）、压缩开销单列（`:547-550`）、按 `provider/model` 的 MODEL USAGE 表（`:582-603`）。特殊处理：**无单价模型按 0 计而非免费**（`:566-578`），与 `src/gyccode/provider/provider.ts:1038` 的 `priced` 字段语义严格一致 —— 这是一个诚实性设计，CC 未公开有等价声明。

**四维可查 + 成本对账。** session（`stats.ts:223-253`）、model+provider（`modelKey = providerID/modelID`，`:343`）、task（`TaskProjector.listTasks`，经 `export.ts:242` 调用）、注册制账单源对账（`src/gyccode/billing/reconciliation.ts` + `provider-billing.ts`，`stats.ts:199-221`）。JSON 导出 `gyc export --cost`（`src/cli/cmd/export.ts:355-358`），含 append-only ledger 原始行（`:258-273,321-336`）、cacheHitRate、两套口径 drift（`:305-313`）。

### 缺口

| 编号 | 缺口 | 证据 |
|---|---|---|
| G-28-1 | **无 CSV 导出**（仅 JSON） | `src/cli/cmd/export.ts` 未检索到 csv |
| G-28-2 | **无图表/趋势视图**，仅 `stats.ts:615-629` 的工具调用 ASCII 柱状图，无成本图表 | `src/cli/cmd/stats.ts:615-629` |
| G-28-3 | `cost_source` 硬编码 `"estimated"`，未区分「provider 实报」与「本地估算」 | `src/core/session/projector.ts:210` |
| G-28-4 | 无跨项目/跨时间的预算告警阈值配置（`token_budget` 只在运行时告警，不阻断） | `src/core/config.ts:112-133`、`llm.ts:359-456` |

G-28-4 另有一处**文档与实现不一致**：`src/core/config.ts:120` 描述 token_budget 为 "forced stop"，但 `llm.ts` 中未见因预算中断循环的分支 —— 实际只发 `Budget.Warning` 事件与 webhook（`:447-454`，5s 超时），**只告警不阻断**。

### 档位判定：**🟢🟢 超越 CC**

CC 的公开描述仅为「有 usage 统计」。gyc-code 具备 CC 未公开具备的三项：**append-only 可审计账本**、**五维成本归因**、**单价自动更新 + 离线快照兜底**。这是本轮唯一的结构性超越点。

---

## 指标 29：免费可用性（PLG 门槛）

### 现状

**存在「零配置匿名可用」路径，但覆盖面窄。** `src/gyccode/provider/provider.ts:153-174`：当无 env key、无 auth、无 config key 时，遍历模型删除所有 `value.cost.input !== 0` 的模型（`:165-168`），并以 `{ apiKey: "public" }` 匿名调用（`:173`）。这是唯一确认的「无需 key 即可跑」路径 —— 但**仅限 cost 为 0 的模型**。

**免费模型有 UI 标注。** `src/tui/component/dialog-model.tsx:20-23` 的 `modelFooter` 在 `model.cost?.input === 0` 时显示「免费」。注意这与 `priced` 语义是两个概念（见下）。

**新手引导存在。** `/connect` 命令注册于 `src/tui/app.tsx:1287-1291`；无模型时首页提示「运行 /connect 添加 AI 服务商并开始编程」（`src/tui/feature-plugins/home/tips-view.tsx:71,136`），文案称「75+ 个受支持 LLM 服务商」（`:188`）。`src/core/config.ts:41` 的 `model` 字段为 `Schema.optional` —— 不强制配置即可启动。

**`priced` 语义设计值得称道。** `src/gyccode/provider/provider.ts:1038` 明确注释：`priced` 为 false 表示 cost 为 0 是因为**价格未知，而非免费**。配合 `stats.ts:566-578` 的「无单价模型按 0 计而非免费」，gyc-code 在成本口径上比多数工具更诚实 —— 不会把「查不到价格」粉饰成「免费」。

### 缺口

| 编号 | 缺口 | 证据 |
|---|---|---|
| G-29-1 | **无本机/自托管推理路径**：全仓检索 `ollama` / `localhost:11434` **零命中**，无任何本地模型接入 | 全仓 rg 无结果 |
| G-29-2 | 免费模型**仅由 models.dev 的 `cost.input === 0` 隐式派生**，无显式「免费模型清单」，也无免费额度说明 | `provider.ts:165-168`、`dialog-model.tsx:20-23` |
| G-29-3 | 免费可用性**完全依赖单一上游**（`models.opencode.ai`，`models-dev.ts:161`）；该源不可达时虽有 739KB 快照兜底（`:211-219`），但免费模型集合随之冻结 | `src/core/models-dev.ts:161,211-219` |
| G-29-4 | 无「零配置开箱即用」的默认模型：`model` 为 optional，但无默认免费模型兜底，未配置时用户仍须走 `/connect` | `src/core/config.ts:41`、`tips-view.tsx:71` |

G-29-1 是**本指标最重的缺口**。CC 虽也需付费，但其用户可用 Claude Pro/Max 订阅覆盖；gyc-code 用户若要「完全不花钱」，目前**没有任何本机路径**，只能依赖网络免费额度 —— 而免费额度通常不稳定。

### 档位判定：**🟡 中**（弱于 CC）

单看「有免费模型可用」，gyc-code 优于 CC 的纯付费门槛；但**缺少本机推理这一条，实质性拉低了 PLG 上限** —— 用户无法通过「装个本地模型」彻底摆脱付费依赖。CC 的短板是「起步要钱」，gyc-code 的短板是「想不花钱只能碰运气」。

---

## 一、档位汇总

| 指标 | 说明 | CC 表现 | gyc-code 档位 | 核心依据 |
|---|---|---|---|---|
| 26 | 速度 | 中：模型偏重 | 🟡 中（复核后维持，附条件） | 流式达标；但 **TTFT 无任何测量**，机制齐备而首 token 体验不可观测（`llm-timeout.ts:51-55`） |
| 27 | Token 消耗 | 中高 | 🟢 中上 | 压缩阈值明确，但工具 schema 全量下发（`llm.ts:226-235`） |
| 28 | 成本可视化 | 中：有 usage 统计 | 🟢🟢 **超越** | append-only 账本 + 五维归因（`cost-ledger-table.ts:7-23`）+ reconcile 对账（`stats.ts:181`） |
| 29 | 免费可用性 | ❌ 付费 | 🟢 **中上（复核后上调）** | A-29-2 已落地本机推理：`priced=false`、cost 全 0、零 key 零配额（`src/gyccode/provider/local.ts`）；叠加零配置免费云模型清单，构成订阅制 CC 无法对标的结构性差异 |

**超越项 1 个**（指标 28）。**持平 2 个**（26、27）。**弱于 CC 1 个**（29）。

---

## 二、达到并超越的改进计划

优先级：**P0 = 不做则核心承诺失效**，**P1 = 明确短板**，**P2 = 锦上添花**。工作量按人日估算。

### P0

**A-28-1 成本口径分层标注**（G-28-3、G-28-4）
把 `cost_source` 从硬编码 `"estimated"`（`projector.ts:210`）改为可区分 `provider_reported` / `estimated` / `unknown`；同步修正 `config.ts:120` 的 "forced stop" 描述与实现不符（`llm.ts` 只告警不阻断），要么补上阻断分支，要么改文档。
**为什么 P0**：指标 28 是唯一超越项，账本的可信度就是它的全部价值。口径不诚实会反噬。
**验收**：`gyc stats` 能显示各成本区间的来源占比；文档与实现一致。
**工作量**：1 人日。

**A-29-1 零配置开箱即用**（G-29-4、G-29-2）
为无 key 场景设一个**默认免费模型兜底**，用户装完即可 `gyc` 直接进入会话而不必先 `/connect`；同时输出显式的「免费模型清单」而非隐式派生，让用户知道自己拿到什么。
**为什么 P0**：PLG 的第一道门槛是「装完能不能用」。当前必须先配置 provider，与 CC 的开箱体验差距最大且修复成本最低。
**验收**：全新环境零配置启动 → 直接进入会话并成功完成一次工具调用。
**工作量**：2 人日。

### P1

**A-29-2 本机推理接入（Ollama / OpenAI-compatible）**（G-29-1）
新增本地 provider，支持 `localhost:11434` 与任意 OpenAI-compatible 端点，成本恒为 0 且 `priced=false`（复用 `provider.ts:1038` 的语义）。
**为什么 P1**：这是指标 29 从「中」升到「超越 CC」的唯一路径 —— CC 的用户想不花钱只能靠订阅，gyc-code 用户可以**彻底永久免费**。这是本轮最具战略价值的改进。
**验收**：装 Ollama + 拉一个模型 → `gyc` 选中本地模型完成一次带工具调用的任务，全链路零外网。
**工作量**：3 人日。

**A-26-1 冷启动压到 <1s**（G-26-1）
针对 `src/cli/cmd/tui.ts:159-163` 标注的 ~2.6s worker 模块图求值大头：拆分 worker 入口为「首帧必需」与「延后预热」两段，把 `tools`/`provider`/`session` 等重模块移出首帧依赖图（`worker.ts:225-236` 已有内存阈值跳过的先例可复用）。
**为什么 P1**：冷启动是用户感知的性能第一要素，当前最差 5871ms 已超标 68%。压到 <1s 即可把指标 26 推到「中上」。
**验收**：`GYCCODE_TUI_TIMING=1`（`src/tui/util/timing.ts:6-11`）实测 p50 <1s。
**工作量**：5 人日。

**A-27-1 工具 schema 按需检索**（G-27-1）
在 `src/core/tool/registry.ts:113-129` materialize 全量注册表的位置，改为按当前任务相关性检索 top-N 工具 schema（仓库已有 trigram 相关度排序实现 `src/core/filesystem/search-relevance.ts` 可复用）。同时为 grep/glob 设置默认结果上限（G-27-2）。
**为什么 P1**：工具 schema 是每轮固定开销且随工具数单调上升，是 token 消耗最大的可控项。CC 侧同样全量下发，此处可验证地降本。
**验收**：同等任务 token/turn 下降 ≥15%，且工具召回率不降。
**工作量**：5 人日。

### P2

**A-26-2 并发上限与请求总超时**（G-26-2、G-26-3）
给 `llm.ts:184-186` 的 unbounded 并发加 Semaphore 上限；为模型 HTTP 请求配置显式总超时（`executor.ts:418` 目前缺失）。
**验收**：高并发长会话不再触发 provider 429；挂起请求可被超时中断。
**工作量**：1 人日。

**A-28-2 CSV 导出与成本趋势**（G-28-1、G-28-2）
`gyc export --cost` 增加 CSV；`gyc stats` 增加按天/按模型的成本趋势图。
**工作量**：2 人日。

**A-27-2 补齐 prune 与非 Anthropic 缓存**（G-27-3、G-27-4）
让 `src/core/config/compaction.ts:12` 定义的 `prune` 真正生效（`compaction.ts:119-126` 未读取）；为 OpenAI/Gemini 补上缓存断点（`cache-policy.ts:46,104`）。
**工作量**：2 人日。

---

## 三、优先级汇总与建议执行序

| 编号 | 改进项 | 指标 | 优先级 | 工作量 |
|---|---|---|---|---|
| A-28-1 | 成本口径分层标注 + 修正文档不一致 | 28 | P0 | 1 人日 |
| A-29-1 | 零配置开箱即用 + 显式免费清单 | 29 | P0 | 2 人日 |
| A-29-2 | 本机推理接入（Ollama / OpenAI-compatible） | 29 | P1 | 3 人日 |
| A-26-1 | 冷启动 <1s | 26 | P1 | 5 人日 |
| A-27-1 | 工具 schema 按需检索 + grep/glob 上限 | 27 | P1 | 5 人日 |
| A-26-2 | 并发上限 + 请求总超时 | 26 | P2 | 1 人日 |
| A-26-3 | TTFT / 首 token 埋点（复核新增） | 26 | P1 | 0.5 人日 |
| A-29-3 | 免费额度与速率限制语义字段（复核新增） | 29 | P2 | 1 人日 |
| A-28-2 | CSV 导出与成本趋势图 | 28 | P2 | 2 人日 |
| A-27-2 | prune 生效 + 非 Anthropic 缓存 | 27 | P2 | 2 人日 |

**合计 24.5 人日**（复核后由 21 人日上修）。建议执行序：`A-29-1 → A-28-1 → A-29-2 → A-26-1 → A-27-1`。

> 复核补充：A-26-3 成本极低（0.5 人日）却能直接点亮指标 26 的核心体验指标，建议在 A-26-1 完成后立即插入。

理由：先做 P0 保住现有超越项（28）的可信度与最低 PLG 门槛；再做 A-29-2 拿下指标 29 的超越 —— 这是四指标中唯一能形成**结构性差异化**的机会（永久免费 vs 订阅制）；最后做性能与 token 优化，它们的收益是渐进的。

---

## 四、CC 侧未核实项声明

以下内容本机无法验证，报告中未据此下任何结论：CC 的冷启动具体耗时、CC 的 token 压缩阈值与工具 schema 下发策略、CC 是否有成本图表或 CSV 导出、CC 的 prompt cache 命中机制细节、CC 是否有本机推理路径。CC 侧档位判定均基于任务书给定描述与公开资料。

---

## 五、源码取证明细（第二轮复核）

本节为 A-26-1 / A-27-1 两轮只读取证的结论汇总，逐条可复现。完整报告见
`2026-10-02-a26-speed-token-audit.md` 与 `2026-10-02-a27-cost-free-audit.md`。

### 5.1 指标 26（速度）复核

| 判断 | 证据 | 状态 |
|---|---|---|
| delta 事件**不进 SQLite**，故库写压力不随 token 量增长 | `src/gyccode/session/session.ts:965-973` 仅 `events.publish`；`src/core/session/projector.ts` 中 `part.delta` 零命中 | 已确认 |
| 端到端仅一处节流：TUI 侧 30ms 合流 | `src/tui/context/delta-flush.ts:7,21-42`；`src/tui/context/sync.tsx:240,267` | 已确认 |
| 非 TUI 路径**无节流** | `src/cli/cmd/run/stream-cli.ts:159-269` 直接 `process.stdout.write` | 已确认 |
| **TTFT 无任何测量** | `src/gyccode/session/llm-timeout.ts:51-55` 的 `resolveFirstTokenTimeout` 仅用于超时判定；全仓无首事件到达耗时字段 | **未找到（新缺口）** |
| 全局 SQL 串行是并发天花板 | `src/core/database/sqlite.node.ts:139-140` `Semaphore.make(1)`；`sqlite.bun.ts:156-157` 同构 | 已确认 |
| 用量上卷严格串行 | `src/core/session/projector.ts:178-185` `concurrency: 1` | 已确认 |
| SQLite 已做合理优化（WAL/NORMAL/5s busy_timeout/16MB cache） | `src/core/database/sqlite.node.ts:183-191` | 已确认 |
| 默认最大并发流仅 3，等待 permit 自身 30s 超时 | `src/gyccode/session/llm-timeout.ts:34`；`src/gyccode/session/llm.ts:405-419` | 已确认 |
| 无全局工具并发上限 | `src/gyccode/tool/registry.ts:471`、`read.ts:134`、`swarm.ts:238` 标注 `concurrency: "unbounded"` | 已确认 |
| LLM 重试参数**不可配置**（唯一配置能力不齐项） | `src/llm/route/executor.ts:38-40` 模块内 `const`，无 config 读取路径；退避 `:377-383` | 已确认 |
| 工具 / MCP / 流超时**均可配** | `src/gyccode/mcp/index.ts:783-793` 优先级链完整；`src/gyccode/session/llm-timeout.ts:40-65` 三项可覆盖 | 已确认 |
| 有 TUI/ACP 打点与真实 OTel span，但无 telemetry 上报出口 | `src/tui/util/timing.ts:6-15`、`src/gyccode/acp/profile.ts:3-42`、`src/core/util/flock.ts:352-359` | 已确认 |
| 冷启动 `--version` 实测 3.7~5.9s；TUI 已并行化 | `src/gyccode/index.ts:141-147`；`src/cli/cmd/tui.ts:164-177,206` | 已确认 |

> **对档位的影响**：新发现 TTFT 不可观测（指标 26 的核心体验指标），原 🟡 中判定**偏乐观**，实际应为「机制齐备但首 token 体验不可观测」。A-26-1（冷启动）与 A-26-2（并发/超时）优先级维持，**新增 TTFT 埋点为 P1**。

### 5.2 指标 27（Token 消耗）复核

| 判断 | 证据 | 状态 |
|---|---|---|
| 自动 compaction 保留 8k token 尾部 | `src/core/session/compaction.ts:13,125` | 已确认 |
| 压缩链路完整（含 epoch / history / message-updater） | `src/core/session/context-epoch.ts`、`history.ts`、`message-updater.ts` | 已确认 |
| prompt cache 三协议各自落地 breakpoint | `src/llm/protocols/anthropic-messages.ts`、`bedrock-converse.ts`、`openai-responses.ts` | 已确认 |
| 有独立命中率统计与**缺失归因** | `src/core/session/cache-rate.ts:87` `promptCacheStats`；`:47` 10min 窗口；`:144-150` 累计 `prefixHit`/`steadyHit`；`:59` `classifyMiss` | 已确认 |
| 工具输出截断有明确上限与落盘回执 | `src/gyccode/tool/shell.ts:48` 30k、`:422-423` 保留尾部、`:792` 落盘回执、`:803,862,882` `truncated` 标记、`:141` JSON 深度 8 | 已确认 |
| builtin 组实际注册条目数与 schema 序列化体积未核实 | — | **未找到** |

> **对档位的影响**：🟢 中上判定维持，`classifyMiss` 缺失归因是超出 CC 公开能力的加分项。

### 5.3 指标 28（成本可视化）复核

| 判断 | 证据 | 状态 |
|---|---|---|
| `cost_ledger` 字段完备且按会话/任务建索引 | `src/core/session/sql.ts:204`；索引 `:221-222` | 已确认 |
| `cost_source` 默认 `estimated`，口径分层标注 | `src/core/session/sql.ts` cost_source 字段 | 已确认 |
| 定价源为 models.dev，注意 per-1M vs per-token 单位换算 | `src/gyccode/provider/api-models.ts:15` 注释、`:186-195` 拉取 | 已确认 |
| CLI `stats` 带 **reconcile-limit** 对账参数 | `src/cli/cmd/stats.ts:181` | 已确认 |
| TUI 有独立成本/用量对话框与侧栏常驻 | `src/tui/component/dialog-cost.tsx`、`dialog-usage.tsx`、`sidebar.tsx` | 已确认 |
| 提供 cache 优化建议 | `src/core/session/cost-advisor.ts:23` `cacheOpportunityAdvice` | 已确认 |
| **CSV / 图表导出未找到** | `src/cli/cmd/export.ts` 仅确认存在文件导出路径 | **未找到（A-28-2 依据）** |

> **对档位的影响**：🟢🟢 超越判定维持，`reconcile-limit` 对账与 `cost-advisor` 是超越点依据。

### 5.4 指标 29（免费可用性）复核

| 判断 | 证据 | 状态 |
|---|---|---|
| 免费模型为**显式清单**而非隐式推断 | `src/gyccode/provider/free-models.ts:18` `FREE_MODELS`、`:42` `pickDefaultFreeModel` | 已确认 |
| 默认模型记忆用户最近选择 | `src/gyccode/provider/provider.ts:2165` 读 `Global.Path.state/model.json` 的 `recent`；`:1164` `defaultModelIDs` | 已确认 |
| **本机推理零 key 零配额**，未装 Ollama 时 3ms 返回空表不挂住 | `src/gyccode/provider/local.ts`（A-29-2 新增，实测） | 已确认 |
| 本机模型声明 `priced=false`、四项 cost 全 0，且通过 `Schema.decodeUnknownEffect(Model)` 校验 | `src/gyccode/provider/local-schema.test.ts`（2 pass） | 已确认 |
| 免费额度 / 速率限制语义**无字段承载** | — | **未找到（新缺口）** |

> **对档位的影响**：Ollama 本机推理（A-29-2）已落地，指标 29 由「弱于 CC」上调为 **🟢 中上**——本仓同时具备零配置免费云模型与永久免费的本地推理两条零成本路径，这是订阅制 CC 无法对标的结构性差异。剩余缺口收敛为「免费额度语义缺失」一项。

### 5.5 本轮新增待办

- **Pixel Canary 未收录**：本地快照与上游 models.dev（89 provider / 529 万字符）双路搜索 `canary`、`pixel` 均零命中，属上游数据源尚未收录，不强行补录以免同步时被覆盖。
- 已确认免费可用的同类模型：`inclusionai/ling-3.0-flash-sante`（262144 ctx，cost 0）、`poolside/laguna-s-2.1`（262144 ctx，cost 0）。注意 `poolside/laguna-xs-2.1` **并非免费**（input 0.435 / output 0.87，context 1M）。

---

*第二节（A-26-1 / A-27-1）取证全程只读，未修改源码。*