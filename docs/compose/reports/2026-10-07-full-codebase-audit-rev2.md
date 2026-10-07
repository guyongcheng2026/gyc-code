# gyc-code 全仓审查报告 rev2 —— §6 盲区收口后的更新结论与修复计划

> 日期：2026-10-07　基线：HEAD `689943f` **+ 工作区未提交改动**（`src/cli/cmd/tui.ts`、`src/cli/upgrade.ts`、`src/tui/context/sdk.tsx` 为 M）
> 关系：本文件是送审报告正文的**修订二**。原报告「6. 未覆盖区域（诚实清单）」的 10 项盲区已逐项补齐，据此重写结论与修复计划。
> 同目录 `2026-10-07-full-codebase-audit.md` 的正文与送审版本**不是同一份**，为避免覆盖丢失证据，本轮未改动它。
> 证据级别：**[复核]** 本人读原文确认；**[实测]** 本人跑命令取得原始输出；**[子代理]** 子代理给 `file:line`，本人未逐条复核；**[未核实]** 仍无证据。
> 本轮**未修改任何源码**，未提交 Git。

---

## 0. 口径修正（影响所有按文件数/行数的结论）

上一版列的三条方法学限制**已解除两条**：

| 上一版限制 | 现状 |
|---|---|
| `read` 工具被权限规则整体拒绝，取证全部降级为 `rg` 上下文 | **已解除**。`read` 现可正常读源码，本轮多条 P1 已改为读原文复核 **[复核]** |
| `docs/` 中文文档 GBK 乱码，维度 8 无法核实 | **基本解除**。`docs/` 现可正常读取，维度 8 已完成逐条核查；仅 `docs/GAP-ANALYSIS-2026-08-19-web-vs-dsh.md` 行 160–185 为**写入时即已丢失**的不可恢复乱码（该段含 377 个 `0x3F`，UTF-8 / GB18030 两种解码均无法还原），已排除在判定之外 |
| 文件量口径存疑（早期出现过 2181 / 5395 等互斥数字） | **已定案**。`rg --files src` 过滤 `*.ts/*.tsx` = **1620**，两法互证一致 |

**权威口径**（[实测]）：

```
src 下 TS/TSX = 1620                    .ts 1449 + .tsx 171
gyccode 523 | core 392 | tui 287 | protocol 94 | cli 80 | webapp 73
schema 66 | llm 63 | codemode 25 | effect-drizzle-sqlite 17 | ui 0
函数节点（AST 计数，其中非测试 17144）                    20988
```

两处上一版数字需更正：

- `src/tui` 实测 **287 文件 / 43,594 行**（上一版写 46,287 行，偏高约 6%）。
- 「2181」来自 `Get-ChildItem -Recurse -Include` 把 `src` 下 6 个嵌套 `node_modules`（cli/core/llm/protocol/tui/webapp）算了进去；「5395」无任何方法能复现，作废。

**取证工具链说明**（本轮新增，供后续复核复用）：仓库内 `typescript` 已是 **7.0.2 原生版**（Go 实现，不暴露 JS 的 `SyntaxKind` AST API），本轮精确度量改用 `Node.stripTypeScriptTypes()`（按位保留空白，行号不漂移）→ `acorn` 解析；`.tsx` 与个别文件用 `esbuild` 转译 → `acorn` + sourcemap VLQ 回映原始行号。

---

## 1. 更新后的问题总览

| 级别 | 上一版 | 现在 | 变化 |
|---|---|---|---|
| P1 | 4 | **4** | 4 条全部复核成立，无新增 |
| P2 | 14 | **22** | +8（webapp 5 项、微信网关 1 项、嵌套事务 1 项、revert 持久化 1 项） |
| P3 | 7 | **19** | 4 类泄漏模式与 6 类边界模式把大量「有风险但被兜底」的站点显式定级 |
| 已证伪撤销 | 7 | **13** | 新增 6 条（见 §4） |

**未发现 P0**（无确认的数据损坏 / 安全漏洞 / 进程挂死）。本轮新发现的最严重项为 P2：`gateway/weixin.ts` 静默丢弃消息游标，以及 `src/webapp` 的 SSE 总线退订竞态与终端面板句柄泄漏。

---

## 2. P1 —— 4 条全部复核成立

### P1-1 编辑工具锁池 LRU 驱逐破坏同文件互斥 → 并发丢更新 **[复核]**

`src/gyccode/tool/edit.ts:38-65`。第 40-43 行注释断言「被驱逐的锁从未在使用中（An evicted lock is never in flight）」，该断言**不成立**：持有者确实持有旧信号量引用，但被驱逐后新调用者会**为同一路径新建第二个信号量**（`:58`），两者互不阻塞 → 同一文件的读-改-写交错 → 丢更新。触发条件：单会话累计编辑过 200+ 个不同文件后，再次编辑早期文件。

### P1-2 工具层错误审计真空 **[复核]**

- `src/gyccode/tool/` 共 87 个源文件，仅 **2 个**调用自研 `logError`（`tool/actor.ts`、`tool/truncate.ts`）。
- 全仓 `Effect.logError(` 83 处、`Effect.logWarning(` 102 处，但据 `src/core/observability/error-audit.ts:49-63`，**只有自研 `logError(scope, error, fields)` 会写入 `error_audit` 表**；`Effect.logError` 只走 Effect 默认 logger。
- 最关键的失败路径（`session/llm.ts`、`mcp/index.ts`、httpapi 中间件）因此全部绕过审计表，而 `AGENTS.md` 把「必须落 `logError/logWarn`」列为铁律 —— **规则与实际执行脱节**。
- 叠加：`error_audit` 表**无任何消费方**（无查询、无展示、无告警端点），全仓 `ErrorAuditTable` 引用只有写入侧与一个测试。

### P1-3 健康检查端点恒真 **[复核]**

`src/gyccode/server/shared/handlers/health.ts:6`（全文 7 行）与 `src/gyccode/server/routes/instance/httpapi/handlers/global.ts:74-75`：

```ts
handlers.handle("health.get", () => Effect.succeed({ healthy: true as const }))
```

不探活 DB、不探子进程、不探磁盘。作为探针是误导性的。

### P1-4 读工具的行数上限不终止上游流 **[复核]**

`src/gyccode/tool/read.ts:280-300`：字节上限分支 `yield* new ReadStop()` 会终止流；**行数上限命中后只置 `flags.more = true` 并 `return`，不抛 `ReadStop`** → 上游 `fs.stream` 把整个文件读完，且因已提前 return，字节上限分支永远到不了。`read(file, limit=1)` 一个 5GB 日志 = 全量 I/O。不涨内存，但工具调用可能长时间占用。

---
## 3. P2 —— 22 项

### 3.1 上一版已列（14 项，全部复核成立）

| # | 问题 | 证据 |
|---|---|---|
| P2-1 | snapshot 与 edit 各持独立锁、键域不同 → 「并发编辑 + 回滚」无互斥 | `snapshot/index.ts:93-102,203`、`edit.ts:38` **[复核]** |
| P2-2 | OAuth 回调服务器引用计数在错误路径不重置 → 后续 `stopOAuthServer()` 在 refs>0 时提前 return，新起的监听器永不关闭 | `plugin/openai/codex.ts:140-145,226-233,236-244` **[复核]** |
| P2-3 | MCP 回调 `ensureRunning` 存在 TOCTOU：`isPortInUse` 与 `listen` 之间无原子性 | `mcp/oauth-callback.ts:9-10,18,105-131` **[复核]** |
| P2-4 | MCP 重连走游离 fiber：`EffectBridge.fork` 实为 `Effect.runFork`，仅靠 `s.disposed` 布尔兜底 | `mcp/index.ts:592`、`effect/bridge.ts:66-67` **[复核]** |
| P2-5 | 循环依赖偏多：16 个 SCC，最大含 155 文件，最小环 61 个 | Tarjan 脚本 **[子代理]** |
| P2-6 | 测试覆盖真空：`server` 109/6、`plugin` 21/0、`migration` 45/0、`codemode` 25/0、`llm` 63/4、`protocol` 94/1、`schema` 66/1；整个 server handler 层无测试 | 统计命令 **[复核]** |
| P2-7 | 「内核与上游逐字节一致」与现状不符：166 次本地提交触碰承继内核且含本仓自研修复 | `git log` **[复核]** |
| P2-8 | 记忆检索三处短板：子串计数打分无语义召回；注入首轮冻结（注释已说明为保 prompt 前缀缓存，属有意取舍）；画像 `USER.md` 未走 projectKey 跨项目共享 | `memory-bridge.ts:314-341`、`session/prompt.ts:1782-1793`、`memory/user-model.ts:61-67` **[复核]** |
| P2-9 | 12 项能力默认关闭且门禁不透明：模型可见工具表随环境漂移 | `runtime-flags.ts:11-14,52-69`、`tool/registry.ts:385-397` **[复核]** |
| P2-10 | 重复实现 4 组：并发锁 5 套、截断 4 套、退避 4 套、上限常量 3 份同值 | 各 `file:line` **[子代理]** |
| P2-11 | 类型断言密度（精确重算见 §6.3，结论已相对化） | AST 计数 **[实测]** |
| P2-12 | 超大单元：7 个 >1500 行文件；最极端复杂度见 §6.3 | AST 计数 **[实测]** |
| P2-13 | `run` 全链路 <42s 无实测。本轮补到**固定开销下界**（见 §6.4），端到端仍不可验证 | **[实测]** |
| P2-14 | dist 体积与启动策略：25.50 MB / 24 文件，`index.js` 10.77 MB 单文件 bundle。「源码比 dist 快 43%」的**口径需更正**（见 §6.4） | **[实测]** |

### 3.2 本轮新增（8 项）

| # | 问题 | 证据 |
|---|---|---|
| **P2-15** | **微信网关静默丢弃消息游标**：`writeJson("sync-buf.json", …).catch(() => undefined)` 与 `saveContextToken(...).catch(() => undefined)` 失败**只静默**（无日志、无事件）。游标丢失 → 重启后重复投递或漏投；context token 丢失 → 回复失败。同文件 `:151` 的 `readFile().catch(() => undefined)` 把「文件不存在」与「读取失败」压成同一结果 | `gateway/weixin.ts:151,251,353,358` **[复核]** |
| **P2-16** | **webapp SSE 总线退订竞态**：`buses` 是模块级 Map，退订在 `buses.delete(directory)` 前只比较**引用相等**，无版本/代数校验。React 18 StrictMode 双挂载（订阅→卸载→订阅）会 abort 掉刚建立的新流 | `webapp/src/client/useEvents.ts:19,36-43` **[复核]** |
| **P2-17** | **webapp 终端面板卸载不清理**：激活 effect **没有 cleanup 返回值**，`connectPty` 创建的 WebSocket 与 `termRef` 的 xterm 实例在卸载时不关闭/不 `dispose()`；`App.tsx:398-402` 把该组件放在 `showTerminal ?` 条件分支下，关掉底部终端即卸载 → 服务端 PTY 悬挂。同文件 `:94` 对 ResizeObserver 有 cleanup，属**漏项而非有意设计** | `webapp/src/app/TerminalPanel.tsx:61-80,94,100-108`、`App.tsx:398-402` **[复核]** |
| **P2-18** | **webapp 5 处静默吞掉功能路径错误**，其中 `useEvents.ts:31-33/35-37` 最严重 —— 注释称「SSE 客户端自带断线重连」，但 `src/protocol/v1/gen/core/serverSentEvents.gen.js:106` 的 `sseMaxRetryAttempts` **调用方未传 → undefined → 无限重试**，一旦真实失败界面**永久空白且无任何日志** | `useEvents.ts:31-33,35-37`、`useCommands.ts:37`、`useWorkspace.ts:56`、`useSessionInfo.ts:44-48`、`App.tsx:263` **[复核]** |
| **P2-19** | **webapp 状态层流式文本无界增长**：`message.part.updated` 的 `delta` 无上限累加进 `existing.text`；行数上限只在**渲染期**切片，状态层无界 | `webapp/src/app/chatReducer.ts:82-113`、`ToolBlocks.tsx:99-101` **[复核]** |
| **P2-20** | **webapp 依赖边界不可独立验证**：`src/webapp/package.json` 只有 name/scripts，**无 `dependencies`**，全部依赖靠根 `package.json` 与 workspaces 提升。反过来 `src/webapp/tsconfig.json` 是本仓**唯一显式开 `strict: true`** 的包（根 tsconfig 未开） | 两个 `package.json` / `tsconfig.json` **[复核]** |
| **P2-21** | **嵌套事务 savepoint 可能悬挂**：`release savepoint` 的失败被 `Effect.catch(() => Effect.void)` 吞掉；嵌套事务（id≠0）成功路径**只跑 releaseSavepoint**，一旦它失败，外层 `rollback` 的回滚范围会超出预期。注：外层 `commit` 失败路径是**正确**的（rollback 后 `Effect.andThen(Effect.fail(error))` 把原错重抛） | `effect-drizzle-sqlite/effect-sqlite/session.ts:157,170,183` **[复核]** |
| **P2-22** | **revert diff 持久化静默降级**：`storage.write(["session_diff", id], diffs).pipe(Effect.ignore)` —— diff 仍经事件（`:76`）与内存（`:77`）暴露给用户，但**磁盘副本可能静默过期**，重启后 revert 视图与实际不一致，且无任何留痕 | `session/revert.ts:75-77` **[复核]** |

---

## 4. 已证伪撤销（累计 13 条，本轮新增 6 条）

上一版撤销 7 条（`overflow.ts:94` 有意设计、`session.ts:1040` 误判、`reconciliation.ts:90-91` 已兜底、WAL 有 checkpoint、`skills/` 非死代码、`strict-index-baseline.txt` 无豁免项、迁移有 journal）。本轮**再撤销 6 条**：

| 候选结论 | 复核结果 |
|---|---|
| `snapshot/index.ts:328` `catch(() => Effect.void)` 后接 `Effect.map((stat) => stat.size)` 是未定义解引用 | **误判**。`:331` 有 `if (!stat || stat.type !== "File") return` 守卫，`Effect.void` 产出的 `undefined` 被显式处理 **[复核]** |
| `core/session/sql.ts` 的 21 处 `.on(` 是监听器缺口 | **误判**。全是 drizzle 索引构造器 `index(...).on(table.col)`，零泄漏 **[复核]** |
| `tui/feature-plugins/system/notifications.ts` 的 7 处订阅无卸载 | **误判**。由插件作用域托管：`plugin/tui/runtime.ts:620-622` `on()` 返回 `scope.track(...)`，`dispose()` 统一回收 **[复核]** |
| `prompt.ts:1154` / `processor.ts:425` 每图一次 native resize 是子进程风险 | **降级**。`image.normalize` 是 **photon wasm 进程内**（`with { type: "file" }`），无子进程/fd → P3 **[复核]** |
| `cli/core/renderer.ts:178` spinner 定时器泄漏 | **降级**。`start()` 确无重入守卫（二次 start 会覆盖 interval 引用），但该 `createSpinner` 在 `src` 内**已无调用方**，属死代码中的潜在缺陷 → P3 **[复核]** |
| `session/prompt.ts:1035,1057` 读文件失败后返回空内容 | **误判**。两处是 `Effect.exit` 分支：失败后 `logError` + 发布 `Session.Event.Error` + 向模型注入 `Read tool failed to read <path> with the following error: <message>`。日志、用户可见事件、模型可见原因三者齐备 **[子代理]** |

---
## 5. 十项盲区的收口结果

| # | 上一版盲区 | 状态 | 位置 |
|---|---|---|---|
| 1 | 维度 8 对标核查（GAP 文档逐条） | **已收口**（08-19 行 160–185 乱码除外） | §6.1 |
| 2 | 维度 3 的 4 类模式 + `Failed to create TextBuffer` 定位 | **已收口**（残留 2 点） | §6.2 |
| 3 | 维度 4 的 6 类模式 | **大部分收口**（3 点残留） | §6.3 |
| 4 | 维度 1 剩余站点（`Effect.all` 并发 / 监听器信号 / `src/tui` / `src/ui`） | **已收口** | §6.5 |
| 5 | 维度 14 静默失败分级（1437 处） | **部分收口**（口径已改正；逐站判定约 25 处） | §6.6 |
| 6 | 维度 10 类型安全精确计数 | **已收口** | §6.3 |
| 7 | 维度 9 review/debug 闭环 | **已收口**（3 点残留） | §6.7 |
| 8 | 维度 11 真冷缓存与 TUI 全量启动 | **已收口**（口径修正） | §6.4 |
| 9 | 维度 7 精确圈复杂度 | **已收口** | §6.3 |
| 10 | `src/webapp`（73 文件 / 8 测试） | **已收口** | §3.2 P2-16~20 |

### 6.1 维度 8 对标核查

**结论：关键清单已逐条核对完毕，文档自述状态存在明确失效。**

**A. `docs/GAP-ANALYSIS-2026-08-16-vs-claude-code.md` §2.2「18 个缺失工具」逐条判定：**

| 条目 | 判定 | 证据 |
|---|---|---|
| EnterPlanMode | 已建但默认关闭 | `tool/plan.ts:128`、`registry.ts:322,391`、`runtime-flags.ts:61` |
| EnterWorktree / ExitWorktree | 已建但默认关闭 | `tool/worktree.ts:23,60`、`registry.ts:323-325,392`、`runtime-flags.ts:64` |
| NotebookEdit | 已建 | `tool/notebook.ts:94`、`registry.ts:336,401`（无门禁） |
| PowerShell | 已建（等价） | `tool/shell.ts` 统一 shell 抽象 |
| ListMcpResources / ReadMcpResource | 已建 | `session/tools.ts:26,29,154,236,319` |
| McpAuth | 已建 | `tool/mcp-auth.ts:12`、`registry.ts:340,405` |
| MCPTool | 已建（等价） | `session/tools.ts` 动态注入 |
| REPL | 已建但默认关闭 | `tool/code-mode.ts:201`、`registry.ts:346`、`runtime-flags.ts:62` |
| ScheduleCron | 已建 | `tool/cron.ts:387`、`registry.ts:337,402` |
| SendMessage | 已建（等价） | `tool/swarm.ts` + `tool/peer.ts`、`registry.ts:343-344,406-407` |
| TaskCreate / TaskUpdate | 已建（等价） | `tool/task.ts`、`tool/task-manage.ts`、`registry.ts:306` |
| TeamCreate / TeamDelete | 已建（等价） | `agent/swarm/coordinator.ts` |
| **RemoteTrigger** | **未建** | 全仓 0 命中 |
| **SyntheticOutput** | **未建** | 全仓 0 命中 |

**B. §3.3「8 个 P0 斜杠命令」—— 全部已建。** 注册真实位置确认为 `src/tui/app.tsx` 1265-1781 + `src/tui/routes/session/index.tsx` 527-1417；文档写的 `src/tui/` 路径有效，`src/gyccode/cli/tui/` **不是**斜杠命令注册地。

| 命令 | 注册点 → 弹窗 |
|---|---|
| `/config` | `tui/app.tsx:1660→1663` → `dialog-config.tsx` |
| `/doctor` | `tui/app.tsx:1650→1653` → `dialog-doctor.tsx` |
| `/usage` | `tui/app.tsx:1680→1683` → `dialog-usage.tsx` |
| `/permissions` | `tui/app.tsx:1690→1693` → `dialog-permissions.tsx` |
| `/vim` | `tui/app.tsx:1700→1703` → `dialog-vim.tsx` + `tui/vim.tsx` |
| `/cost` | `session/index.tsx:769→772` → `dialog-cost.tsx` |
| `/context` | `session/index.tsx:781→784` → `dialog-context-info.tsx` |
| `/rewind` | `session/index.tsx:793→796` → `dialog-rewind.tsx` |

**C. §4.1 服务层 25 条 —— 已建 16 / 未建 9**

已建：api、analytics、autoDream、compact、extractMemories、MagicDocs、mcp、oauth、SessionMemory、AgentSummary、settingsSync（已迁址到 `server/routes/instance/httpapi/groups/sync.ts`）、tips、tokenEstimation、notifier、claudeAiLimits、internalLogging。

未建：**PromptSuggestion、remoteManagedSettings、teamMemorySync、toolUseSummary、voice、preventSleep、vcr、policyLimits、diagnosticTracking**。

**D. 文档失效点（文档行号 ↔ 代码）**

1. `08-16:373` 自述 `session/tool-use-summary.ts`「已新建」→ 文件**不存在**，`rg` 仅命中文档自身。判定由「已建」退回**未建**。
2. `08-16:374` 自述 `session/diagnostic-tracking.ts`「已新建」→ 同上，**未建**。
3. `08-23:48-50`「P0 无流程编排引擎／无用户自定义工作流配置」→ **已被推翻**：`core/workflow/index.ts:65-80`、`core/workflow/state.ts:24,51-55`（JSON/JSONC + retry/onFailure 状态机）、`schema/workflow.ts:33-40`、`database/migration/20260823000000_workflow.ts`、`cli/cmd/workflow.ts:164`。
4. `08-16:15`「工具数 25 个 .ts、缺 18 个」→ 现 `src/gyccode/tool/` 共 **79 个 .ts**，18 条中 14 条已建或已建默认关闭。
5. `08-16:177`「P0 缺失 8 个」→ 8 个**全部落地**。
6. `08-23:142/198`「TUI /config 命令缺失」→ `tui/app.tsx:1660` 已建。
7. `08-19:33`「透明滚动条未对齐」→ `webapp/src/index.css:428-434` 已实现。
8. `08-19:26`「三栏布局未对齐」→ `webapp/src/app/App.tsx:165,287` 侧栏拖宽已做（「56px 折叠轨」**未核实**）。
9. `08-23:149`「bughunter/ultraplan/insights/advisor/security-review 无后端」→ 命令入口已建（`session/index.tsx:1365-1417`），**仍为提示注入型、无后端，该条仍然成立**。

**E. 确认仍缺**：工具 `synthetic_output`、`remote_trigger`；服务 9 项（见 C）；安全：v2 高危命令拦截（`core/tool/bash.ts:66-77` 仍为 TODO，无 `classifyCommand`）、OS 级沙箱（无 seatbelt/bubblewrap）、命令前缀级白名单；检索：代码库索引（无 bm25 / 符号表 / embedding）；产品：VSCode 插件、单文件原生二进制（`package.json` 无 `bun --compile`）、`assistant/`、`buddy/`、`outputStyles/`、`native-ts/` 四模块目录**均不存在**。

**F. 取证限制**：`08-19` 行 160–185 不可恢复乱码，已排除。未核实项：① 08-23 §三 reflect/checkpoint 是否等价于 `core/workflow/state.ts` 状态机；② 08-23 §五 子任务成本汇总；③ 08-23 §六 跨会话上下文缓存是否即 `session/cache-anchor.ts`；④ 08-23 §一 v2 是否动态注入 add-dir；⑤ 08-19 三栏折叠轨。

---
## 7. 本轮修复状态（2026-10-07 · 修复阶段一）

### 7.0 前置：工具链修复（阻塞项）

**现象**：`bun run typecheck` 报 **6784 个错误**，根因全部是 `Cannot find module 'effect'`。
**定位**：`node_modules/effect` 是 Junction → `node_modules/.bun/effect@4.0.0-beta.83/...`，但该解包目录的 `dist/` **只有 5 个条目**（`unstable/` + `Utils.*`），`dist/index.js` 与 `dist/index.d.ts` 缺失 —— 安装被中断。而 `effect@4.0.0-beta.83` 的 `exports["."]` 正指向 `./dist/index.js`，于是 TS / node / bun 三者全部解析失败，级联出 6784 条错误。
**修复**：删除损坏目录 + `bun install`（`dist` 从 5 项恢复到 **551 项**；`bun.lock` 哈希前后一致，未被改动）。
**结论**：基线报告的「`bun run typecheck` 0 错误」是对的，这是**环境回退**而非代码问题。
**待沉淀**：再遇到「整仓几千条 TS2307 + 大量 7006 隐式 any」，**先查 `node_modules/effect/dist/index.js` 是否存在** —— 这是 6784 条错误的唯一根因。

### 7.1 已修复：3/4 条 P1（全部走 TDD）

| 项 | 改动 | 测试 | 结果 |
|---|---|---|---|
| **P1-1** 编辑锁池驱逐破坏互斥 | `tool/edit.ts:38-70`：锁条目改带 `users` 引用计数，`evictIdleLocks()` 只回收 `users === 0`；`lock(path, effect)` 形态，取条目与 `users++` 在同一同步段、`Effect.ensuring` 归还（成功/失败/中断三条路径都覆盖）；`:108` 调用点同步改 | `tool/edit-lock.test.ts`（5 用例） | 先 **0/5 失败** → 现 **5/5** |
| **P1-3** 健康检查恒真 | `protocol/groups/health.ts` 声明 `error: HttpApiError.ServiceUnavailable`；`server/shared/handlers/health.ts` 探活 DB、失败 503；`httpapi/groups/global.ts` 与 `httpapi/handlers/global.ts` 同样处理 | `server/shared/handlers/health-probe.test.ts`（5 用例） | 先 **0/5 失败** → 现 **5/5** |
| **P1-4** 行数上限不终止上游流 | `tool/read.ts:266-315`：行数/字节两分支都 `yield* new ReadStop()`，新增 `countExact` 标志；`:575` 与 `:590` 按 `countExact` 决定是否打印总行数 | `tool/read-line-limit.test.ts`（7 用例） | 先 **5/7 失败** → 现 **7/7** |

**P1-3 的设计取舍（留档）**：没有把 success schema 的 `Schema.Literal(true)` 放宽成 `Boolean`。因为 `src/protocol/v2/gen/types.gen.ts:6221,9599` 是**生成产物（禁手改）**，放宽源 schema 会让生成客户端过期，而本仓 `package.json` 里**没有可用的 protocol 代码生成脚本**（无 gen/protocol/sdk 类命令）。改为**声明 503 错误通道**后：**200 恒等于「真的健康」**，schema 不动、gen 不动，且更符合健康检查标准约定（200/503）。探针走同步 SQLite 查询（与同层 `fence.ts` 同一 `db` 形状），不 fork、不等网络，端点自身不会成为新的挂起源；失败用 `Effect.catchCause` 兜（同步查询抛错是 defect，`Effect.catch` 抓不到）。

**P1-4 的连带语义（不一起改就会引入回归）**：`lines` 返回的 `count` 被 `read.ts` 三处消费 —— `:547` offset 越界判定、`:575` `of ${count}` 总行数展示、`:577` `End of file - total N lines`。一旦提前终止，`count` 从「全文件总行数」退化成「扫描位置」，直接改会产出 `Showing lines 1-1 of 1` 这类错误文案，并让 `offset=2` 被误判越界。因此引入 `countExact`：`:575` 只在精确时打印总数，`:590` 的 `displayEnd` 在折叠路径改由全文行数（`compactionTotal`，取 `Math.max` 防二次读取失败时把窗口当总行数）给出。`:547` 天然安全 —— offset 越界场景本就扫到 EOF，`count` 仍精确。

### 7.2 验证（真实输出）

| 命令 | 结果 |
|---|---|
| `bun run typecheck` | **error TS: 0，exit=0** |
| `bun run test` | **2096 pass / 9 skip / 0 fail**，241 文件 |
| 三个新增测试文件合计 | **17 pass / 0 fail**（5 + 5 + 7） |
| `node bin/gyc --help` ×5 | min 545 / med **554** / max 600 ms（改动前基线 med 524 ms，噪声内） |

**已知测试抖动（非本次引入）**：首次全量跑时 `src/gyccode/cli-integration.test.ts` 的 `gyc --help prints help` 超时（30004ms > 30s 上限）失败 1 次；**单跑该文件 3 pass / 0 fail / 1.87s**，第二次全量跑即 **0 fail**。判定为全量并行负载下的子进程启动超时抖动，非回归。

### 7.3 未修复清单（取证已完成，待排期）

| 项 | 状态 | 已取得的关键取证（可直接开工） |
|---|---|---|
| **P1-2 错误审计真空** | **未修** | 需先做三个设计决策：① 是否在 Logger 层把 `Effect.logError/Warning`（83+102 处）桥接进 `error_audit` —— `logError()` 走 `console.error`、与 Effect Logger 是两条通道，不会重复计；② scope 命名从哪来（Effect 调用点没有 scope 参数）；③ 查询出口走新 CLI 命令（会触发 `command-registry.ts` 重生）还是扩 `gyc stats`。**当前 `error_audit` 无任何消费方，只接写入端价值有限** |
| P2-15 微信网关静默丢游标 | **已修** `5ea49e8` | `gateway/weixin.ts:353,358` 已改调自研 `logError(scope, error, fields)`（同步 void，直接调用）：`:353` 游标写盘带 `accountId`，`:358` context token 带 `accountId`+`senderId`。`:151`（读 state 文件，ENOENT 属正常）与 `:251`（mkdir；失败后 `:353` 必然失败并已被记录）按计划未改 |
| P2-2 OAuth 引用泄漏 | **已修**（根因修正） | **原假设不是真凶**：`:227` 错误路径清 `oauthServer` 不清 `oauthServerRefs`，逐条推演后计数仍与持有者平衡（死服务器的持有者各自 stop 会把自己的引用还掉），无法构造泄漏。真凶在调用侧 —— `:459-470` 的 `stopOAuthServer()` 写在 `const tokens = await callbackPromise` **之后**，而 `callback` 是急切调用的（`provider/auth.ts:202`），回调超时/被 `/cancel` 取消/供应商回传 `error` 时 `await` 直接抛出 → 引用永不归还 → 计数长期 >0 → 监听器永不关闭。同仓 `digitalocean.ts:306-310`、`snowflake-cortex.ts:477-491` 都已是 try/finally 形态，codex.ts 是唯一例外 |
| P2-3 MCP 回调 TOCTOU | **已修** | `oauth-callback.ts:105-131`：`isPortInUse` 与 `createServer` 之间是 await 间隙，并发调用双双判定「端口未占用」→ 各自建服务器 → 后者赋值把先建的覆盖成孤儿（已 listen 成功却无人引用，`stop()` 关不到）→ 端口与监听器泄漏。改用模块级 promise 链串行化 |
| P2-21 嵌套事务 savepoint | **已修** `5ea49e8` | `session.ts:170` 改用不吞错的 release，release 失败向外传播；`:157` 的吞错保留给 ensuring/回滚兜底（不吞会覆盖原始失败），已就近注释说明。外层 commit 失败路径 `:161-169` 未动 |
| P2-22 revert diff 持久化静默 | **已修** `5ea49e8` | `revert.ts:75` 的 `Effect.ignore` 换成 `Effect.catchCause` + `logError("session.revert.persist-diff", Cause.squash(cause), { session.id })`；diff 仍经事件与内存暴露，未改成本失败语义 |
| P2-16~19 webapp 4 项 | **P2-17/18/19 已修；P2-16 前提不成立** | 见 §7.7 / §7.8。P2-16 的「StrictMode 双挂载会 abort 刚建立的新流」**未能复现**：cleanup 用 `current !== bus` 早退，恰好挡住误杀新流的路径（卸载时 `buses.delete` 已把旧 bus 移出映射，再挂载建的是新 bus，旧清理早退）。按不误报原则降级为观察项，未改代码 |
| P2-20 webapp 依赖声明 | 未改 | 极可能动到 `bun.lock`（禁改清单），倾向判为「需人工决策」 |
| P3 组 7 项 | 未修 | `prompt.ts:976-996` 已确认 `start` 是 **1 基**、LSP `r.start.line` 是 **0 基** → **确为错位，应改代码**；`prompt.ts:1790` 照抄 `quota-alert.ts:81-95` 的本地时区写法；`pdf.ts` 7 处 `Number(x ?? 0) \|\| 0` **需先写测试实证**（`operands` 含 name 对象/TJ 数组，`Number()` 可能得 NaN，此时 `\|\| 0` 有意义，不能盲删）；`openapi/runtime.ts:325` 初判**无截断路径，可能不该改** |

### 7.4 更新后的修复优先序

1. **P2-15 / P2-22 / P2-21** —— ✅ 已完成，见 §7.5。
2. **P2-2 / P2-3** —— ✅ 已完成，见 §7.6。
3. **webapp P2-16~19** —— ✅ 已完成（P2-16 经复核前提不成立），见 §7.7 / §7.8。
4. **P3 组** —— glob 截断误报、prompt 基数与时区、pdf 冗余、spinner 守卫、UTF-8 边界。
5. **P1-2** —— 先答复 7.3 的三个设计问题再动手；建议连带把 `error_audit` 查询出口一起做。
6. **P2-6 测试真空区**（server handlers / plugin / migration）与 **P2-12 大单元拆分** —— 改动面大，单独立项。

### 7.5 修复阶段二：P2-15 / P2-21 / P2-22（`5ea49e8`）

| 项 | 改动 | 测试 | 结果 |
|---|---|---|---|
| **P2-22** revert diff 持久化静默 | `session/revert.ts:76-83`：`Effect.ignore` → `Effect.catchCause` + `logError("session.revert.persist-diff", Cause.squash(cause), { "session.id" })` | `session/revert-diff-persist.test.ts`（1 用例） | 先 **1 fail** → 现 **1 pass** |
| **P2-15** 微信网关写盘静默 | `gateway/weixin.ts:12,353-355,359-364`：补 `logError` 导入；两处 `.catch(() => undefined)` 改带 scope 与字段 | `gateway/weixin-write-observability.test.ts`（2 用例） | 先 **1 fail + 1 error** → 现 **2 pass** |
| **P2-21** 嵌套事务 release 被吞 | `effect-sqlite/session.ts:154-158,175-178`：成功分支改用不吞错的 release；吞错处就近注释原因 | `effect-sqlite/session-release.test.ts`（2 用例） | 先 **1 fail + 1 pass** → 现 **2 pass** |

**验证（真实输出）**：`bun run typecheck` **exit=0**；`bun run test` **2101 pass / 0 fail / 5222 expect / 244 文件 / 90.59s**（较修前基线 2096 pass +5 用例、+3 文件）。

**测试口径（如实说明）**：这三项是**源码断言测试，不是行为测试** —— 三处分别埋在需要 6 个依赖的 Layer 服务、长轮询适配器与跨包事务内，搭行为级夹具的成本远高于收益，故按 §7.4 预先声明的「源码断言测试」执行。它防的是「日志被再次删掉」这类回归，**不防逻辑写错**；若后续要做行为级覆盖，P2-21 应优先（可用嵌套事务 + 断言 release 语句执行次数）。

### 7.6 修复阶段三：P2-2 / P2-3（真实泄漏与竞态）

| 项 | 改动 | 测试 | 结果 |
|---|---|---|---|
| **P2-2** OAuth 引用泄漏 | `plugin/openai/codex.ts:459-478`：`stopOAuthServer()` 移入 `finally`，对齐同仓 `digitalocean.ts:306-310` 与 `snowflake-cortex.ts:477-491` 的既有写法。`provider/auth.ts:202` 证明 `callback()` 是急切调用，所以 finally 能覆盖超时 / 取消 / 供应商回传 error 三条失败出路 | `plugin/openai/codex-oauth-refs.test.ts`（1 用例，源码断言） | 先 **1 fail** → 现 **1 pass** |
| **P2-3** MCP 回调 TOCTOU | `mcp/oauth-callback.ts:105-136`：新增模块级 promise 链，`ensureRunning` 只负责串行调度、原实现改名为 `ensureRunningSerial`；链上不传播失败（否则一次授权失败会把链变成 rejected，毒化后续全部调用） | `mcp/oauth-callback-race.test.ts`（1 用例，**行为测试**） | 先 **1 fail**（`stop()` 后 `isPortInUse(PORT_A)` 仍为 true，孤儿监听器实证）→ 现 **1 pass** |

**P2-3 的测试判据为什么换成两个端口**：最初想用「同一端口并发两次」，但同端口会撞 EADDRINUSE，而 Windows 的 SO_REUSEADDR 语义允许重复绑定，判据会退化成平台相关（可能假通过）。改用**两个都能绑定成功的端口**后，修复前的形态是确定的：先建的那个 server 被后来者覆盖成孤儿，`stop()` 之后该端口仍被占用 —— 这条断言的失败本身就是缺陷的直接实证，不依赖时序运气。

**验证（真实输出）**：`bun run typecheck` **exit=0**；`bun run test` **2103 pass / 0 fail / 246 文件 / 27.81s**（较上一批基线 +2 用例、+2 文件）。

### 7.7 修复阶段四：P2-18（webapp SSE 静默失败，useEvents 部分）

| 项 | 改动 | 测试 | 结果 |
|---|---|---|---|
| **P2-18（useEvents）** | `client/useEvents.ts:20-49`：给 `global.event` 接上 `onSseError`（生成客户端每次连接失败都会调它），两处 catch 补 `console.error` 并区分「流已结束」与「初始化失败」 | `client/useEvents.test.ts` 新增「SSE 连接失败必须留痕，不得静默」 | 先 **1 fail**（`expected 'undefined' to be 'function'`）→ 现 **4/4 pass** |

**为什么这才是真凶**：生成客户端对连接失败是「回调 + 自行退避重试」，**永不把错误抛给消费者**（`serverSentEvents.gen.js:105-110`）。所以 `for await` 既不产出也不抛错，原先那两处 catch 根本不会触发 —— 界面表现为「再也不更新」而事后零线索。不接 `onSseError` 就无法观测。

**本轮三处取证更正（留档）**：
1. **webapp 不在 `bun run test` 内** —— 根 `test` 脚本带 `--path-ignore-patterns=src/webapp`，webapp 必须走 `bun run test:web`（vitest）。此前各批次的「2103 pass」**不含 webapp**；webapp 基线为 **14 文件 / 58 用例**。
2. 我曾用 PowerShell 通配符 `src\**\*.ts*` 做 grep，它**不递归**，据此误判「`sseMaxRetryAttempts` 在非生成产物中零使用」。实际先例是 `src/tui/context/sdk.tsx:94`（传 `sseMaxRetryAttempts: 0` 并自写外层重连循环）。后续 grep 一律用 `Get-ChildItem -Recurse | Select-String` 或 grep 工具。
3. 报告原举的合规范例 `useSessions.ts:30-33` **本身也是静默 catch**（只有注释）；真正的范例是 `useJobs.ts:34`（`console.error("[useJobs] …", e)`）。

### 7.8 修复阶段五：webapp 批次收口（P2-16 ~ P2-19）

| 项 | 改动 | 测试 | 结果 |
|---|---|---|---|
| **P2-18（其余 4 处）** | `useCommands.ts:37`、`useWorkspace.ts:56`（原先把「请求失败」与「服务端确实没有 location」合并成同一种表现）、`useSessionInfo.ts:44-48` 三处、`App.tsx:263` 删除会话失败 —— 一律照本目录既有范例 `useJobs.ts:34` 用 `console.error("[useXxx] …", e)` | 既有套件 | 测试输出中可直接看到新日志生效 |
| **P2-19** | `state/chatReducer.ts` 新增 `MAX_PART_TEXT = 200_000` 与 `appendDelta()`，超限保留**尾部** | `state/chatReducer.test.ts` 新增 1 用例 | 先 **1 fail**（`expected 500000 to be less than or equal to 200000`，无界累加的直接实证）→ 通过 |
| **P2-17** | `app/TerminalPanel.tsx` 新增 `[]` 依赖的卸载清理：`termRef.current?.dispose()` + 逐路 `conn.disconnect()` + `void remove(p.id)` 回收服务端 PTY；配 `ptysRef` 镜像以免把 `ptys` 写进依赖 | `app/TerminalPanel.cleanup.test.ts`（3 用例，源码断言） | 先 **2 failed** → 通过 |

**P2-17 的两个关键取舍（留档）**：
1. 清理**不能**挂在建终端的 effect 上 —— 那个 effect 依赖 `[activeID, ptys, updateSize]`，而它自身在 `:78` 会 `setPtys` 触发重跑；清理挂在它上面会在新建终端时把刚建好的终端与连接拆掉。故独立成 `[]` 依赖 + `ptysRef` 镜像。
2. 是否连带 `pty.remove` 取决于 StrictMode —— 已核实 webapp **未启用**（`src/webapp/src/main.tsx:7` 直接 `createRoot(...).render(<App />)`），无双挂载误杀，故卸载时连服务端 PTY 一起回收；只断 WS 会把服务端 shell 进程留在那儿。

**P2-16 复核结论：前提不成立（未改代码）**
报告称「`useEvents.ts:19,36-43` 只比引用相等、无代数校验，React 18 StrictMode 双挂载会 abort 刚建立的新流」。逐条推演后**无法复现**：`subscribe` 的清理先取 `buses.get(directory)`，只有 `current === bus` 才继续；StrictMode 的「挂载→卸载→挂载」序列中，卸载时 `buses.delete(directory)` 已把旧 bus 移出映射，再次挂载建的是**新** bus，旧清理因 `current !== bus` **早退**，根本碰不到新 bus 的新流。旧 bus 的 `abort()` 只作用于它自己那条已废弃连接，属正确行为。按本项目一贯的「不误报」原则，此项**降级为观察项**，保留 §7.3 的原始记录备查。

**验证（真实输出）**：`bun run test:web` **15 文件 / 63 passed / exit=0**（批次起点 14 文件 / 58 用例）；`bun run typecheck` **exit=0**；`bun run test` **2103 pass / 0 fail / 246 文件**。
**手册**：`scripts/manual_content_2.py` 的「浏览器界面构成」补三条用户可见行为（终端生命周期、输出上限、异常留痕）并重新生成 docx；`node scripts/sync-manual.mjs` 输出为空（通过）。
**知识库**：`.git/worklog-sync.log` 显示每个提交均 `entry appended` → `vault commit ok` → `vault push ok`（Obsidian vault 由 post-commit 自动同步，无需手工写入）。

**本次提交不含**：`src/cli/cmd/tui.ts`、`src/cli/upgrade.ts`、`src/tui/context/sdk.tsx`（工作区既有未提交改动，非本任务授权范围）、`err.txt` / `err2.txt`（工作区残留）。



