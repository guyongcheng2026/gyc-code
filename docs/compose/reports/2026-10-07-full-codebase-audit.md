# gyc-code 全仓审查报告（14 维度）

日期：2026-10-07　基线：HEAD `689943f`，`bun run typecheck` **0 错误**，effect `4.0.0-beta.83`
方式：6 个并行只读子代理模式化扫描 + 主代理对高危项逐条复核（引用原文）
证据级别：**[复核]** = 主代理读过源码原文确认；**[取证]** = 子代理提供 `file:line` 但主代理未逐条复核；**[待复核]** = 无法确证，需后续验证

## 零、审查方法与覆盖边界（必须先读）

**本报告不是「逐行人工通读」的产物。** 仓库约 815 个 TS 文件、宣传口径约 18 万行人工维护核心代码，单轮无法逐行读完。实际方法是：

1. 按 14 个维度的**模式清单**做全仓扫描（rg 精确匹配 + 结构特征），命中后再深读上下文；
2. 关键结论由主代理回读原文复核，**已排除 1 处子代理误报、修正 3 处事实错误、补漏 1 处清单、落地 1 处修复**（见附录 A；本轮追加复核了 P0 第 1 项）；
3. 覆盖范围：`src/{core,gyccode,cli,tui,llm,protocol,schema,codemode,ui}`；`src/webapp` 仅做存在性核对（其技术栈独立，未深审）；
4. **未覆盖**：运行时行为（本机环境把长任务自动跳过，`bun test` / 全量启动冒烟均未执行）；真实 provider 与 ACP 对端路径；webapp 前端逻辑。

## 一、并发 / 竞态 / 共享可变状态（8 种模式）

| 模式 | 结论 | 证据 |
|---|---|---|
| 1 模块级可变状态并发读写 | **有**（中） | `src/gyccode/mcp/oauth-callback.ts:9-10`（`currentPort/currentPath/server` 模块级）；`src/gyccode/gateway/weixin.ts:30` `sendGate` Map；`src/gyccode/tool/peer.ts:27` `inbox` **[取证]** |
| 2 check-then-act / TOCTOU | **有**（中） | `src/core/effect/keyed-mutex.ts:36-40`：`users--` 归零后 `locks.delete(key)` 无版本校验，旧 ensuring 可能删掉新 entry **[取证]** |
| 3 无锁读-改-写共享缓存 | **有**（中） | `src/gyccode/mcp/oauth-callback.ts:105-131` `ensureRunning` 中 `stop()` 与 `server=createServer` 之间无互斥，两个不同 redirectUri 并发会互相关掉 **[取证]** |
| 4 await/yield 后用失效引用 | 未发现 | instance-store 用 `Effect.uninterruptibleMask` 保护；pty create 用局部引用 **[取证]** |
| 5 取消后仍写状态 | **待复核** | `src/core/pty.ts:224` onData 回调在 teardown 后可能晚到，`subscribers.clear()` 疑似已防护但窗口未确证 **[待复核]** |
| 6 同一资源并发创建 | **有**（中） | 同模式 3（OAuth server）；`src/core/session/context-epoch.ts:84` `if (exists) return` 后 insert 无唯一约束证据 **[待复核]** |
| 7 Effect 语义误用 | **有**（中） | `src/gyccode/mcp/reconnect.ts:59-60` `EffectBridge.fork` 出游离 fiber，仅靠 `disposed` 标志兜底（注释自承） **[取证]** |
| 8 状态销毁后仍触发回调 | 未发现 | TUI `theme/index.ts:200-203`、`audio.ts` dispose 均有退订/清缓存 **[取证]** |

**已修复的相关项**（本轮前）：`src/gyccode/session/llm.ts` 并发 permit 覆盖流消费期；`src/tui/context/sync.tsx` 事件路径纳入会话 LRU。

## 二、错误处理缺陷（7 种模式）

| 模式 | 结论 | 证据 |
|---|---|---|
| 1 空 catch 静默吞错 | **有**（高） | **业务失败**（非诊断旁路）被吞，共 4 处：`src/cli/upgrade.ts:13-16` `Installation.latest(...)`（无法区分「无更新」与「取版本失败」，且 `latest` 是 `Effect.orDie`，schema 漂移也会静默失效）、`:56-58` `Installation.upgrade(...)`、`src/cli/cmd/tui.ts:248-250` `checkUpgrade`、`src/tui/context/sdk.tsx:101,158` `sdk.sync.start()`。**本轮已修复 sdk.tsx 两处**（改为 `logError("tui.sdk", error, { op: "sync.start" })`）**[复核]** |
| 2 catch 丢上下文 | **有**（中） | `src/llm/route/auth.ts:46,59` 主凭据加载失败无记录地切备用；`src/llm/route/executor.ts:303` **[取证]** |
| 3 失败降级为成功 | **有**（中） | `src/llm/route/executor.ts:303` `Effect.catch(() => Effect.succeed(new Uint8Array(0)))`：错误响应体读取失败被当空体 **[取证]** |
| 4 缺 finally/ensuring 清理 | **有**（低） | `src/tui/editor.ts:45-48` child 监听器未移除 **[取证]** |
| 5 无界重试 / 重试未分类 | 未发现 | `src/llm/route/executor.ts:38-40` `MAX_RETRIES=2` + 状态码白名单；`session/retry.ts:37,38` 双重上限 **[取证]** |
| 6 错误类型收窄丢失 | 未发现（受控） | `src/llm/route/timeout.ts:137` `as unknown as E` 结构已对齐 **[取证]** |
| 7 顶层异常致进程退出 | 部分 | `src/tui/app.tsx:548-553` 有 `uncaughtException/unhandledRejection`；**但** `src/gyccode/index.ts:181-208` CLI 主入口无兜底，`:213` 直接 `process.exit` **[取证]** |

> **注（本轮复核更正，原稿结论有误）**：原稿称「`catch(() => {})` 这类函数式空吞不在拦截范围」——**不准确**。`scripts/check-bug-patterns.mjs:54-72` 的规则 C 已覆盖 `.catch(() => {})` / `.catch(function(){})` 两种形态；实测 `bun scripts/check-bug-patterns.mjs src/cli/upgrade.ts src/tui/context/sdk.tsx` 返回 **0 命中、退出码 0**，原因是这几处 catch 体内**写了注释**，而规则 C 的正则 `\{\s*\}` 不匹配注释文本。该「带注释即放行」是脚本作者的**有意约定**（`:23-25`：「每一处空 catch 都必须自带『为何可忽略』的注释」），故这 4 处**并未违反检查约定**，违反的是仓库铁律中「仅两类例外可静默」的口径。
>
> **因此「把该模式纳入检查」这条建议需重新表述**：全仓 `.catch(() => {` 形态 **≥95 处**（含 `src/webapp`，搜索被截断故为下界），绝大多数自带「诊断旁路」注释且合理；直接收紧正则会把它们全部拦下（大面积误伤）。可选做法：① 对**非诊断旁路**的静默 catch 建显式白名单（列入即必须给理由），② 新增分级告警（只警告不阻断），③ 维持现状、靠评审约束。**不建议无差别收紧。**

## 三、资源泄漏（8 种模式）

| 模式 | 结论 | 证据 |
|---|---|---|
| 1 监听器无退订 | **有**（低） | `src/cli/tui/worker-pool.ts:95-134` worker `exit` 重启路径的退订仅在 idle 分支 `removeAllListeners` **[待复核]** |
| 2 定时器无清理 | **有**（中） | `src/cli/core/renderer.ts:178` `start()` 无 guard，重复调用会覆盖 interval 引用致旧定时器泄漏 **[取证]** |
| 3 句柄/流/子进程异常路径未关 | 未发现 | `pty.ts` teardown + `EXITED_LIMIT=25`；ws-pool socket terminate **[取证]** |
| 4 DB 连接/statement 未释放 | 未发现 | 单连接 + `Semaphore(1)`；Bun sqlite 驱动接管 **[取证]** |
| 5 模块级集合只增不减 | **有**（中） | `src/gyccode/tool/cron.ts:192` `sessionTasks` Map 无上限（`MAX_JOBS=50` 只约束持久化文件）；`src/core/observability/logging.ts:18` `lastRotateCheck` 无上限 **[取证]** |
| 6 未 await/未 catch 的 promise | 未发现 | `error-audit.ts:72` queueMicrotask 有 try/catch **[取证]** |
| 7 未取消的 fiber | **有**（中） | 同 §一 模式 7（reconnect 裸 fork） **[取证]** |
| 8 临时文件/锁残留 | 未发现 | `persistence.writeJsonAtomic` 失败路径 rm 临时文件 **[取证]** |

## 四、边界条件 / 逻辑错误（10 种模式）

| 模式 | 结论 | 证据 |
|---|---|---|
| 1 off-by-one | **排除**（子代理误报） | `src/tui/prompt/history.tsx:84-99`：`index` 语义为 `0=当前输入、负数=历史`，`next>0 return` 恰是阻止越过当前，`Math.abs(next)>length` 阻止越过最旧。**逻辑正确** **[复核]** |
| 2 空集合 / undefined 下标 | 未发现 | 均有守卫（`history.tsx:85-87`、`stash.pop` 等） **[取证]** |
| 3 无界递归 | 未发现 | `findUp/up/globUp` 有 `parent===current` 终止 **[取证]** |
| 4 外部输入未校验 | **有**（中） | `src/tui/editor.ts:37` `$EDITOR` 解析：未加引号的含空格路径（`C:\Program Files\...`）被 `\S+` 拆断 **[取证]** |
| 5 数值精度 / 溢出 | 未发现 | 字节计算统一 `Buffer.byteLength`；token 计数走专用适配器 **[取证]** |
| 6 字符串边界（多字节/emoji/CRLF） | **有**（低，已声明） | `src/tui/fallback/char-width.ts:93-108` emoji ZWJ 序列按单字计宽，注释已声明不处理 **[取证]** |
| 7 路径处理 | **待复核** | `src/core/fs-util.ts:273-276` `contains`：跨盘符已正确拒绝（`isAbsolute(relative(...))`），UNC 语义未测 **[待复核]** |
| 8 时区 / 时间 | 未发现 | `heap.ts:42` 用 ISO 字符串排序（含 T/Z，字典序即时间序） **[取证]** |
| 9 大小写 / Unicode 归一化 | 未发现 | shell/name 统一 `toLowerCase` **[取证]** |
| 10 恒真恒假 / 条件写反 | 未发现 | 唯一候选（history.tsx）已排除 **[复核]** |

## 五、架构完整性（7 方面）

1. **模块边界**：**有**（中）。`src/gyccode/**` 大量直接 import 内核深路径（`@gyccode/core/session/sql`、`core/session/projector`、`core/database/database` 等）。**根因已复核**：`src/core/package.json:17` 的 `"./*": "./*.ts"` 通配导出使一切深路径都"合法"，上面 6 条显式导出形同虚设 **[复核]**。代价：内核内部重构会震穿自研层——但这也是「承继内核 + 自研层免适配层」的直接代价，属**有意取舍**，改前需权衡。
2. **目录职责**：**未发现**问题。`gyccode/session`（V1 业务编排）vs `core/session`（V2 投影/存储）已在 `src/STRUCTURE.md:78` 书面消歧；`src/server` 确认已退役并入 `src/gyccode/server/shared` **[取证]**。
3. **依赖方向**：**未发现反向依赖**。`src/core` 对 `@/...`/`@core/...` 0 命中；`src/tui` 对 `@gyccode/{cli,codemode,gyccode}` 0 命中 **[取证]**。
4. **数据流**：**有**（高）。两处旁路写入已**复核确认**：
   - `src/gyccode/session/session.ts:680-704` `updatePartLive` 在 `publishLive` 之外**直接 `insert(PartTable).onConflictDoUpdate`**，注释自承「Project the part table directly」 **[复核]**；
   - `src/cli/cmd/import.ts:195-225` 直接写 `MessageTable`/`PartTable`（`onConflictDoNothing`），完全不经事件总线 **[复核]**。
   影响：`part`/`message` 表可含无事件来源的行。**待核实点**：V1 表（`message`/`part`，无 `seq`，见 `core/session/sql.ts:67-92`）与 V2 表（`session_message`，`seq NOT NULL`，`:154-171`）的**读取路径归属**决定导入会话是否会被当前读取路径看见——本轮未追 `message-v2.ts` 读取实现，**不作为结论**。
5. **门面文件**：**有**（低）。`src/gyccode/util/token.ts:1`、`src/gyccode/id/id.ts:1`、`src/core/session/{event,message,prompt,schema}.ts` 为单行 re-export 壳，与 `STRUCTURE.md:5-6`「门面对齐层已移除」自相矛盾。未发现巨型 index 过载 **[取证]**。
6. **循环依赖**：**有**（中）。`src/gyccode/plugin/index.ts:15` 静态 `import { Session } from "@/session/session"`，而 `session/{processor.ts:10,tools.ts:14,llm.ts:18,compaction.ts:11}` 与 `llm/request.ts:17` 均 `import { Plugin } from "@/plugin"` **[取证]**。Layer 初始化顺序敏感。
7. **幽灵目录**：**有**（低）。`src/gyccode/sync/` 仅含 README 无 `.ts`。**并更正既有报告**：`docs/compose/reports/2026-09-06-architecture-audit.md` 称 `src/gyccode/skills/` 为死代码平行系统——**现状已不成立**（`skill-registry.ts` 已不存在，剩余两文件有离线调用方 `scripts/archive-skills.ts:11`、`scripts/marketplace.ts:14` 及防误删注释） **[取证]**。

## 六、架构健壮性（5 检查点）

1. **异常恢复**：**部分**。中断可续链路较完整（`processor.ts:660-686` 标 `interrupted` + 补 `time.completed`；`prompt.ts:190-193` orphan-interrupted 识别与 resume，cap 8；`session_input` 表 inbox 续投递）。缺口：**崩溃（非正常中断）无启动时扫描**——`time.completed IS NULL` 的 assistant 行可能长期挂库（`core/session/projector.ts:394-410` 只在收到新事件时收敛） **[取证]**。
2. **可测试性**：**部分**。核心服务已 Effect 化（多数测试用 layer override，`runtime-flags.ts:80-87` 提供 `layer(overrides)`）。缺口：硬编码 `homedir()`（`gyccode/config/config.ts:147-155,23`、`learning/paths.ts`、`permission/index.ts` 4 处）+ 模块级单例（`gateway/weixin.ts:30`、`tool/peer.ts:27`） **[取证]**。
3. **可观测性**：**良好**（低风险）。`core/observability/log-error.ts:50,75` 统一入口，131 个文件命中 `logError|logWarn`，`error_audit` 表 + 迁移齐备；无 fields 时也会构造记录、绝不丢整条 **[取证]**。
4. **低意见配置下沉**：**部分**。`runtime-flags.ts:16-71` 将 ~45 个 `GYCCODE_*` 全部经 `Config` 声明并支持注入；`config.ts:605-610` 把 `GYCCODE_DISABLE_AUTOCOMPACT/_PRUNE` 映射进 config 树。**遗留双轨**：`src/core/flag/flag.ts:8-9,20-55` 仍直接读 `process.env`（~47 处），同一开关在两处取值（如 `GYCCODE_CLIENT`） **[取证]**。
5. **幂等性**：**未发现缺陷**。迁移 `Semaphore.makeUnsafe(1)` 串行 + `completed` Set 跳过 + `INSERT OR IGNORE`；config seed 仅在文件不存在时写；`updateGlobal` 以 `changed` 决定写盘 **[取证]**。

## 七、代码精炼度（5 类）

1. **大文件**（非 gen 非测试，行数实测）：`src/gyccode/session/prompt.ts` **2356**、`src/tui/component/prompt/index.tsx` ~1807、`tui/app.tsx` ~1958、`gyccode/session/session.ts` 1106、`session/message-v2.ts` 1070、`core/git.ts` 1002、`tool/shell.ts` 957、`tool/edit.ts` 897、`compaction.ts` 1045。职责混杂最重的是 `prompt.ts`（prompt 拼装 + 主 loop + memory 抽取 + dream + cron + subtask 同文件） **[取证]**。
2. **重复代码**：`src/core/permission.ts:76` 与 `src/gyccode/permission/index.ts:109` 两套 `evaluate()`（last-deny 优先裁决）语义相同、实现分叉；`escapeRegExp` 四处（`tool/find-references.ts:22`、`tool/edit.ts:581` 内联、`core/util/date.ts:15`、`memory/dream.ts:208`），字符类还不一致 **[取证]**。
3. **死代码**（**主代理复核确认**）：`src/gyccode/session/compaction.ts:115` `export function microcompact(...)` **全仓无任何 import**（rg 精确匹配仅命中定义、注释与配置字段名）；其配套 `Message` 接口（`:110`）与 `MICROCOMPACT_THRESHOLD`/`CACHE_PREFIX_KEEP`（`:99-100`）同为遗留——两个常量还与 `microcompact-select.ts:20-21` **重复定义**，而测试只从后者导入 **[复核]**。永久关闭的 flag 分支：未发现 **[取证]**。
4. **复杂度过高函数**：`src/codemode/tool-runtime.ts:196-320` `copyBounded`（~120 行、分支 ≥20、多重 instanceof + 递归）；`compaction.ts:718-988` `processCompaction`（~270 行、嵌套 ≥4）；`core/git.ts:431-491` `refresh`（嵌套 ≥4、分支 ≥12） **[取证]**。
5. **可简化逻辑**：删除 `compaction.ts:115-145` 死函数即可消除与 `microcompact-select.ts` 的重叠 **[复核]**。

## 八、对标差距（四大基准 + STRUCTURE.md §三）

**已实测数字（引用既有报告，本轮未重测）**：冷启动 `--version` **5871/5246/3748ms**（`2026-09-30-vs-claude-code-3metrics.md` §5.1、`2026-10-02-...-26-29.md` 指标 26）→ **超标目标 <3.5s 最多 68%**；worker 模块图求值 **~2.6s**（`src/cli/cmd/tui.ts:159-163` 注释）为主要根因。**run 全链路 <42s 与 TTFT 无实测数据**（全仓无端到端计时点，`llm-timeout.ts:51-55` 仅用于超时判定）。

| 基准 | 现状 | 差距 |
|---|---|---|
| 性能 | 冷启动超标；token 效率受「工具 schema 每轮全量下发」拖累（`llm.ts:226-235`、`registry.ts:113-129`） | 中 |
| 记忆 | 四条链路均有实现（`session/memory-summary.ts`、`memory/memory-bridge.ts:14-37`、`core/session/compaction.ts`、`memory-bridge.ts:314-341`） | 中：检索为**纯子串计数**无语义/IDF；`getProjectKey()` 用 `process.cwd()` 末段（`:20-25`）同名目录撞键；`config/compaction.ts:12` 的 `prune` 定义未生效 |
| 功能 | `src/STRUCTURE.md:68-69` 明确 `assistant/`（KAIROS 助手模式）、`buddy/`（伙伴伴随）**待建** | 部分：task 表无 `blockedBy/blocks/owner`（无法表达任务依赖） |
| 编码能力 | diff 九级 replacer（`tool/edit.ts:833-843`）+ 写后 LSP/typecheck 回灌（`edit.ts:250-259`、`core/file-mutation.ts:443-511`）已落地 | 中：`file-backup.rollback` **未注册为模型工具**；edit 未联动跑 test |

## 九、workflow 一等公民验证（plan / tdd / review / debug / verify）

共同机制：五者均为 `skill/bundled/*.md`，经 `compose/index.ts:110-128` `composeSkillsBlock()` 注入（`compose` scope 为 **hidden**），并编译期打包进 `skill/compose/bundle.gen.ts`。

| 子项 | 实现 | 模型可调 | 测试 | 文档 | 成熟度 |
|---|---|---|---|---|---|
| **plan** | ✅ `tool/plan.ts`（`plan_enter`/`plan_exit`，双确认门） | ✅ | ✅ `tool/plan-rejected.test.ts`、`agent/plan-tools.test.ts` | ✅ `skill/bundled/plan.md` | **完整** |
| **tdd** | ✅ skill 文本 | ✅ | ❌ | ✅ `tdd.md` | **部分** |
| **review** | ✅ `/review` 斜杠命令（`command/index.ts:81-90`，`subtask:true`） | ✅ | 部分（`learning/review-*.test.ts`） | ✅ `command/template/review.txt` | **部分** |
| **debug** | ✅ skill 文本 + swarm `debugger` 角色（`tool/swarm.ts:91-103`） | ✅ | ❌ | ✅ `debug.md` | **部分** |
| **verify** | ✅ skill 文本 | ✅ | ❌ | ✅ `verify.md` | **部分** |

**判定**：仅 **plan 完整**；其余四项缺**测试覆盖**与**框架级强制**（除 edit 的 typecheck 回灌外无自动触发）。**[取证]**

## 十、编码能力基准评估

| 维度 | 等级 | 证据 |
|---|---|---|
| 编码质量（diff 应用） | **强** | 九级 replacer（`edit.ts:833-843`）、多重匹配必抛错、TOCTOU mtime 校验（`:193-201`）、写前备份（`:204`）。隐患：`ContextAwareReplacer` 50% 行相似即接受（`:686-741`） |
| 类型安全 | **弱（已复核）** | `tsconfig.json:1-42` **无 `strict: true`**，仅 `noUncheckedIndexedAccess: true`（:34）+ `skipLibCheck`（:35），**无 `extends`** **[复核]**。即 `strictNullChecks`/`noImplicitAny` 等均未开——「typecheck 0 错误」的保证强度低于对标方。`any` 覆盖：`src/gyccode` 内 81+ 文件命中（重灾 `provider.ts` 22、`public.ts` 16、`mcp/standard-elements.ts` 11） **[取证]** |
| 代码精洁度 | **中** | 生成代码走既有抽象（edit → `FileMutation`/`Snapshot`/`Format`/`LSP`）；但 `file-mutation.ts:519-523` 注释自承 `transaction` 整体回滚仍是 TODO；swarm 并发写无文件锁 |
| 工具设计 | **中上** | 参数失败回灌完整 JSON Schema（`tool/tool.ts:112-122`）、`<tool_error>` 信封（`:154-204`）；但 `tool.ts:204` 外层仍 `orDie`，可预期错误（文件不存在/git 冲突）变成 defect，模型拿不到纠正说明 **[取证]** |

## 十一、性能基准（冷启动 / run 全链路 / 体积 / 初始化）

- **冷启动**：`--version` 路径**主代理实测 329ms**（`gyc`）、402ms（`bun run dev`）——**这是参数解析路径，不含 TUI worker 启动**，不可与既有报告的 3.7–5.9s 混用；TUI 全量启动未在本轮实测 **[复核]**。
- **体积**：`dist/` 实测 **26.1MB**（`index.js` 11.0MB + `worker.js` 7.2MB + `photon_rs_bg` 1.8MB + tree-sitter wasm 5 个合计 ~4.8MB） **[复核]**。注意该 dist 为先前构建产物，未在本次重跑 `bun run build`。
- **初始化开销**：`src/gyccode/effect/app-runtime.ts:59-62` 注释「AppLayer 包含 43 个服务，冷启动时全量实例化」；`CoreLayer`(~18) / `HeavyLayer`(~31) / `AppLayer`(~49 项) 三套清单并存，`:120` 留有 TODO「run 命令应仅加载 CoreLayer」 **[复核]**。
- **启动期重量级工作**：worker 模块图求值 ~2.6s（`cli/cmd/tui.ts:159-163`）、config 并行化（`:203-206`）、升级检查延后 1s + unref（`:246-249`）、worker 内存 <1536MB 时跳过预热（`cli/tui/worker.ts:225-236`） **[取证]**。
- **回归防线缺口**：CI 不测性能/体积（`.github/workflows/ci.yml` 仅 typecheck/mojibake/bug-patterns/brand/build/test） **[取证]**。

## 十二、记忆基准

见 §八「记忆」行。补充实现位置：会话记忆 `session/memory-summary.ts`；跨会话持久化 `memory/memory-bridge.ts:14-37,145-187`（项目隔离路径 + 原子写 + 文件锁 + FIFO 200 条）；上下文管理 `core/session/compaction.ts` + `session/{context-epoch,history,message-updater}.ts`；检索 `memory-bridge.ts:314-341` + 注入 `session/system.ts:177-191`（LRU 缓存）。**最大缺口：检索为纯子串计数**，无语义/IDF 加权，与 `core/filesystem/search-relevance.ts` 已有 trigram 相关度未复用 **[取证]**。

## 十三、可测试性检查

- **可单测（正面）**：`overflow.ts`（`usable`/`calculateTokenWarningState`）、`message-v2.toModelMessages`、`prompt-shard.hashShard`、`compaction.{pivotTail,buildMemorySummary}`、`microcompact-select.*` 均有直接纯函数单测；权限裁决用 `Layer.succeed(EventV2Bridge.Service, stub)` 隔离（`permission/index.test.ts:25-26`） **[取证]**。
- **难单测（缺口）**：`session/tools.ts:116-146` 内置工具执行闭包硬绑 `input.processor/session/agent/model`，无注入点；`session/prompt.ts` 主 loop 无单测入口，仅靠 `cli-integration.test.ts` 真起子进程验 `--version/--help` **[取证]**。
- **全局耦合点**：`makeGlobalNode`/`InstanceState`、模块级单例（`weixin.ts:30`、`peer.ts:27`）、硬编码 homedir 4 处 **[取证]**。
- **测试形态**：gyccode 下 122+ 个 `*.test.ts` 全为 `bun:test`；vitest 仅 `src/webapp`；依赖真实网络的测试无（webfetch 用本地 http server，browser-smoke 无 Chrome 则 skip） **[取证]**。

## 十四、可观测性检查

- **高缺口**：`session/tools.ts:116-146` 内置工具执行路径**无 `withSpan`、无失败 `logError`**；对比 MCP 路径 `:425` 有 `withSpan("Tool.execute", {...})` **[取证]**。
- **中**：`codemode/tool-runtime.ts:760-777` 工具失败仅回调 hook 不落日志；`compaction.ts:494` 用 `Effect.logError`（不进 `error_audit` 表）；`compaction.ts:656,706` 关键决策日志（tail fallback / pruning found）**缺 `session.id`**，无法按会话聚合 **[取证]**。
- **字段化覆盖**：`log-error.ts:40-47` 支持 `session.id`，但多数调用点未带（正例：`processor.ts:689`、`prompt.ts:1407`、`tools.ts:429`） **[取证]**。
- **Span 覆盖**：全仓仅 18 个文件用 `withSpan`，session 主 loop / compaction / permission 裁决均无 span，OTel 链路在核心编排层中断 **[取证]**。
- **低**：`compaction.ts:412-448` token 计数适配器失败被 `estimate` 静默降级（`:603`），API 计数长期失败不可见 **[取证]**。

## 附录 A：复核记录（主代理亲自读原文的项）

| 结论 | 项 | 处置 |
|---|---|---|
| **排除误报** | `src/tui/prompt/history.tsx:84-99` 历史导航「方向 1 恒被禁用 / off-by-one」 | 子代理误报。`index` 语义为 0=当前、负数=历史；`next>0 return` 是阻止越过当前，`Math.abs(next)>length` 阻止越过最旧，**逻辑正确** |
| **修正事实** | 子代理称「`import.ts` 导入的 message 缺 `seq` 与 V2 排序不兼容」 | **不成立**：`import.ts` 写的是 V1 `message`/`part` 表，二者**无 `seq` 字段**（`core/session/sql.ts:67-92`）；`seq` 属 V2 `session_message`（`:154-171`）。真正的待核实点是 V1/V2 读取路径归属 |
| **确认** | `tsconfig.json` 未开 `strict` | 已读全文确认（无 `extends`） |
| **确认** | `core/package.json:17` 通配导出 `"./*": "./*.ts"` | 已读全文确认 |
| **确认** | `session.ts:680-704` / `import.ts:195-225` 旁路写入 | 已读原文确认（前者有注释自承） |
| **确认** | `compaction.ts:115` `microcompact` 死代码 + 常量重复 | rg 精确匹配确认无 import |
| **确认** | dist 26.1MB；`gyc --version` 329ms | 命令实测 |
| **修正事实** | 原稿称「`check-bug-patterns.mjs` 拦不到 `catch(() => {})`」 | **不成立**：规则 C 已覆盖该形态（`scripts/check-bug-patterns.mjs:54-72`）；实测两文件 **0 命中**是因为 catch 体内**含注释**，而「带注释放行」是 `:23-25` 的**有意约定**。故这 4 处违反的是铁律口径，不是检查脚本漏检 |
| **补漏** | §二 模式 1 原列 3 处，实为 **4 处** | 漏记 `src/cli/upgrade.ts:56-58`、`src/cli/cmd/tui.ts:248-250`，已回填 |
| **已修复** | `src/tui/context/sdk.tsx:101,158` 两处业务路径静默空 catch | 改为 `logError("tui.sdk", error, { op: "sync.start" })`（文件内既有同类写法，不新增依赖） |

## 附录 B：优先级汇总（建议处置顺序）

**P0（真实缺陷 / 高影响）**
1. **业务路径静默空 catch，共 4 处**（违反铁律，非检查脚本漏检，见 §二 注）：`src/cli/upgrade.ts:13-16`、`:56-58`、`src/cli/cmd/tui.ts:248-250`、`src/tui/context/sdk.tsx:101,158`。
   - **已完成**：`sdk.tsx` 两处改为 `logError("tui.sdk", error, { op: "sync.start" })`（工作区同步是功能路径，失败必须留痕）。
   - **待决**：`upgrade.ts` 两处 + `cli/cmd/tui.ts:248` 属**启动期自动更新检查**——改为 `logWarn` 后，离线/被墙环境下每次启动都会多一行 `console.warn`（用户可见噪声），而当前实现是「静默降级、下次启动重试」。**需谷总在「可观测」与「启动静默」之间定调**；若选留痕，建议同时评估 TUI 已接管终端时写 `console.warn` 是否污染画面。
2. `tsconfig.json` 未开 `strict`：类型安全基准低于对标方；建议分批开启（先 `strictNullChecks` + `noImplicitAny`，隔离协议生成物）。
3. 数据流旁路写入（`session.ts:680-704`、`import.ts:195-225`）：先核实 V1/V2 读取路径归属，再决定是否收敛为投影器接口。

**P1（能力/健壮性缺口）**
4. `tool/tool.ts:204` 外层 `orDie`：可预期错误变 defect，模型拿不到纠正说明。
5. 内置工具执行路径缺 span + 失败日志（`session/tools.ts:116-146`）。
6. 崩溃后无「未完成 assistant 消息」启动扫描（`projector.ts:394-410`）。
7. 冷启动超标（3.7–5.9s vs <3.5s）：拆 worker 首帧依赖图；补 TTFT 与 run 全链路埋点（当前**无实测数据**，不可对标）。
8. workflow 五项中四项缺测试与框架级强制（tdd/review/debug/verify）。

**P2（精炼/一致性）**
9. 删 `compaction.ts:115-145` 死函数与其重复常量。
10. 权限 `evaluate()` 双实现收敛；`escapeRegExp` 四处统一。
11. `plugin/index.ts:15` ↔ `session/*` 静态循环依赖：改为注入式回调。
12. `core/flag/flag.ts` 与 `runtime-flags.ts` 双轨收敛。
13. `renderer.ts:178` `start()` 加 guard；`cron.ts:192` `sessionTasks` 加上限。
14. `src/gyccode/sync/` 幽灵目录清理；单行 re-export 壳与 `STRUCTURE.md` 口径对齐。
