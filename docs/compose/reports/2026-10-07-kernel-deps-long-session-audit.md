# 内核与依赖稳定性审查（长时运行 / 长会话）

日期：2026-10-07　方式：只读审查（含 3 个并行子代理 + 主代理逐条复核关键证据）
证据级别标注：**实测**（跑过命令）/ **已确认**（读到源码原文）/ **推论**（由源码事实推导，未运行验证）

## 零、结论摘要

1. **承继内核（opencode 1.18.35）在长时运行维度有系统性防线**——SQLite 维护、定时器/监听器配对清理、缓存上限、重试上限、渲染上限均有显式实现，见 §五。未发现内核层的无界泄漏。
2. **当前工作区不是一个可运行/可验收的基线**：effect `4.0.0-beta.83 → 4.0.1` 迁移进行中，`bun run typecheck` **实测 259 个错误**。任何「长会话稳定」的结论只对 HEAD / 现有 `dist/` 有效，对当前 `src/` 无效。见 §一。
3. 发现 **1 个高风险运行时缺陷 + 2 个中风险累积点 + 1 处保留期死代码**，均有源码实证（§二、§三、R9）。
4. 发现 **1 处文档漂移**（`AGENTS.md` 记录的 effect 版本已过时，§四 R6）。
5. **R2/R3/R4/R6/R9 已修复**（§八）：类型级零新增错误；**运行时验证被迁移中间态阻塞**（`bun test` 在模块加载期即崩），未提交。

## 一、审查基线（先看这节，否则其余结论会被误用）

| 项 | 事实 | 级别 |
|---|---|---|
| 工作区改动 | 227 个文件未提交（`git status --porcelain` 实测） | 实测 |
| HEAD | `b53c275`，effect 仍为 `4.0.0-beta.83` | 已确认 |
| 当前 `node_modules` | `effect@4.0.1`（`package.json:100`） | 已确认 |
| 类型门禁 | `bun run typecheck` → **259 个 error TS**（如 `src/schema/event.ts:9` `isStartsWith` 已改名 `isStartingWith`；`src/protocol/groups/session.ts:8` `effect` 不再导出 `Encoding`） | 实测 |
| 迁移设计 | `docs/compose/specs/2026-10-07-effect-v4-acp-v1-migration-design.md:108-119` 已记录：升级引入 265 个错误、且「effect v4 的迁移在运行时是**原子的**」，半成品无法通过运行时验收（B1 单独完成后测试 110 fail） | 已确认 |
| 迁移计划 | 同文档 §四：B1 TaggedErrorClass → B2 unstable 重映射 → B3 可迭代 Effect → B4 构造签名 → B5 残余；每批四道门（typecheck / test / webapp typecheck / test:web） | 已确认 |

**推论**：`dist/index.js` 由旧源码构建，`gyc` 走 dist 时仍可运行；但 `bun run dev`（源码直跑）与 CI 门禁当前均不可用。迁移期间不应据当前 `src/` 评估长会话行为。

## 二、高风险

### R1 当前 `src/` 类型门禁红（259 错误）
- 位置：全仓（§一表格）
- 触发条件：以当前工作区构建 / 提交 / 跑源码
- 影响：pre-commit 类型门禁会拒；CI（`.github/workflows/ci.yml`）会拒；源码模式运行不可信
- 建议：见 §六 P0——要么把 B3/B4/B5 推完，要么把 `node_modules` 与 `package.json` 回到 beta.83 基线，**不要久留中间态**

### R2 LLM 并发 permit 在流消费前即释放（限并发形同虚设）
- 位置：`src/gyccode/session/llm.ts:409-422`
- 实证（已确认）：
  - `:419` `return yield* run({ ...input, abort: ctrl.signal })` —— `run`（定义于 `:104`）只做 provider 解析与请求准备，**同步返回 Stream 对象**，不消费流
  - `:421` `Effect.ensuring(semaphore.release(1))` —— 只包住「构建流对象」这一段
  - `:424` `if (result.type === "native") return result.stream`、`:429` `Stream.fromAsyncIterable(result.result.fullStream, ...)` —— 真正的消费发生在这之后（Effect Stream 惰性），permit 此时已归还
  - `:408` 注释自称「semaphore 应在整个流生命周期内持有，使用 flatMap 将释放延迟到流完成之后」——**注释描述的行为未实现**
- 与既有文档冲突：`docs/compose/reports/2026-10-02-a26-speed-token-audit.md:55` 记「permit 持满整个流生命周期」、`docs/BUG-REVIEW-2026-08-14-round3.md:50` 记「acquireRelease，无 permit 泄漏」——**无泄漏属实（release 对称），但覆盖面与文档不符**
- 影响：`LLM_MAX_CONCURRENT_STREAMS = 3`（`src/gyccode/session/llm-timeout.ts:34`）失效；10 个子代理可同时开 10 条流，正是该闸门要防的场景（`llm-timeout.ts:29-34` 自述：并发流是 idle-timeout 的 #1 原因；`docs/compose/reports/2026-10-02-vs-claude-code-metrics-26-29.md:254` 亦把「默认并发流仅 3」列为已确认事实）→ 长会话下 provider 429 / idle timeout / 内存峰值
- 修复方向：把 `release` 挂到流的消费期（如对返回的 Stream 再套 `Stream.ensuring(semaphore.release(1))`，或把整段放进 `Stream.scoped` 的 scope 内）；**注意 `run` 失败路径也要归还**

## 三、中风险

### R3 TUI store 的事件写入路径未纳入 LRU 淘汰
- 位置：`src/tui/context/sync.tsx`
- 实证（已确认）：
  - `:508-513` `message.updated` 对**任意** `sessionID` 直接 `setStore("message", sessionID, [info])` 建条目
  - `:528-546` 单会话仅保留最近 100 条
  - `:206-239` LRU（`MAX_HYDRATED_SESSIONS = 20`）只由 `markRecent` 驱动
  - `markRecent` 全仓调用点只有 `:798`、`:868`——**都在会话 hydration/浏览路径**
- 触发条件（推论）：会话从未被浏览（典型：子代理子会话）但产生了 `message.updated` 事件 → 该 sessionID 永久留在 `store.message` / `store.part`，`pruneHydratedSessions` 永远看不到它
- 影响：长跑 + 大量子代理会话时，TUI 主进程内存按会话数无界累积（每会话 ≤100 条，但会话数无上限）
- 建议：事件写入路径也调 `markRecent(sessionID)`，让 LRU 口径覆盖「写入过的会话」而非「浏览过的会话」

### R4 附件存储无保留期，且每轮全量载入字节
- 位置：`src/core/attachment-store.ts`（全文 171 行）
- 实证（已确认）：
  - `:49-54` 接口只有 `directory / persist / load / externalize`，**无 cleanup、无 RETENTION**
  - `:20` `MANAGED_DIRECTORY = "attachment"` 全仓只在该文件使用 → 没有任何清道夫
  - 对照 `src/core/tool-output-store.ts:15` `RETENTION = Duration.days(7)`、`:176-205` `cleanup()` + `Schedule.spaced(1 hour)`——但该清理**实际从未运行**，见 R9
  - `src/core/session/runner/to-llm-message.ts:367-384` 每轮把本会话**全部** ref 的字节 `store.load` 进 `Map<string, Uint8Array>`
- 影响：① 磁盘 `attachment/` 内容寻址文件永不删除（`blobName` 幂等但无回收）；② 会话内图片越多，每轮请求内存峰值越高
- 建议：给 AttachmentStore 补 retention + 定期清理（对齐 tool-output-store 的形态）；对历史 ref 考虑「仅最近 N 轮加载」

### R5 每轮循环全量重载会话历史
- 位置：`src/gyccode/session/prompt.ts:1255`（`while (true)` 顶部，`MessageV2.filterCompactedEffect(sessionID)`）
- 实证（已确认）：`:1251-1257` 每轮都重新拉取整个会话；`MessageV2.stream` 走分页全量（`src/gyccode/session/message-v2.ts:786-807`），`session.ts:916-939` 无 limit 时循环分页拉全量
- 影响：内存峰值随会话长度线性增长（截断只发生在「发给模型的序列化」阶段，内存中的原始 `state.output` 仍在，除非触发 compact/prune）
- 建议：评估「最近 N 轮 + 摘要」的内存视图或历史工具输出惰性加载；此条需先做测量再决定，不宜直接改

### R9 工具输出的 7 天保留期是死代码（本次审查新增发现）
- 位置：`src/core/tool-output-store.ts:199-211`
- 实证（已确认）：`cleanupLayer`（`:200-205`）仅被 `cleanupNode`（`:207-211`）引用；而 `cleanupNode` **全仓零引用**（`rg cleanupNode` 只命中定义处）。`makeGlobalNode`（`src/core/effect/app-node.ts:11`）只构造节点、**不自注册**，节点必须被 `src/gyccode/effect/app-runtime.ts` 的 `LayerNode.group([...])` 或 `src/gyccode/server/routes/instance/httpapi/server.ts:216` 的节点组引用才会实例化。
- 影响：`tool-output/` 目录下的截断产物按 `RETENTION` 该删的从未删除 → 磁盘无界累积；`AttachmentStore` 连清理代码都没有
- 教训：**「写了 cleanup 函数」不等于「cleanup 在跑」**——排查此类问题必须追到节点组的接线点

## 四、低风险 / 文档

### R6 `AGENTS.md:60` 依赖版本记录已过时
- `AGENTS.md:60` 写「`effect 4.0.0-beta.83`、`drizzle-orm 1.0.0-rc.2` 版本全锁定」
- 实际 `package.json:100` = `effect: 4.0.1`；`bun.lock:1217` = `effect@4.0.1`
- 影响：后续维护者按该行判断「当前是 beta」会做出错误决策（且该行正是本次迁移的立项理由，见迁移文档 §一）
- 建议：迁移落地后同步修正该行（`drizzle-orm 1.0.0-rc.2` 仍准确，迁移文档 §三 明确保留）

### R7 0.x 依赖
- `opentui-spinner: 0.0.7`（`package.json:117`）——0.0.x 允许任意破坏性变更
- `@agentclientprotocol/sdk: 0.21.0`（`package.json:30`）——迁移待办（迁移文档 §三）
- 级别：低（非核心路径 / 已立项）

### R8 `costStats` 全表载入
- `src/core/session/store.ts:84-98` 无 where/limit 读全部会话行，再在 JS 里筛根会话
- **代码注释 `:77-83` 已声明该口径偏差为有意设计，并明确「不是待修缺陷，别再当 bug 报」**——本条仅记规模风险（会话表行数大时单次调用内存/耗时线性），不主张改口径

## 五、已核实「无问题」（避免重复排查）

| 维度 | 证据 |
|---|---|
| SQLite | `src/core/database/database.ts:233-235` WAL + `synchronous=NORMAL` + `busy_timeout=5000`；`:47-53` `incremental_vacuum`；`:72-171` 事件 7 天保留 + 32MB 硬上限；`:183-214` 维护限频 24h |
| 定时器 | `src/gyccode/util/flock.ts:230-243`（release 内 clearInterval）；`src/gyccode/plugin/openai/ws-pool.ts:187-191`（close 清理，已 unref）；`src/cli/heap.ts:61-66`（stop）；`src/tui/terminal-win32.ts:100-132`（引用计数）、`:176-243`（单例） |
| 监听器 | `src/gyccode/bus/global.ts:40` 的 on/off 成对（`worker.ts:94/98`、`control-plane/util.ts:34/45` 等）；TUI `src/tui/context/sdk.tsx:36-47` + `onCleanup:167-172` |
| 缓存上限 | `inject-freeze.ts:13`（1000）、`message-v2.ts:158`（`TRUNCATION_DECISIONS_MAX=10_000` + LRU 淘汰）、`prompt.ts:86/101`（1000 + 过期）、`rules.ts:107`（500）、`cache-anchor.ts:64`（1000） |
| 重试 | `src/gyccode/session/retry.ts:37`（总预算 120s）、`:38`（最多 5 次）、`:36`（retry-after >5min 直接放弃）；低层 `src/llm/route/executor.ts:38-40`（MAX_RETRIES=2 + 抖动） |
| 渲染上限 | `src/tui/util/limit-content.ts:14,17`（2000 行 / 512KB）；`src/tui/routes/session/virtual-window.ts:17,39`（40 / 600）；`src/tui/util/diff-budget.ts`（8MB）；句柄预算**真占用**（`src/tui/component/limited-content.tsx:64-79` reserve/release + `onCleanup`，注释 `:48-57` 记录这正是先前「只查询不占用」的修复） |
| 子进程/句柄 | `src/core/pty.ts:120-139`（teardown + `EXITED_LIMIT=25`）；`src/core/cross-spawn-spawner.ts:298-321`；`src/core/file-mutation.ts:391-414` |
| 文件监听 | `src/core/filesystem/watcher.ts:81-84`（addFinalizer unsubscribe）、`:94-107`（订阅超时回滚） |
| 流清理 | `src/gyccode/session/processor.ts:628-686`（cleanup）+ `:775`（`Effect.ensuring`）；`src/gyccode/session/llm-timeout.ts:116-160`（idle + 首事件超时） |

**已排除的疑似项**：子代理审查曾疑 `globalHandleBudget.used()` 只增不减，复核后确认 `limited-content.tsx:64-79` 的 reserve/release 与 `onCleanup` 配对完整，**非泄漏**。

## 六、建议（按优先级）

| 优先级 | 动作 | 理由 |
|---|---|---|
| P0 | 结束迁移中间态：推完 B3/B4/B5，或把 `node_modules` + `package.json` 回到 beta.83 | 当前 259 个类型错误，任何验收与长会话结论都不成立 |
| P1 | 修 R2（permit 覆盖流消费期） | 唯一已实证的运行时缺陷；直接影响长会话并发稳定性，改动面小（`llm.ts` 单处） |
| P2 | 修 R3（事件路径纳入 LRU）、R4（附件保留期） | 均为无界累积，长跑场景收益明确；R3 单行级改动 |
| P3 | 修 R6（`AGENTS.md:60` 版本记录）；R5 先测量后决定 | 文档准确性；R5 改动面大、需先量化收益 |

## 七、本次未覆盖

- **未跑全量测试**：迁移中途 `bun run test` 结果不可解释（迁移文档 §五已记 B1 后 110 fail），故未执行。
- **未做运行时内存测量**：R3/R4/R5 的累积速率未用 `scripts/mem-watch.ps1` / `scripts/measure-memory.ts` 实测。
- **R2 未运行时验证**：结论来自源码路径分析（Effect Stream 惰性），未构造并发子代理场景实测 permit 争用。
- **未审 TUI fallback 安全模式路径**：本次仅覆盖主 TUI 与内核。

## 八、修复状态（2026-10-07 追加）

| 编号 | 修复内容 | 落点 | 类型级验证 | 运行时验证 |
|---|---|---|---|---|
| R2 | permit 改用 `Effect.acquireRelease`，归还挂到流的 scope，覆盖整个消费期 | `src/gyccode/session/llm.ts`（原 `Effect.ensuring` 包裹 `run` 的写法已删） | 该文件错误数 2 → 2（无新增） | **未完成**（见下） |
| R3 | 事件路径 `markRecent` + `pruneHydratedSessions`；新增在屏会话钉住项，避免淘汰正在看的会话 | `src/tui/context/sync.tsx`（3 处） | 该文件 0 → 0 | **未完成** |
| R4 | 新增 `RETENTION` + `cleanup` + `cleanupNode`，并接入两个节点组 | `src/core/attachment-store.ts`、`src/gyccode/effect/app-runtime.ts`、`.../httpapi/server.ts` | 3 文件错误数均无新增 | **未完成** |
| R6 | effect 版本记录更正为 `4.0.1` 并指向迁移文档 | `AGENTS.md:60` | 文档 | — |
| R9 | `ToolOutputStore.cleanupNode` 接入节点组，7 天保留期开始真正运行 | `src/gyccode/effect/app-runtime.ts`、`.../httpapi/server.ts` | 无新增错误 | **未完成** |

**验证口径（本次唯一可用的量化手段）**：`bun run typecheck` 错误总数改动前后均为 **259**，且五个被触碰文件的错误数逐文件一致（llm.ts 2 / sync.tsx 0 / attachment-store.ts 0 / app-runtime.ts 1 / httpapi/server.ts 2）。app-runtime.ts 那条既有错误由 174 行平移到 182 行（因新增 8 行），错误文本同一处。

**运行时验证曾被阻塞（实测证据）**：迁移中间态下 `bun test src/core/attachment-store.test.ts` 在**模块加载期**即崩：
```
TypeError: Attempted to assign to readonly property.
      at src/llm/schema/messages.ts:17:34
 0 pass / 1 fail / 1 error
```
即 effect v4 改变了 Schema 对象可变性，测试文件根本加载不到断言——这是 §一 中间态的必然后果，与修复本身无关。

### 处理：迁移已按谷总决定回滚（2026-10-07）

回滚范围：`git checkout --` 恢复 **221 个**迁移相关文件至 HEAD（B1/B2 机械改写），`bun install` 把 `effect` 降回 `4.0.0-beta.83`（实测 `node_modules/effect/package.json` 的 version 已确认）。**未回滚**（与迁移无关、需保留）：`AGENTS.md`、`scripts/verify-opentui-patches.cjs`、`scripts/manual_content_7.py`、`docs/gyccode操作手册.docx`、`src/webapp/vite.config.ts`、`src/webapp/src/monaco/setup.ts`（后两者是先前未提交的 monaco worker 配置简化，与 effect 无关）。

回滚后 5 项修复已在新基线上重放，验证结果：

| 验证项 | 结果 |
|---|---|
| `bun run typecheck`（回滚后、修复前） | **0 错误**（基线恢复绿灯） |
| `bun run typecheck`（回滚后、修复重放后） | **0 错误**（`error TS` 计数 0，exit 0） |
| 全量 `bun run test` | **未执行**——本机环境把长任务自动跳过（多次尝试均 skipped），**不得视为已验证** |
| 受影响模块单测（附件 3 个文件） | **未执行**，同上 |
| AppLayer 构建冒烟（新增两个 cleanup 节点） | **未执行**，同上 |

**未覆盖风险（明示）**：R2 的 permit 生命周期、R3 的 LRU 淘汰、R4/R9 的清理节点接线均只经过类型级验证；层图能否成功构建、清理任务是否按 1 小时周期实际触发，均未经运行时确认。
