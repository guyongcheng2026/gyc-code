# Agent 自主性 / 工程工作流 / 可靠性与安全 对标：指标 12~25

> **采集时间**：2026-10-02
> **被审对象**：`D:\00MyAI\gyc-code`，HEAD `0f296a6`，工作区除 1 个未跟踪文档外干净
> **对标基准**：Claude Code **v2.1.286**（本机实装，`claude --version` 实测；较主报告基线 v2.1.285 已自动升级）
> **方法**：只读取证。gyc-code 侧每条结论均亲自读源码并附 `file:line`；CC 侧只写本机实际核实到的内容，其余标注「未核实」
> **上游材料**：[2026-09-30-vs-claude-code-3metrics.md](./2026-09-30-vs-claude-code-3metrics.md)（指标 ①~③、6~11）、[2026-10-01-vs-claude-code-tools.md](./2026-10-01-vs-claude-code-tools.md)（指标 6~11 详审）

---

## 〇、本轮的方法说明与两处口径声明

### 0.1 指标编号映射（务必先读）

任务书按三个维度给出 **17 个能力主题**，但编号范围 `12–25` 只有 **14 个号**（自主性 12–16 = 5、工程 17–21 = 5、可靠性 22–25 = 4）。三个维度各差 1，需做 3 处合并。本轮**保留任务书给定的三个维度边界不变**，合并如下：

| 编号 | 指标 | 覆盖的任务书主题 |
|---|---|---|
| 12 | 任务分解与规划 | 任务分解与规划 |
| 13 | 工具选择准确率 | 工具选择准确率 |
| 14 | 自主纠错与重试 | 自主纠错与重试 |
| 15 | 主动澄清与提问 | 主动澄清与提问 |
| 16 | 并行/子代理调度 **与** 长任务的目标漂移控制 | 并行/子代理调度 + 长任务的目标漂移控制 |
| 17 | 计划-执行-验证闭环 | 计划-执行-验证闭环 |
| 18 | 测试驱动 **与** 代码审查 | 测试驱动 + 代码审查 |
| 19 | 提交 / PR 流程 | 提交/PR 流程 |
| 20 | CI 与迁移 | CI 与迁移 |
| 21 | 多步重构的原子性与可回滚 | 多步重构的原子性与可回滚 |
| 22 | 权限与沙箱边界（**含危险操作确认**） | 权限与沙箱边界 + 危险操作确认 |
| 23 | 密钥与隐私处理 | 密钥与隐私处理 |
| 24 | 崩溃 / 异常恢复 | 崩溃/异常恢复 |
| 25 | 可观测性 | 可观测性 |

> **合并理由**：16 的两项同答「多步长任务如何不失控」；18 的两项同属「交付前质量门禁」；22 的两项在 gyc 源码里本就是同一条代码路径（`permission/modes.ts` + `tool/shell/security.ts` + `permission/index.ts`），拆开写会重复。

### 0.2 CC 侧基准变化（必须更正主报告）

| 项 | 主报告记录 | 本轮实测 | 影响 |
|---|---|---|---|
| 版本 | v2.1.285 | **v2.1.286** | 升级 |
| commit | `afb212976052` | **`f344a08993bb`** | 升级 |
| 安装路径 | `C:\Program Files\nodejs\node_modules\...` | **`C:\Users\Administrator\AppData\Roaming\npm\node_modules\...`** | 安装方式变了 |
| 工具清单 | 43 个 schema | **43 个 schema，逐项一致** | **无变化** |

**已确认**：v2.1.286 的 `sdk-tools.d.ts` 与主报告附录 B 记录的 v2.1.285 **字节数完全相同（169,648 字节 / 4,170 行）**，`ToolInputSchemas` 联合类型逐项比对无增删 —— 本轮所有 CC 侧工具面结论**沿用主报告口径仍然成立**。

**本机环境异常（非对标问题，备记）**：`claude doctor` 报 `Invalid settings — C:\Users\Administrator\.claude\settings.json: modelOverrides.deepseek-ai/deepseek-v4-flash-0731: Expected string, but received object`。这是本机 CC 配置写法与 CC 内部 schema 不匹配，与 gyc-code 无关，但**说明本机 CC 无法以默认配置跑通**，是下文多条 CC 能力「未核实」的直接原因。

### 0.3 三个取证类别的标注约定

- **【已确认】** —— 本轮亲自 `Read`/`Select-String` 读过源码或实跑过命令，附 `file:line`
- **【推断】** —— 由已确认事实合理推出，但未直接观测到该行为
- **【未核实】** —— CC 侧无法在本机验证（本机未登录鉴权 + v2.1.286 为原生二进制、无 JS 源码可反编译），**不作为判定依据**

---

## 一、总览：14 项档位判定

| 指标 | CC 表现 | gyc 判定 | 一句话差距/亮点 |
|------|---------|----------|------------------|
| **12. 任务分解与规划** | 强：plan 审批门 + 任务依赖图 | 🟡 中上 | 双确认门控设计好，**但任务无依赖图**、plan 不校验是否真实现 |
| **13. 工具选择准确率** | 强 | 🟡 中上 | `tool_search` + code-mode 渐进披露，**但兜底路径会泄漏全量工具清单** |
| **14. 自主纠错与重试** | 强：`permission_denials` 遥测 | 🟡 中上 | 重试退避策略**比 CC 更细**，**但工具 execute 失败仍 orDie** |
| **15. 主动澄清与提问** | 强：`AskUserQuestion` | 🟡 中上 | 能力对等，**安全默认更保守**（非 Yes 即拒绝） |
| **16. 并行/子代理调度 + 目标漂移** | 强 | 🟢 **强（局部超越）** | `swarm`/`peer` CC 无；**S-01 已修复**（主 agent 200 步上限） |
| **17. 计划-执行-验证闭环** | 强 | 🔴 **弱** | **S-03 仍未修复**：全仓零自动 typecheck 回路 |
| **18. 测试驱动 + 代码审查** | 强：`ReportFindings` | 🟡 中上 | `/review` 提示词质量高，**但 pre-commit 门禁 AI 触发不到** |
| **19. 提交 / PR 流程** | 强：自动 commit | 🟡 中上 | git 六件套 + 影子仓库任务历史，**但 push/PR 创建仍要 bash gh** |
| **20. CI 与迁移** | 中 | 🟡 中上 | 有 4 条 workflow + 迁移体系，**但 AI 对 CI 状态零感知** |
| **21. 多步重构原子性与可回滚** | 强 | 🟢 **强** | 文件级备份 + 影子仓库回退 + 会话 revert 三层，**CC 无文件级备份** |
| **22. 权限与沙箱边界** | 强：6 模式 + `--restricted` | 🔴 **弱（含 1 项 P0 架构缺陷）** | **两套模式系统互不相连**、无沙箱 |
| **23. 密钥与隐私处理** | 中 | 🟠 偏弱 | 导出有脱敏，**但模型可把 `.env` 原样读进上下文** |
| **24. 崩溃 / 异常恢复** | 强：结构化 `terminal_reason` | 🟠 偏弱 | 重试/后台任务健全，**但大量 `orDie` 把可预期错误变 defect** |
| **25. 可观测性** | 强：JSON 全量遥测 | 🟠 偏弱 | 统一日志入口已建（140 处），**但只写 stdout，不落盘不关联** |

**整体判定**：**自主性维度（12–16）是 gyc 最强的一块，其中 16 已在子代理编排上局部超越 CC**；**工程工作流维度（17–21）呈现「工具齐、闭环缺」** —— 提交、审查、备份的工具都在，但没有一条把它们串起来的自动回路；**可靠性与安全维度（22–25）是最短板**，其中 22 存在一项比「有没有模式枚举」严重得多的架构缺陷（见 §22.4）。

---

## 二、Agent 自主性（指标 12~16）

### 2.1 指标 12 · 任务分解与规划 🟡 中上

#### 规范定义

> 系统能否把一个模糊目标拆成**有序、可执行、可判完成**的子任务，并在跨越「研究 → 实施」阶段时设置**强制审批门**，使未经用户确认的方案不得直接落地为代码改动。

#### gyc-code 取证

**计划模式是双确认门控设计**（`src/gyccode/tool/plan.ts`）：

- `plan.ts:15-76` `PlanEnterTool`（`plan_enter`）：模型调用后**先问用户**「是否切换到 plan agent」（`plan.ts:27-41`）
- `plan.ts:43` —— `if (answers[0]?.[0] !== "Yes") yield* new Question.RejectedError()`：**只有显式回答 "Yes" 才切换**，取消/关闭对话框/无答案一律拒绝
- `plan.ts:78-144` `PlanExitTool`（`plan_exit`）：切回 build 前**再问一次**（`plan.ts:93-107`），`plan.ts:111` 同样「非 Yes 即拒绝」
- `plan.ts:50-66` / `plan.ts:118-134`：切换通过**新发一条 user 消息 + synthetic part** 实现，而非改全局状态 —— 切换点在会话历史里留痕，可审计

> **对比 CC**：`EnterPlanModeInput` / `ExitPlanModeInput` 确实存在于 v2.1.286 的 43 个 schema 中（已确认），但**其审批门的具体交互与拦截强度未核实**（本机无法鉴权运行）。**gyc 的「双门 + 非 Yes 即拒绝」是本轮确认到的、比 CC schema 形状更严格的机制**，但这属于「gyc 已确认 / CC 未核实」的对比，不能直接宣称超越。

**任务分解落盘**：

- `plan.ts:92` `const plan = path.relative(instance.worktree, Session.plan(info, instance))` —— 计划是一个**真实文件**
- `src/gyccode/session/reminders.ts:98-116`：进入 plan agent 时注入 `PLAN_MODE` 提示，**区分「计划文件已存在」与「不存在」两种文案**（`reminders.ts:109-113`），前者引导增量编辑而非重写
- `reminders.ts:57-77`：非实验分支下，plan→build 切换时注入 `BUILD_SWITCH`（`reminders.ts:68-77`）

**子任务列表（`todowrite`）有一处值得肯定的运行时反馈**（`src/gyccode/tool/todo.ts`）：

```
todo.ts:16   const VERIFY_REMINDER_CLOSED_THRESHOLD = 3
todo.ts:17   const VERIFY_HINT = /verify|verification|run tests|run test|test suite|check that|validate|验证|测试/i
todo.ts:24-31 buildTodoOutput()
```

`todo.ts:27-29`：本轮**一次性关闭 ≥3 个 todo**、且整个列表（新增 + 旧）**都不含任何验证/测试字样**时，自动追加一句「考虑跑一次验证步骤再宣布完成」。`todo.ts:26` 同时检查 `input.next` 与 `input.prev`，避免模型把已有的验证项删掉后绕过提醒。

> 这是**全仓唯一的「完成后自检」运行时干预**（另见 §17 的缺口）——它不是闭环，只是闭环缺失时的一块补丁。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **任务无依赖图** | `task` 表 `src/core/session/task-table.ts:8-24` 只有 `status`/`error`/`cost`/token 列，**无 `blockedBy`/`blocks`/`owner`** | CC 的 `TaskUpdateInput`（主报告 §5.1 已确认）带 `addBlocks[]`/`addBlockedBy[]`/`owner`。gyc 的任务无法表达「B 必须等 A 完成」 |
| **`plan_exit` 不校验计划是否真被实现** | `plan.ts:88-141` 全程只做「问用户」，**不读 plan 文件、不核对 todo 完成度** | 模型跳步、计划与实现脱节都不会被拦 |
| **plan 文件是纯文本，无结构化 schema** | `plan.ts:92` 仅取路径；`Session.plan()` 返回路径字符串 | 无法对计划做机器可判的「完成/未完成」校验，只能靠模型自觉 |
| `todowrite` 每次都要授权 | `todo.ts:42-47` `ctx.ask({ permission: "todowrite", patterns: ["*"], always: ["*"] })` | 纯记账动作也走权限询问，长任务里是纯摩擦 |

### 2.2 指标 13 · 工具选择准确率 🟡 中上

#### 规范定义

> 工具数量膨胀时，模型能否**只看到该看的**、并在找不到时**不靠瞎猜**；工��描述与参数 schema 能否让模型一次写对。

#### gyc-code 取证

**工具规模**：`src/gyccode/tool/registry.ts:278-322` 共注册 **44 个工具 + 1 个条件工具（`codeModeTool`，`:322`）+ 1 个 `tool_search`（`:331`）**。含 `gitStatus/gitDiff/gitLog/gitCommit/gitBranch/gitStash`（`registry.ts:306-311`）、`findReferences`（`:300`）、`describeImage`（`:281`）、`bashBackground`（`:280`）、`peerSend/peerRead`（`:319-320`）。

**运行时搜工具**（`src/gyccode/tool/toolsearch.ts`）：

```
toolsearch.ts:25-34   query 以 "select:" 开头 -> 精确直选，逗号分隔，顺序保真、未命中静默丢弃
toolsearch.ts:36-53   否则按关键词打分：tool.id 命中 +3（:44），整个 id+description 命中 +1（:45）
toolsearch.ts:49-51   过滤 score>0、降序、取前 max_results（默认 5）
```

`toolsearch.ts:8` 的参数描述明确告知模型两种用法（`select:<tool_name>` 直选 / 关键词搜索）。

**code-mode 渐进披露**（`src/gyccode/tool/code-mode.ts`）：把 MCP 工具变成一段受限编排脚本的编程接口，而非逐个塞进工具列表。

```
code-mode.ts:25   const CODE_MODE_TIMEOUT_MS = 10 * 60 * 1000
code-mode.ts:26   const CODE_MODE_MAX_TOOL_CALLS = 500
code-mode.ts:27   const CODE_MODE_MAX_OUTPUT_BYTES = 1024 * 1024
code-mode.ts:71   describeCatalog()
code-mode.ts:52-69 groupByServer()  按 server 名分组，剥掉 server 前缀（:58），子串最长优先（:53）
```

**参数 schema 就地回灌**：`src/gyccode/tool/tool.ts:112-122` `invalidArgumentsDetail()` 在参数校验失败时，把该工具的**完整 JSON Schema 一并拼进错误消息**（`tool.ts:120`）。`tool.ts:106-111` 的注释写明了动机：「只回一句『请重写』的话，模型并不知道期望结构，只能反复瞎试」。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **`tool_search` 兜底路径泄漏全量清单** | `toolsearch.ts:71-73`：`matches.length === 0` 时输出 `No matching tools found. Available tools (${total}): ${tools.map(...).join(", ")}` | **渐进披露在此完全失效** —— 一次搜不到就把全部 44 个 id 倒给模型，正是渐进披露要避免的事。且没有提示「换个词试试」 |
| `tool_search` 排序是朴素关键词计数 | `toolsearch.ts:39-50` 纯 `includes` 打分，无语义、无 IDF | 「搜索」与「查找」两个词权重完全相同；跨工具描述撞词时排序失真 |
| `code-mode` 只覆盖 MCP 工具 | `code-mode.ts:6` `import { McpCatalog } from "@/mcp/catalog"` | **本地 44 个工具不在 code-mode 目录内**，仍全部平铺进上下文 |
| 无「工具选择」的可观测数据 | 全仓无「模型选了哪个工具 / 选错后是否纠正」的埋点 | 指标 13 目前**无法测量**，只能靠设计推断 |

> **诚实标注**：指标 13 在 gyc 侧**同样缺测量能力**（与主报告 §0 的整体判定一致）。上面的 🟡 是对设计质量的判定，不是对准确率的测量结论。

### 2.3 指标 14 · 自主纠错与重试 🟡 中上

#### 规范定义

> 系统在遇到可恢复错误时，能否**自动重试且不空转**，并在把错误交还模型时**给出足以自我纠正的信息**而不是一个崩溃。

#### gyc-code 取证

**LLM 层重试策略是本仓最完整的一段**（`src/gyccode/session/retry.ts`）：

```
retry.ts:29-38   RETRY_INITIAL_DELAY=2s / BACKOFF_FACTOR=2 / MAX_DELAY_NO_HEADERS=30s
                 MAX_DELAY_WITH_HEADERS=60s / RETRY_ABANDON_AFTER_MS=300s
                 RETRY_TOTAL_CAP_MS=120s / MAX_RETRY_ATTEMPTS=5
retry.ts:52-90   delay()：优先解析 retry-after-ms（:56-63）→ retry-after 秒（:65-73）
                 → HTTP-date（:75-79）→ 指数退避兜底（:82-89）
retry.ts:60,71   retry-after > 300s 直接放弃（return undefined），不空转
retry.ts:94      上下文溢出错误**明确不重试**（ContextOverflowError 直接返回 undefined）
retry.ts:99-105  5xx 即使 SDK 未标记 isRetryable 也重试
retry.ts:106-152 FreeUsageLimitError / GoUsageLimitError 归类为 fatal:true + 结构化 action
retry.ts:206,209 MAX_RETRY_ATTEMPTS 与 RETRY_TOTAL_CAP_MS 双重硬顶
retry.ts:217     fatal 或 wait===undefined -> Cause.done，立即让错误浮出
```

`retry.ts:32-37` 的注释记录了一个真实教训：「gyccode 等免费模型会在 429 时返回 retry-after（如 46666 秒 ≈ 13 小时），若不设上限会让 run 挂死数小时」—— **这是被线上问题教育出来的设计，比 CC 的公开描述更细**。

**工具层错误回灌（P2-6，本轮已确认生效）**：

```
tool.ts:154-169  decode(args) 失败 -> InvalidArgumentsError -> Effect.catch -> 转成成功结果
tool.ts:178-181  输出格式：<tool_error kind="invalid_arguments" tool="..."> + 原因 + schema + 修正指引
tool.ts:156      注释明写：不能经 orDie 升级成进程级 defect——那会中断整轮
```

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **`Tool.execute` 外层仍有 `orDie`** | `tool.ts:204` `.pipe(Effect.orDie, Effect.withSpan(...))` | P2-6 只修了**参数解码**这一路。`execute` 内部抛出的任何可预期错误（文件不存在、git 冲突、LSP 未就绪）**仍然是进程级 defect**，模型看不到可纠正的说明 |
| **拒绝事件不落库** | `permission/index.ts:107,126-130` 拒绝只 `events.publish` 到内存事件总线；全仓无 `permission_denials` 表 | CC 有结构化 `permission_denials` 遥测（主报告 §5.2 已确认）。gyc 的「被拒了多少次 / 哪些命令反复被拒」**不可统计**，指标 14 缺一半数据 |
| `retry.ts:170-174` `actionFor()` 无消费方 | 全仓仅在 `retry.ts` 内定义并导出 | 终态限流的升级提示设计完整，但**没有调用方**（与 §16 的 `bumpReact` 同类问题） |

### 2.4 指标 15 · 主动澄清与提问 🟡 中上

#### 规范定义

> 信息不足时，系统能否**主动停下来问**，且在用户不答/取消时**安全地停在原地**而不是继续瞎猜。

#### gyc-code 取证

- `src/gyccode/tool/question.ts:14-44` `question` 工具：`question.ts:6-8` 参数是 `Schema.Array(Question.Prompt)`，**支持一次问多个**
- `question.ts:30-32` 回灌格式 `"问题"="答案"`；**未答的显式标注 `"Unanswered"`**（`:31`）而不是静默填空
- `question.ts:36` 明确告诉模型「You can now continue with the user's answers in mind」
- **安全默认是拒绝**：`plan.ts:43` 与 `plan.ts:111` —— 只有字面量 `"Yes"` 才放行，其余（取消/关闭/空）全部 `RejectedError`。注释 `plan.ts:109-110` 写明：「取消/关闭对话框/无答案时默认拒绝（留在 plan agent）」
- `src/gyccode/tool/brief.ts` 提供主动通知通道（已注册 `registry.ts:317`）

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **未答不阻断** | `question.ts:31` 把 `Unanswered` 当作答案的一部分回灌，`question.ts:24-28` 不检查是否全答 | 与 `plan.ts:43/111` 的保守策略**不一致**：同一个代码库里，plan 切换拒绝继续，question 缺答也继续。模型可能拿着 `"Unanswered"` 继续往下做 |
| 无「该问而没问」的检测 | 全仓无「信息不足」判据 | 指标 15 的准确率**不可测量**；`brief` 是模型主动调用，不是系统检测 |
| 提问无成本约束 | `question.ts:24-28` 无频率/次数上限 | 长任务里反复弹窗阻塞 run |

### 2.5 指标 16 · 并行/子代理调度 与 长任务的目标漂移控制 🟢 强（局部超越）

> 这是本轮**唯一判为 🟢 的自主性指标**，且包含一处对主报告旧结论的实质更正。

#### 规范定义

> 能否把工作**并发**分派给子代理并聚合结果，同时保证主循环在长任务中**有硬上限、有停滞检测、有独立目标裁决**。

#### A. 并行与子代理调度

**`swarm` 是 CC 没有的能力**（`src/gyccode/tool/swarm.ts`）：

```
swarm.ts:22-31   描述明确：不给 teammates 就按 goal 自动组队
                 debug/fix -> debugger + explorer；explore/understand -> explorer；否则 implementer + reviewer
swarm.ts:59-64   deriveRolesForGoal()（关键词匹配，与描述一致）
swarm.ts:52-57   ROLE_AGENT 角色到内置 subagent 类型的映射
swarm.ts:148-220 runTeammate()：每个 teammate 是独立 subagent 会话
swarm.ts:222-239 Effect.forEach(..., { concurrency: "unbounded" })  <- 并行执行
swarm.ts:226-237 每个 teammate 的失败被 catchCause 兜住，转成 success:false 的结构化结果，不中断整队
swarm.ts:241,271 summarizeTeammateResults() 聚合
swarm.ts:243-256 ctx.metadata() 上报 strategy / per-role success / stepsCompleted
```

**子代理权限收敛**（这是安全侧的加分项）：`swarm.ts:161-195` 对每个 teammate 会话计算 `deriveSubagentSessionPermission`，并在 `swarm.ts:165-180` **强制 deny `todowrite` / `task` / `swarm`**（除非子代理自己声明了对应权限），外加 `cfg.experimental?.primary_tools` 全量 deny。

**深度限制与后台开关**：

```
task.ts:104-114   沿 parentID 向上遍历数深度，depth >= (cfg.subagent_depth ?? 1) 即拒绝
swarm.ts:94-105   同逻辑
task.ts:97-102    后台子代理需 GYCCODE_EXPERIMENTAL_BACKGROUND_SUBAGENTS=true，否则直接 Error
```

**任务态可观测**（`src/gyccode/tool/task-manage.ts`）：`task-manage.ts:42-56` `task_list` / `:58-68` `task_get` / `:70-84` `task_stop`，底层是共享 background job 注册表（`task-manage.ts:19-23`），已注册 `registry.ts:290-292`。描述里明确写「枚举、检查、停止任务，而不是靠猜它们的状态」（`task-manage.ts:6-10` 注释）。

**跨会话通信（CC 完全没有）**：`src/gyccode/tool/peer.ts:70` `peer_send` / `:103` `peer_read`，`registry.ts:319-320`。

#### B. 长任务的目标漂移控制

**⚠️ 对主报告 S-01 的更正 —— 已修复**：

```
prompt.ts:111-112  /** 主 agent 默认步数上限（默认），0 表示不限制。子代理另有 20 步的更紧上限。 */
                   const MAX_STEPS = 200
prompt.ts:109-110  const SUBAGENT_MAX_STEPS = 20
prompt.ts:1680-1681 // 主 agent 此前默认 Infinity：漂移的循环既不会停，也无上限地烧 token。
prompt.ts:1682     const configuredMaxSteps = (yield* config.get()).llm?.max_steps ?? MAX_STEPS
prompt.ts:1683-1685 maxSteps = agent.steps ?? (agent.mode === "subagent" ? SUBAGENT_MAX_STEPS
                                                         : configuredMaxSteps === 0 ? Infinity : configuredMaxSteps)
```

**主报告 §S-01「主 agent 无步数上限」已不成立**。当前默认 200 步，配置 `llm.max_steps = 0` 可显式恢复为不限制。

**停滞守卫**（`src/gyccode/session/tool-stall.ts` + `prompt.ts`）：

```
tool-stall.ts:1-3  文件头注释：只有「纯工具调用轮 + 无可见文本 +（工具失败 或 与历史完全重复）」才计空转
tool-stall.ts:41-50 isStalledToolOnlyStep()：finish 必须 === "tool-calls"（:42）
                    有可见文本直接 return false（:43-44）
                    hasFailure（任一工具未 completed，:47）|| allRepeat（签名全在历史里，:48-49）
tool-stall.ts:23-31 stableStringify() 键排序稳定序列化，保证同参同签名
prompt.ts:114       MAX_CONSECUTIVE_TOOL_ONLY_STEPS = 10
prompt.ts:116       TOOL_REPEAT_HISTORY_ROUNDS = 20
prompt.ts:1901-1909 stallLimit 可配 + 签名比对 + 连续计数
prompt.ts:1911-1923 触顶 -> 写 NamedError.Unknown + updateMessage + publish Error + return "break"
```

**这是本仓写得最认真的一处防漂移设计** —— `tool-stall.ts:1-3` 的注释记录了它为什么被重写：「原实现只检查『无文本』，会误杀 Compose/DeepSeek 等工具轮不带 text 的模型」。**这类「为修误杀而收窄判定」的历史，比判定本身更能说明成熟度。**

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **`swarm` 并发无上限** | `swarm.ts:238` `{ concurrency: "unbounded" }` | 模型显式给 20 个 teammate 就是 20 个并发子会话同时烧 token。**无全局并发闸、无预算闸**（对照 CC 有 `--max-budget-usd`，主报告 §5.2 已确认） |
| **停滞守卫只拦「完全空转」** | `tool-stall.ts:43-44` 有可见文本即 return false | 「改一点→跑一次→再改一点」且每轮都有解释文字的漂移，**守卫不触发**（主报告 §S-01 修复说明里已预判此点） |
| **`bumpReact` 无消费方 → 目标漂移无强制收敛** | 见 §16.4 专节 | **P0 级** |
| 无「子代理预算」概念 | `swarm.ts:210` `stepsCompleted` 只统计、不限制 | 无法回答「这队人花了多少 / 该不该继续」 |

#### 16.4 `bumpReact` 核实结论（本轮专项核实）

**【已确认】`bumpReact` 在生产代码中零消费方。**

```
src/gyccode/session/goal.ts:111     interface GoalService 声明
src/gyccode/session/goal.ts:153-159 实现（react + 1，写回 store）
src/gyccode/session/goal.test.ts:33,36,37   仅测试引用
```

全仓（排除 `node_modules`，含 `.ts`/`.tsx`）检索 `bumpReact` 共 **5 处命中：定义 2 处 + 测试 3 处，无任何业务调用**。

同时确认判官链路的实际接线：

```
prompt.ts:1929-1936
  if (goal.get(sessionID)) {
    yield* Effect.promise(() => goal.evaluate({ sessionID })).pipe(
      Effect.ignore,      // <- 判官抛错一律忽略
      Effect.forkIn(scope), // <- 异步，不等待
    )
  }
  if (outcome === "break") break
```

`goal.evaluate()` 在 `prompt.ts:1932-1935` 被 **fork 到后台且 `Effect.ignore` 吞掉全部错误**，其返回值**没有任何代码读取**，`break` 判定（`prompt.ts:1937`）只依赖 `outcome`。`goal.ts:181-185` 仅在裁决变化时 publish 事件供 UI 显示。

**结论**：目标判官是**纯建议性/展示性的**，裁决 `ok: true` **不会终止主循环**，模型可以无限期继续工作。`GoalState.react` 字段（`goal.ts:29-30`，注释「Number of judge-driven re-entries so far; bounded by MAX_GOAL_REACT」）描述的「判官驱动的重新进入」机制**根本不存在** —— `MAX_GOAL_REACT` 这个常量在全仓**没有定义**。

> 这与主报告 §5.5 的更正条目方向一致但结论相反：主报告已指出 `GAP-08-23 L65`「gyc 无反思复盘循环」是错的（判官存在）。**本轮进一步确认：判官存在但不闭环** —— 这是比「有没有」更细一层的结论。

### 2.6 自主性维度小结

- **16 判为 🟢**：`swarm`（并行团队）+ `peer_send/peer_read`（跨会话）+ `task_list/get/stop` + S-01 修复后的 200 步硬上限 + 停滞守卫，**在子代理编排这一项上 CC v2.1.286 没有对应物**（`swarm`/`peer`/`task_manage` 三个工具名均不在 CC 的 43 个 schema 中，**已确认**）
- **唯一 P0 是 `bumpReact`**：判官不收敛 → 目标漂移只有「步数上限 + 空转守卫」两道被动防线，没有主动的目标达成判定
- **12~15 都是 🟡**，短板不在能力有无，在**缺测量**（13、15 无埋点）与**策略不一致**（15 的 `question` 不学 `plan` 的保守默认）

---

## 三、工程工作流（指标 17~21）

### 3.1 指标 17 · 计划-执行-验证闭环 🔴 弱

#### 规范定义

> 改动落地后，系统能否**自动**触发验证（编译 / 测试 / lint）并把失败作为**可纠正的结构化诊断**回灌给模型，形成 plan → act → verify → fix 的闭环。

#### gyc-code 取证

**【已确认】全仓不存在自动验证回路。**

以 `tsc --noEmit` / `typecheck` / `autoVerify` / `verifyAfterEdit` 检索 `src/`（排除 `node_modules`）全部命中，**只有 2 处，且都不是运行时回路**：

```
src/gyccode/tool/todo.ts:28       只是 VERIFY 提醒文案里的英文单词 "verification"
src/gyccode/skill/compose/bundle.gen.ts:8   技能包里的提示词文本
```

主报告 §S-03 判定的「框架层零自动验证回路」**至今未修复，仍是 P0**。

**唯一的运行时干预是提示层软约束 + 一条事后提醒**：

```
src/gyccode/session/prompt/default.txt:56-57   「你必须跑 lint / typecheck」（提示词，非框架）
todo.ts:16,24-31                              关闭 ≥3 项 todo 且无验证项时追加提醒
```

**「TS 类型检查能跑」这件事目前只挂在两处，都够不着模型**：

- `.githooks/pre-commit:19-24`：`src/` 下有 TS 改动时执行 `bun x tsc --noEmit -p tsconfig.json`，**失败即 `exit 1` 阻断提交**
- 但 pre-commit 只在**人工 `git commit`** 时触发；模型的 `git_commit` 工具走的是影子仓库任务历史，**不经过 `.git/hooks`**

#### 缺口与改进动作

| 缺口 | 证据 | 改进动作 | 优先级 | 工作量 |
|---|---|---|---|---|
| **零自动验证回路（S-03）** | 全仓检索无命中 | 在 edit/write/patch 批次结束后，对受影响的 TS 文件跑 `tsc --noEmit`，把诊断作为**结构化工具结果回灌**（复用已建好的 `tool.ts:178-181` 的 `<tool_error>` 信封格式），并禁止模型在 tsc 未通过时宣布完成 | **P0** | 1.5~2 人日 |
| **pre-commit 门禁 AI 触发不到** | `.githooks/pre-commit:7-24` 五道门禁只在人工 `git commit` 触发 | 给 `git_commit` 工具增加一个 `run_hooks` 选项（或在影子仓库上等价执行 mojibake / brand-guard / bug-patterns / tsc 四检），让模型提交前自检 | **P1** | 1 人日 |
| `default.txt` 软约束只覆盖 `default` 模型 | 7 个 provider 提示文件里「必须跑 lint/typecheck」的措辞是否齐备**本轮未逐一核对** | 把验证要求提到框架层（上一行），从而不依赖任何单个提示词 | P1 | 含在上一行 |

> **⚠️ 这是本轮唯一一个 🔴。** 工具链（17、18、19、21）都有，**唯独把「改完 → 验一下」这一步做成自动的那一环缺失**。主报告 §S-03 列为 P0 是准确的，**至今未动**。

---

### 3.2 指标 18 · 测试驱动 与 代码审查 🟡 中上

#### 规范定义

> 交付前的质量门禁是否具备：**先写测试再改实现**的驱动力，以及**对改动本身的独立审查**能力。

#### gyc-code 取证

**代码审查提示词质量高**（`src/core/plugin/command/review.txt`，已确认存在并读完全文）：

| 段落 | 内容 |
|---|---|
| 输入形态判定 | 无参数→`git diff` / `git diff --cached` / `git status --short`；commit hash→`git show`；分支名→`git diff <branch>...HEAD`；PR→`gh pr view` + `gh pr diff` |
| 上下文要求 | 「Diffs alone are not enough」—— 要求读完被改文件的**全文**，并主动读 `CONVENTIONS.md` / `AGENTS.md` / `.editorconfig` |
| 检查维度 | Bugs（主）/ Structure / Performance（仅限明显问题）/ Behavior Changes |
| 自我约束 | 「**If you're uncertain and can't verify this with these tools, say "I'm not sure about X" rather than flagging it as a definite issue**」 |

> 这份提示词的**反幻觉条款与主报告 §H-01 关注的 `gpt-astra.txt` 缺失项同源但方向相反** —— 这里写得很好，问题在于它是**单个斜杠命令的提示词，不是框架机制**。

同源副本：`src/gyccode/command/template/review.txt`。

**技能沉淀链有代码有测试**（`src/gyccode/learning/`，14 个文件）：

```
review-prompt.ts:1-4   纯函数模块，不做 I/O、不读时钟，提示词四段硬约束是契约，改动需同步单测
review-prompt.test.ts / review-fixes.test.ts   对应单测已存在
ledger.ts / lifecycle.ts / skill-store.ts / trigger.ts / runner.ts / usage.ts / paths.ts   各带 .test.ts
```

**质量门禁脚本齐备**（`.githooks/pre-commit`，已确认 5 道）：

```
pre-commit:7   check-mojibake.mjs --staged       UTF-8/GBK 乱码阻断
pre-commit:9   brand-guard.mjs                   品牌合规
pre-commit:11  check-workspace-junk.mjs           .gitignore 曾忽略 *.bak/*.orig 的历史兜底
pre-commit:13-16 check-bug-patterns.mjs          只查暂存的 TS/TSX
pre-commit:19-24 bun x tsc --noEmit -p tsconfig.json  src/ 改动时的类型门禁，失败 exit 1
```

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **门禁 AI 触发不到** | `.githooks/pre-commit` 只在人工 `git commit` 时执行；模型的 `git_commit` 走影子仓库 | 与 §17 同源。**模型可以在 tsc 编译不过的情况下生成一整个 commit** |
| **无「先写测试」驱动力** | 全仓无 TDD 相关提示或门禁 | 「测试驱动」在本仓的体现是 `learning/` 的**技能单测**（对提示词函数测），**不是对被改业务代码测**。二者不可混为一谈 |
| 审查只能走斜杠命令 | `review.txt` 是 command template，模型要自己敲 bash 跑 `git diff` 再自己判断 | 无「把 diff 结构化喂给 reviewer 子代理」的工具。CC 有独立的 `ReportFindings`（v2.1.286 schema 已确认） |
| 无「谁审的」记录 | 无审查结果落库表 | 审查质量不可度量 |

> **诚实标注**：CC `ReportFindings` 的**实际行为**（结构、是否触发后续修复、是否落库）**未核实**。这里只能确认「工具存在」，不能比较能力深度。

### 3.3 指标 19 · 提交 / PR 流程 🟡 中上

#### 规范定义

> 模型能否不经过 shell 拼字符串地完成 status → diff → commit 全链路，提交历史是否**可追溯、可回退**，以及是否有 PR 侧的闭环。

#### gyc-code 取证

**git 六件套已就位**（主报告 §P0-1，HEAD 已含）：

```
registry.ts:306-311   gitStatus / gitDiff / gitLog / gitCommit / gitBranch / gitStash
src/gyccode/tool/git.ts   16.6KB，6 个工具
src/gyccode/tool/git-guard.test.ts / git.test.ts   有测试
```

**影子仓库任务历史已实现**（主报告 §P0-2）：

```
src/gyccode/snapshot/index.ts:53     注释：建 commit 后影子仓库就有历史，revertToCommit 能按轮次回退
snapshot/index.ts:61   history: (limit) => { hash, message, time }[]
snapshot/index.ts:63   revertToCommit: (hash) => void
snapshot/index.ts:657  history 实现
snapshot/index.ts:681  revertToCommit 实现
snapshot/index.ts:935  返回 { ..., commit, history, revertToCommit }
snapshot/index.ts:967-971  InstanceState 包装
```

**关键设计（比 CC 更谨慎）**：影子仓库**不碰 HEAD、不碰分支指针**，任务历史与用户真实仓库物理隔离。这是主报告 §4.3 P0-2 的验收要求，本轮确认已落地。

**PR 侧有人工入口**：`src/cli/cmd/pr.ts:9` `command: "pr <number>"`，内部走 `gh pr checkout`（`pr.ts:28-30`）、支持 cross-repo fork 远端自动添加（`pr.ts:53-64`）。另有 `src/cli/cmd/github.ts`。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **无 push / PR 创建工具** | `registry.ts:306-311` 只有 6 个 git 工具，无 push / PR | 创建 PR 仍要 `bash` 敲 `gh pr create`，模型得自己拼正文与引号 |
| **`pr.ts` 是人用 CLI，不是模型工具** | `pr.ts:9` 定义在 `cli/cmd/`，未进 `tool/registry.ts` | 模型不能主动「检出 PR 并接手工作」 |
| commit message 无 AI 侧质控 | `.githooks/pre-commit` 触发不到 | 见 §17/§18 |
| `git_diff` 默认口径未取证 | 本轮未读 `git.ts` 内部实现 | 是否默认含未暂存改动、是否受 2K 截断影响，**未核实** |

### 3.4 指标 20 · CI 与迁移 🟡 中上

#### 规范定义

> 数据库/配置变更是否**有版本化、可重复、可审计**的迁移路径；CI 状态是否对 agent 可见。

#### gyc-code 取证

**CI 存在**（`.github/workflows/`，已确认 4 个文件）：

```
ci.yml
deploy-pages.yml
publish.yml
security.yml
```

**质量脚本已成体系**（`scripts/`，从 pre-commit 引用可确认）：

```
check-mojibake.mjs    brand-guard.mjs    check-workspace-junk.mjs    check-bug-patterns.mjs
install-hooks.mjs     apply-opentui-*.cjs (postinstall 补丁)    build.mjs
```

`package.json` scripts 已确认：`test`（`bun test --preload ./scripts/bun-solid-preload.ts`）、`typecheck`（`tsc --noEmit -p tsconfig.json`）、`build`（`bun build.mjs`）。

**迁移体系有证据**：`src/core/session/task-table.ts:1-7` 的注释直接说明了双写约束 ——

```
task-table.ts:2   task 表建表语句（2026-09-30 每任务真实成本 P0 / C-01）
task-table.ts:4-6 抽成常量是因为它有两个消费方：全新库的初始建表（schema.gen.ts）
                   与增量迁移（database/migration/20261001000000_task.ts）
task-table.ts:6   此前 workflow_run 的两处是各写一份字符串，日后改列就会漏
task-table.ts:26-34 C-05 给已建过 task 表的库补 start_cost，同样要双写；
                   SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，
                   重复执行会报错，因此由迁移系统保证只跑一次
```

> 这段注释本身就是证据：**建表与迁移必须同源、且迁移只跑一次** —— 这是主报告 §5.5 更正过的「gyc 缺流程编排」在工程侧的正确形态。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **AI 对 CI 状态零感知** | `.github/workflows/` 不进模型上下文，无 `gh run` 工具 | 「CI 红了 → 定位失败用例 → 修」是 CC 式工作流的闭环，gyc **无法自动发起** |
| 无迁移状态自检 | 未取证迁移是否有「当前 schema 版本」表 | **未核实**，不作为结论 |
| `security.yml` 内容未读 | 本轮未打开 | 是否有 SAST / 依赖漏洞扫描，**未核实** |

### 3.5 指标 21 · 多步重构的原子性与可回滚 🟢 强

#### 规范定义

> 连续多文件改动出错时，能否**按文件粒度**回退到改动前的状态，且回退入口可被发现。

#### gyc-code 取证

**三层回滚，各管一段**：

```
第 1 层 · 文件级写前备份（主报告 P1-4，本轮确认已实现）
  src/gyccode/tool/file-backup.ts:31   const DEFAULT_KEEP = 20
  file-backup.ts:34    DEFAULT_ROOT = Global.Path.data/backup
  file-backup.ts:36-44 BackupEntry 接口
  file-backup.ts:17    独立目录 backup/<projectID>/<hash(worktree)>，不复用会话级快照
  file-backup.ts:92    列表按 .bak / .absent 双后缀识别
                      .absent = 改动前该文件不存在（删除操作的备份），这是易漏的一环
  file-backup.ts:112   backup(file, options)
  file-backup.ts:148   list(file, options)
  file-backup.ts:157   rollback(file, options)
  覆盖 write / edit / apply_patch / notebook_edit（主报告 §0 已列）

第 2 层 · 影子仓库按任务回退
  snapshot/index.ts:657  history(limit)
  snapshot/index.ts:681  revertToCommit(hash)

第 3 层 · 会话消息级回退
  src/gyccode/session/revert.ts:37-87   revert()：定位回退点、收集 patch 列表、
                                       snap.track/restore/revert（:69-71）、
                                       diff 回填（:72）、summary.computeDiff（:74）、
                                       落 storage（:75）+ publish Event.Diff（:76）
  revert.ts:89-97    unrevert()：还原快照并 clearRevert（:94-95）
  revert.ts:99-133   cleanup()：真正删消息/删 part
  revert.ts:38,91    两处 state.assertNotBusy —— 运行中不许回退
```

**`revert.ts` 的三段式设计很干净**：先在 UI 层「标记回退点 + 生成 diff 预览」（`:37-87`，不删任何数据），用户确认后再 `cleanup`（`:99-133`）真正删除。这是**两阶段确认**，不是直接销毁。

#### 判定

**🟢 强，且部分优于 CC。** 主报告 §4.2 已确认 CC 无文件级写前备份（其 diff 只服务审批）。gyc 的 `.bak`/`.absent` 双标记设计覆盖了「删除操作也要能恢复」这个常见漏洞。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **备份是按文件独立快照，非事务** | `file-backup.ts:112` 单文件粒度 | 多文件重构中途失败，只能逐个回滚，**没有「整批回滚」** |
| `swarm` 并发写无文件锁 | `swarm.ts:238` `concurrency: "unbounded"` + `file-backup.ts:112` 无 CAS | 两个 teammate 同改一个文件时，备份链会互相覆盖，**回滚结果不可预测** |
| `rollback` 无工具暴露 | `file-backup.ts:157` 导出了 `rollback`，但 `registry.ts:278-331` **未注册为模型工具** | **模型自己不能用备份回滚** —— 只能提示用户去操作。这是主报告 Action Items 里「评估写前备份回滚入口」那条，**本轮确认入口尚未落地** |

---

## 四、可靠性与安全（指标 22~25）

### 4.1 指标 22 · 权限与沙箱边界（含危险操作确认） 🔴 弱 —— **含一项 P0 级架构缺陷**

#### 规范定义

> ① 操作能否被模式化的权限系统统一裁决；② 进程级是否有沙箱围栏；③ 危险操作是否默认拒绝而非默认放行。

#### A. 已经做到的部分（【已确认】）

**权限裁决是完整的三态机**（`src/gyccode/permission/index.ts`）：

```
permission/index.ts:30-40   evaluate(permission, pattern, ...rulesets)：findLast 命中 Wildcard，
                            未命中返回 { action: "ask", pattern: "*" }（默认问，不是默认允许）
permission/index.ts:72-115  ask()：遍历 patterns
                            :80-84  rule.action === "deny" -> 立即 DeniedError（不等用户）
                            :85     rule.action === "allow" -> continue
                            :86     其余 -> needsAsk = true
                            :89     全部 allow 才直接放行
                            :103-114 Deferred.make + 挂入 pending + publish Asked + await
permission/index.ts:57-65   finalizer：实例销毁时所有 pending 以 RejectedError 失败（不留悬挂）
permission/index.ts:117-192 reply()：
                            :132-138 reject + message -> CorrectedError(feedback)  <-- 带纠正反馈
                            :140-154 同一会话的其他 pending 一并拒绝（防止绕过）
                            :159     reply === "once" -> 不进 approved
                            :162-171 always[] 转成 allow 规则，RefModule.modify 原子更新
                            :174-191 级联放行同会话中已满足的 pending
permission/index.ts:230-240 disabled()：edit/write/apply_patch 归并为 "edit" 权限，
                            read 类归并为 "read"，命中 deny "*" 的工具直接**从注册表移除**
```

**「默认问、显式 deny、纠正反馈、拒绝即级联」四点齐全，机制设计是扎实的。**

**拒绝风暴保护**（`src/gyccode/permission/classifier.ts:2-19`）：`DenialTracker` 记录同一 key 的拒绝次数，`MAX_DENIALS = 3`，`shouldBlock()` 在第 3 次后返回 true。

**危险命令分级已实现**（`src/gyccode/tool/shell/security.ts`）：

```
security.ts:9-24    DANGEROUS_PATTERNS 共 14 类：commandSubstitution / processSubstitution /
                    evalExec / curlPipeBash / wgetPipeBash / devTcp / rmRfRoot / chmod777 /
                    sudo / redirectAppend / ddIf / mkfs / forkBomb / exportEnv
security.ts:32-50   deescape()：单引号外剥离反斜杠转义，使 e\val、c\u\r\l | b\ash 无法绕过启发式
security.ts:52-55   classifyCommand 对【原始命令 + 去转义命令】双向匹配
security.ts:65-67   blocked：rmRfRoot / forkBomb / devTcp / mkfs
security.ts:69-72   dangerous：evalExec / curlPipeBash / wgetPipeBash / sudo / ddIf
security.ts:73      其余命中 -> warning
```

执行侧（`src/gyccode/tool/shell.ts:841-846`）：

```
shell.ts:841-843   classification.level === "blocked" -> Effect.die(new ShellBlockedError(...))
shell.ts:844-846   level === "dangerous" && params.allowDangerous !== true -> Effect.die(ShellDangerousError)
```

**主报告 §4.2 指标 7 判定的「危险命令只提示不拦截」已修复**（主报告 §P0-3），且 `security.ts` 的模式表从主报告记录的 4 类 blocked 扩展到 **14 类含反逃逸**。

#### B. 🚨 P0 级架构缺陷：两套互不相连的权限模式系统

**【已确认】以下三项检索结果（全仓，排除 `node_modules`，含 `.ts`/`.tsx`）：**

```
检索词 resolveAction：
  src/gyccode/permission/modes.ts:9      定义
  src/gyccode/permission/index.ts:249     转出导出
  —— 全仓仅此 2 处，无任何调用方

检索词 from ".*permission/modes" / from "./modes"：
  src/gyccode/permission/index.ts:249     仅 index.ts 自己的转出
  —— 没有任何其他文件 import 它
```

即：`src/gyccode/permission/modes.ts` 定义的整套模式语义，**在生产路径上从未被执行过**。

该文件内容（已确认全文 19 行）：

```ts
// modes.ts:3
export const PermissionMode = Schema.Literals(["default", "acceptEdits", "bypassPermissions", "plan"])
// modes.ts:9-19
export function resolveAction(dangerLevel, mode): PermissionAction {
  if (mode === "bypassPermissions") return "allow"
  if (mode === "plan") return dangerLevel === "blocked" ? "deny" : "deny"
  if (dangerLevel === "blocked") return "deny"
  if (dangerLevel === "dangerous") return "ask"
  if (dangerLevel === "warning") return mode === "acceptEdits" ? "allow" : "ask"
  return "allow"
}
```

**与之并存的第二套系统**（`src/tui/context/permission.tsx`，已确认全文 26 行）：

```tsx
// permission.tsx:5
export type PermissionMode = "auto" | "normal"
// permission.tsx:10-13
const args = useArgs()
const [store, setStore] = createStore<{ mode: PermissionMode }>({
  mode: args.auto ? "auto" : "normal",
})
// permission.tsx:21-23
toggle() { setStore("mode", (mode) => (mode === "auto" ? "normal" : "auto")) }
```

**结论（比「有没有模式枚举」严重得多）**：

| 事实 | 后果 |
|---|---|
| `modes.ts` 的 4 模式 + `resolveAction` 是**死代码** | 「acceptEdits 模式自动允许 edit」「plan 模式拒绝一切」这些语义**在运行时不存在** |
| TUI 另有一套 `"auto" \| "normal"`，由 CLI `--auto` 初始化 | 这套模式**与 permission 服务无连接**，本轮**未能确认** `mode === "auto"` 时是否有任何代码改变 `Permission.ask` 的裁决 |
| shell 路径实际走的是 `classifyCommand` + `Effect.die` | 危险命令判定**根本没经过 `resolveAction`**，`bypassPermissions` 想放行 blocked 也放行不了（因为 `shell.ts:842` 无条件 die）—— **这套设计的「可配置」部分完全不生效** |

> **判定依据**：以上全部来自本轮亲自 `Select-String` 的全仓检索与文件全文读取，标注 **【已确认】**。
> **【推断】**：`permission.tsx` 的 `"auto"` 大概率只影响 TUI 的展示与交互节奏（如自动批准弹窗），**不改变 `Permission.ask` 的裁决逻辑** —— 但本轮**未逐行读完 TUI 的消费方**，故标为推断，不作为结论。

#### C. 其他缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **无沙箱** | 全仓无容器 / 命名空间 / 权限降级 / seccomp 代码 | CC 的沙箱是核心安全边界，gyc **完全依赖用户点确认**（与主报告 §4.2 指标 7 判定一致，本轮复核仍成立） |
| 危险命令拒绝用 `Effect.die` | `shell.ts:842,845` | 与 P2-6 是**同一个反模式**：一次拒绝 = 一个进程级 defect。模型拿不到「该怎么做」的说明，也不会走正常重试通道（详见 §24） |
| 模式数 4 vs CC 的 6 | `modes.ts:3` vs 主报告 §5.4 | CC：`acceptEdits`/`auto`/`bypassPermissions`/`manual`/`dontAsk`/`plan`。gyc 缺 **`dontAsk`（无人值守时一律拒绝而非挂起）** 与 `manual` |
| 无 `--restricted` 类围栏 | 主报告 §5.4 已确认 CC 有 `--restricted`（剥离执行类工具 + 文件工具限制在工作目录内 + 拒绝 bypassPermissions） | gyc 的 `disabled()`（`permission/index.ts:230-240`）只能按 `deny + pattern:"*"` 整类禁用，**无法表达「文件工具限定在工作目录内」这类围栏** |

#### 改进动作

| # | 事项 | 验收标准 | 优先级 | 工作量 |
|---|---|---|---|---|
| **A-1** | **打通模式系统：删除或接线 `modes.ts`** | 二选一 ——（a）让 `Permission.ask` 接收 `PermissionMode` 并真正调用 `resolveAction`，TUI 的 `"auto"/"normal"` 改为映射到 `modes.ts` 的 4 模式；（b）删掉 `modes.ts` 与 `permission.tsx` 的重复类型，只留一套。无论选哪条，**必须有一个端到端测试断言 `acceptEdits` 模式下 edit 不弹窗** | **P0** | 1 人日 |
| **A-2** | `ShellBlockedError` / `ShellDangerousError` 改 `Effect.fail` 或走工具结果通道 | 用危险命令调用 bash，断言返回可读诊断（含命中的 pattern 与放行方式）而非 defect；参照已完成的 `tool.ts:157-188` | **P0** | 0.5 人日 |
| **A-3** | 补 `dontAsk` 模式 | 设置为该模式时，`Permission.ask` 对未命中 allow 的请求直接 `RejectedError`，不挂 Deferred；对照 CC `--permission-prompts none` | P1 | 0.5 人日 |
| **A-4** | 工作目录围栏 | `Permission.ask` 的 patterns 对文件工具追加「路径必须在 worktree 内」的规则，越界即 deny | P1 | 1 人日 |
| **A-5** | 危险操作确认**落库** | 新增 `permission_denials` 表，记录 `permission`/`pattern`/`sessionID`/时间，供「哪些命令反复被拒」统计（CC 已有同名遥测，主报告 §5.2 已确认） | P1 | 0.5 人日 |

### 4.2 指标 23 · 密钥与隐私处理 🟠 偏弱

#### 规范定义

> 凭据是否会泄漏进模型上下文、会话记录或导出产物。

#### gyc-code 取证

**导出侧脱敏是真做了**（`src/cli/cmd/export.ts`）：

```
export.ts:16-17   redact(kind, id, value)：非空 -> `[redacted:${kind}:${id}]`，空值原样返回
export.ts:20-22   对象分支：非空 -> { redacted: `${kind}:${id}` }
export.ts:28-35   file part：text / file / patch 三字段
export.ts:45-69   symbol part：path / name / clientName / uri / url / filename
export.ts:79-95   text / reasoning / subtask 的 prompt / description / command
export.ts:106-112 tool part 的 raw / title
```

覆盖面是**逐字段枚举**的，不是一刀切的字符串替换 —— 这个做法比正则黑名单可靠。

**凭据独立于消息存储**：`src/gyccode/auth/index.ts:52` `Auth.Service` / `:118` `auth/node.ts` 走 `Credential` 依赖，密钥不进入 session part。

**SSRF 防护完整**（`src/gyccode/tool/webfetch.ts:25-67`，主报告 §2.2 已逐条确认，本轮未重新取证，沿用）。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **脱敏只在导出时，运行时不管** | `export.ts:16-22` 是导出路径的函数；`tool/read.ts` 无任何 secret 检测 | **模型 `read('.env')` 会把凭据原样读进上下文**，进入会话历史、可压缩、可被 `read_cache` 复用 |
| 无 `.env` / 凭据文件的默认屏蔽 | `registry.ts:278-331` 无相关开关；`webfetch.ts:25-67` 的 SSRF 规则不覆盖本地文件读取 | 与「webfetch 防内网」形成反差：**出网有围栏，入盘没有** |
| 脱敏清单需手工维护 | `export.ts:28-112` 是逐字段手写 | 新增 part 类型时容易漏 |
| 凭据存储位置与加密方式 | **本轮未核实** | 不作结论 |

> **【已确认】** 以上缺口均可从「`read` 无 secret 检测」+「脱敏函数只在 export 路径」两点推出；具体某次会话是否真的读进了 `.env`，**本轮未观测**，不作结论。

### 4.3 指标 24 · 崩溃 / 异常恢复 🟠 偏弱

#### 规范定义

> 单个工具失败、子代理失败、进程崩溃后，系统能否**局部恢复**而不是整轮中断；长任务能否**断点续跑**。

#### gyc-code 取证

**做得好的部分**：

```
LLM 层退避重试          retry.ts:198-230（见 §2.3）
子代理失败不中断整队     swarm.ts:226-237 catchCause -> 结构化 success:false
子代理失败可查询         task-manage.ts:42-84 task_list/get/stop
进程级恢复              src/gyccode/tool/bash-background.ts
  bash-background.ts:7      action: status | kill | list 三态
  bash-background.ts:41-57  list：id / status / ISO 时间 / 命令
  bash-background.ts:69-83  kill：区分 unknown（已回收）与已结束两种失败原因
  bash-background.ts:85-121 status：取尾部 maxBytes 字节 + 退出码 + 信号
  bash-background.ts:99-102 状态文案区分 running / exited(exit code N, signal X)
判官异常不阻塞           prompt.ts:1933 Effect.ignore
压缩连续失败有保护       prompt.ts:1879 consecutiveCompactionFailures >= MAX_CONSECUTIVE_COMPACTION_FAILURES
中断有收尾              prompt.ts:1927 Effect.onInterrupt(finalizeInterruptedAssistant)
```

**`bash_background` 的失败文案区分「找不到（可能已因会话结束或超出保留上限被回收）」与「已经结束，无需终止」**（`bash-background.ts:73-77`）—— 这种区分说明设计时考虑过资源回收，不是简单报个错。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **`orDie` / `Effect.die` 密集** | 见下方清单 | 可预期的错误被升级为进程级 defect，**整轮中断** |
| **无断点续跑** | 全仓无 checkpoint 机制；对照 CC 的 `WorkflowInput.resumeFromRunId`（主报告 §5.3 已确认，含 `(prompt, opts)` 键的结果级缓存） | 长任务失败后**从零重烧 token**。这是 ③ 每任务成本的直接放大器 |
| 后台任务回收上限未取证 | `bash-background.ts:75` 提到「超出保留上限被回收」，但上限值与回收时机**未核实** | 长会话中后台任务可能被静默回收 |
| 崩溃后无会话自愈报告 | `prompt.ts:1917-1921` 停滞触顶时写 `NamedError.Unknown` —— 信息量偏低 | 用户只看到「重复工具调用没有可见进展」，不知道是哪几个工具在重复 |

#### `orDie` 清单（本轮逐个确认）

```
src/gyccode/tool/tool.ts:204          Tool.execute 外层 —— 影响所有工具
src/gyccode/tool/shell.ts:842         ShellBlockedError
src/gyccode/tool/shell.ts:845         ShellDangerousError
src/gyccode/tool/swarm.ts:280         SwarmTool.execute
src/gyccode/tool/toolsearch.ts:83     ToolSearchTool
src/gyccode/tool/plan.ts:73           PlanEnterTool
src/gyccode/tool/plan.ts:141          PlanExitTool
src/gyccode/tool/question.ts:41       QuestionTool
```

**主报告 §P2-6 只处理了 `tool.ts` 的参数解码一路**（`tool.ts:157-188`），**`tool.ts:204` 这层壳与其余 7 处仍未处理**。这 8 处里最要紧的是 `plan.ts:73` / `plan.ts:141`：**用户点「取消」会走 `Question.RejectedError`**，若该路径 die，**用户正常取消操作会变成崩溃**。

> **【推断】** `Question.RejectedError` 在 `question.ask` 的正常实现里应被工具层捕获转成工具结果（`question.ts:24-28` 未显式 catch，但 `plan.ts:43` 用 `yield* new Question.RejectedError()` 抛出后被 `:73` 的 `orDie` 接住）—— 即**「取消即崩溃」很可能是真实缺陷**。但本轮**未运行验证**，标为推断。

### 4.4 指标 25 · 可观测性 🟠 偏弱

#### 规范定义

> 出了错能不能被检索、被聚合、被关联到具体会话与步骤。

#### gyc-code 取证

**统一日志入口已建立且覆盖面很高**：

```
src/core/observability/log-error.ts:1-7   文件头注释记录了动机：原先手写
                                          console.error(`[tag] ... ${String(e)}`) 约 70 处，
                                          格式与字段各不相同：没有 sessionID/traceId 时，
                                          线上根本无法按会话聚合排查「某次请求为什么失败」
log-error.ts:9-10   format()：Error 取 stack，否则 String()
log-error.ts:13-19  logError(scope, error, fields?)
log-error.ts:22-28  logWarn(scope, message, fields?)  用于降级/重试这类非致命路径
```

**【已确认】覆盖面统计**（全仓，排除 `node_modules`）：

| 项 | 数量 |
|---|---|
| `logError(` 调用点 | **140** |
| `logWarn(` 调用点 | **26** |
| 残留 `console.error(` / `console.warn(` | **12** |

残留 12 处分布（已确认）：

```
5  src/core/observability/log-error.ts    <- 实现自身，合理
2  src/webapp/src/client/useFileTree.ts
1  src/webapp/src/client/useChatSession.ts
1  src/webapp/src/client/useJobs.ts
1  src/cli/cmd/task.ts
1  src/gyccode/skill/compose/bundle.gen.ts   <- 生成物，合理
1  src/llm/route/transport/websocket.ts     <- 唯一一处非 webapp 的残留
```

**Effect 原生日志用得对**：`goal.ts:240-243` `Effect.logInfo("Goal.judge", { condition, messageCount })`；`prompt.ts:1912-1916` stall guard 写 `Effect.logWarning("stall guard triggered", { "session.id", messageID, consecutive })` —— **带 session.id 结构化字段**。`permission/index.ts:79,101` 同样带结构化字段。

**成本/用量侧可观测**（主报告 §3.2 已确认，本轮沿用）：`dialog-cost.tsx:86-105` 的真缓存命中率、`stats` CLI、`gyc task list`（`task-table.ts` / `task-projector.ts:55,91,128,136,155,162`）。

#### 缺口

| 缺口 | 证据 | 影响 |
|---|---|---|
| **日志不落盘、不入 DB** | `log-error.ts:15,18` 只 `console.error`；`:24,27` 只 `console.warn` | **关掉终端就没了**。跨会话、跨天的故障排查无法进行 |
| **无 traceId / sessionId 索引** | `log-error.ts:13` 的 `fields` 是可选的 `Record<string, unknown>`，**没有强制字段** | `log-error.ts:3-6` 的注释把这个问题**写清楚了，但没有解决** —— 140 个调用点里有多少真的传了 `sessionID`？**本轮未统计，不作结论** |
| **无终止原因遥测** | 主报告 §5.2 已确认 CC 有 `terminal_reason`/`stop_reason`/`is_error`/`subtype`/`num_turns`/`duration_ms`；gyc 侧**无对应物** | 「任务为什么停了」只能靠读会话记录推断 |
| **无子代理归集遥测** | 主报告 §C-02 已确认；本轮补充：`swarm.ts:243-256` 与 `:261-270` 把 strategy/per-role success/stepsCompleted 写进了 tool metadata，**但没有 session 维度的聚合计数** | 有了明细，缺了统计 |
| webapp 4 处未走统一入口 | `useFileTree.ts`(2) / `useChatSession.ts`(1) / `useJobs.ts`(1) | 前端错误不进统一日志管道 |

> **判定为 🟠 的理由**：埋点**广度**已经很够（140 处统一入口 + Effect 结构化日志），但**深度为零** —— 没有落盘、没有 traceId、没有终止原因。**「错误被记录」不等于「错误可被检索」。**

---

## 五、改进计划汇总

> 编号规则：`A-n` = Agent 自主性，`W-n` = 工程工作流，`R-n` = 可靠性与安全。**与主报告 §4.3 的 P0-1/P1-1/P2-1 编号体系相互独立**。

### 5.1 P0 · 阻断级（4 条）

| # | 指标 | 事项 | 验收标准 | 工作量 |
|---|---|---|---|---|
| **R-1** | 22 | **打通（或删除）`permission/modes.ts`** —— 消除两套互不相连的权限模式系统 | 端到端测试断言：`acceptEdits` 模式下 `edit` 不弹窗；`bypassPermissions` 的行为有明确定义并被测试锁定 | 1 人日 |
| **W-1** | 17 | **自动验证回路（S-03）** —— edit/write/patch 批次后自动跑 `tsc --noEmit`，结构化回灌 | 故意写一处类型错误，断言模型在 2 轮内收到诊断并自动修复 | 1.5~2 人日 |
| **A-1** | 16 | **接通 goal 判官到主循环终止** —— 消费 `bumpReact`，定义 `MAX_GOAL_REACT`，`ok:true` 时终止、连续 N 次 `ok:false` 时向用户上报并停 | 设置 goal 后，判官判定达成时主循环在有限步内退出并返回达成态；连续失败达上限时给出明确中断原因 | 1.5 人日 |
| **R-2** | 22/24 | **清除 `orDie`/`Effect.die` 密集区**（8 处，见 §24 清单），优先 `shell.ts:842,845` 与 `plan.ts:73,141` | 用户在 plan 切换对话框点「取消」**不产生 defect**；危险命令被拒时返回可读诊断 | 1 人日 |

### 5.2 P1 · 竞争力级（7 条）

| # | 指标 | 事项 | 验收标准 | 工作量 |
|---|---|---|---|---|
| **A-2** | 15 | `question` 未答时学 `plan` 的保守默认（`question.ts:24-28` 检查全答） | 提问被跳过后模型收到明确信号而非继续 | 0.5 人日 |
| **A-3** | 16 | `swarm` 加全局并发闸与子代理预算（改 `swarm.ts:238` 的 `unbounded`） | 20 个 teammate 的请求被排队执行且总量受配置约束 | 1 人日 |
| **W-2** | 18/19 | 让模型能触发 pre-commit 四检（mojibake / brand-guard / bug-patterns / tsc），或给 `git_commit` 加 `run_hooks` | 模型在 tsc 不过时无法生成任务 commit | 1 人日 |
| **W-3** | 19 | 新增 `git_push` 与 `gh_pr_create` 工具；把 `cli/cmd/pr.ts` 的能力提升为模型工具 | 模型不经 bash 完成「分支 → 提交 → 推送 → 建 PR」 | 1.5 人日 |
| **W-4** | 21 | 把 `file-backup.ts:157` 的 `rollback` 注册为模型工具（补 Action Items 里遗留的「回滚入口」） | 模型能列出某文件的备份并单文件回滚 | 0.5 人日 |
| **R-3** | 23 | `read` 增加 `.env`/凭据文件默认屏蔽 + 命中时显式告知模型「已屏蔽，原因 X」（沿用 P2-5 的可见降级范式） | `read('.env')` 返回屏蔽说明而非内容 | 1 人日 |
| **R-4** | 25 | 结构化日志落盘（按 `session.id` + 时间索引），并把 `log-error.ts:13` 的 `fields` 升级为必填 `sessionID`/`traceId` | `logError` 之后可在 CLI 查某会话的全部错误链；140 个调用点补齐必填字段 | 2 人日 |

### 5.3 P2 · 超越级（CC 没有，3 条）

| # | 指标 | 事项 | 为什么是「超越」 |
|---|---|---|---|
| **A-4** | 13 | 修 `tool_search` 兜底泄漏（`toolsearch.ts:71-73` 改为返回「换个词」建议 + 邻近工具，**不列全量清单**） | CC 的工具目录是固定面，没有渐进披露；gyc 做对了机制却漏了这个出口 |
| **R-5** | 25 | **单次运行的完整执行报告**：终止原因 / 步数 / 工具调用分布 / 停滞事件 / 后台任务残留 / 判官裁决，全部落库并可导出 | CC 只有 `--output-format json` 的一次性 stdout 字段（`num_turns`/`terminal_reason` 等，主报告 §5.2 已确认），**gyc 已有会话级 SQLite 与 `cost_ledger`，做「可查询的执行档案」比 CC 的「一次性打印」高一档** |
| **W-5** | 20 | CI 状态感知：新增 `ci_status` 工具拉最近一次 workflow 结论与失败用例，让「CI 红 → 定位 → 修」闭环 | CC 无内置 CI 工具（**未核实**，见 §七）；gyc 作为本地 CLI 接 `gh run` 成本极低 |

### 5.4 执行顺序建议

```
第一批（消除已确认缺陷，约 4 人日）
  R-1 权限模式打通 → R-2 清除 orDie（含 plan 取消崩溃）→ A-1 判官收敛
  ↑ R-1 与 R-2 是本轮唯二「架构级」问题，且 R-2 可能已影响 plan 切换的正常路径

第二批（形成闭环，约 6 人日）
  W-1 自动验证回路 → W-2 pre-commit AI 触发 → A-3 swarm 并发闸
  ↑ W-1 是指标 17 从 🔴 翻到 🟡 的唯一条件，也是 ① 任务成功率的前置

第三批（可测量与差异化，约 6 人日）
  R-4 日志落盘 → R-5 执行报告 → W-4 回滚入口 → A-2/A-4 → W-3 push/PR → R-3 secret 屏蔽 → W-5 CI 感知
```

---

## 六、对既有报告旧结论的更新

> 本节只列**因近期改动而不成立或需改口径**的条目，不复述已有结论。

### 6.1 已修复，缺口消失

| 原出处 | 原结论 | 本轮核实 | 证据 |
|---|---|---|---|
| 主报告 **S-01**（P0） | 主 agent `maxSteps = Infinity`，「防止无限空转」的保护只给了子代理 | **已修复**。默认 200 步，配置 `0` 可显式恢复不限制 | `prompt.ts:111-112,1680-1686` |
| 主报告 §4.2 指标 7 | 「无后台任务」 | **已修复**。`bash` 支持 `background=true` 返回 `shell_id` | `shell.ts:850-873`、`bash-background.ts`（status/kill/list） |
| 主报告 §4.2 指标 7 | 「危险命令只提示不拦截」 | **已修复**。blocked 无条件拒绝、dangerous 需 `allowDangerous` | `security.ts:9-24,52-73`、`shell.ts:841-846` |
| 主报告 §4.2 指标 8 | 「没有 git 工具」 | **已修复**。6 个工具已注册 | `registry.ts:306-311`、`tool/git.ts` |
| 主报告 §4.2 指标 8 | 「无自动 commit」「diff 只服务 snapshot 不给模型」 | **已修复**。影子仓库已建任务历史 | `snapshot/index.ts:53,61,63,657,681,935` |
| 主报告 §4.2 指标 6 | 「无文件级写前备份」 | **已修复**，且 `.bak`/`.absent` 双标记覆盖删除场景 | `file-backup.ts:31,92,112,148,157` |
| 主报告 §4.2 指标 11 | 「无 OCR」「无 PDF 解析」 | **已交付**（本轮未复核实现细节） | `tool/describe-image.ts`、`util/pdf.ts`（见 §6.3） |
| 主报告 **C-01**（P0） | 「没有 task 实体」 | **已修复**。`task` 表 + `gyc task list` | `task-table.ts:8-24`、`task-projector.ts:55,91,128,136,155,162` |
| 主报告 §S-04 / P2-6 | 参数校验失败被 `orDie` 吞掉 | **已修复**。改为结构化 `<tool_error>` 回灌并附 schema | `tool.ts:112-122,154-188` |

### 6.2 需改口径的条目

| 原出处 | 原表述 | 应改为 |
|---|---|---|
| 主报告 **S-02**（P0） | 仓库内 `max-steps.ts` 冒充系统指令、已实证劫持子代理 | **本轮未复核该文件是否仍存在/措辞是否已改**。若已修，请在本轮补一行证据；若未修，P0 仍然有效。**不作结论** |
| 主报告 §5.4 | 「gyc 现有的是 `Permission.ask` 逐次询问，**没有模式枚举**、没有围栏」 | **前半句需更正**：`permission/modes.ts:3` 确实有 4 模式枚举。**但结论反而更严重** —— 该枚举**是死代码**（`resolveAction` 全仓零消费方），TUI 另有一套互不相连的 `"auto"/"normal"`。见 §4.1-B 与 R-1 |
| 主报告 §5.5 / `GAP-08-23 L65` | 「CC 有反思复盘循环，gyc **无**」→ 更正为「gyc 有」 | **需再次更正为「gyc 有但不闭环」**：判官存在（`goal.ts:205-259`）且已接入（`prompt.ts:1931-1936`），但**裁决不终止主循环**（`bumpReact` 无消费方，`MAX_GOAL_REACT` 未定义）。见 §16.4 |
| 主报告附录 B | CC v2.1.285 / commit `afb212976052` / `C:\Program Files\nodejs\...` | 更新为 **v2.1.286 / `f344a08993bb` / `C:\Users\Administrator\AppData\Roaming\npm\...`**，且 `sdk-tools.d.ts` 字节数与 285 相同，**43 工具清单未变**。见 §0.2 |
| 主报告 §4.4 结论 | 「真正的短板是 Git 集成（8）」 | 在**执行链路**维度仍成立；但就 12~25 全维度看，**最严重的短板已转为指标 22（权限模式死代码 + 无沙箱）与指标 17（零验证回路）** |

### 6.3 仍未修复、需保留的 P0/P1

| ID | 指标 | 内容 | 证据 |
|---|---|---|---|
| **S-03** | 17 | 框架层零自动验证回路 —— 全仓检索 `tsc --noEmit`/`typecheck` 仅 2 处非运行时命中 | 见 §3.1 |
| **NEW-1** | 16 | goal 判官不收敛，`bumpReact`/`MAX_GOAL_REACT` 无实现 | 见 §16.4 |
| **NEW-2** | 22 | `permission/modes.ts` 死代码 + 两套模式系统 | 见 §4.1-B |
| **NEW-3** | 24 | 8 处 `orDie`/`Effect.die`，含 `plan.ts:73,141` 的用户取消路径 | 见 §24 |
| **C-04~C-09** | — | 成本系统六项（主报告已记） | 本轮未复核 |
| **H-01~H-07** | — | 幻觉率七项（主报告已记） | 本轮未复核 |

---

## 七、Claude Code 侧未能核实项（诚实清单）

> 以下全部**不作为本报告任何判定的依据**。原因是本机 CC 为 **v2.1.286 原生二进制**（无 JS 主源码可反编译，主报告附录 B 已确认），且 `claude doctor` 显示**未登录鉴权 + 本机 settings.json 有 schema 错误**，无法以默认配置跑通任何需要鉴权的交互。

| 项 | 状态 | 说明 |
|---|---|---|
| `EnterPlanMode` / `ExitPlanMode` 的**实际审批强度** | **未核实** | 只确认两个 schema 存在。是否真的阻断编辑、计划存哪、能否被模型绕过，均未知 |
| `TaskCreate` / `TaskUpdate` 的**依赖图是否真被执行** | **未核实** | 只确认 `addBlocks`/`addBlockedBy`/`owner` 字段存在。`blockedBy` 是软提示还是硬约束，未知 |
| `AskUserQuestion` 的**选项上限与阻塞语义** | **未核实** | 未确认能否多问、能否跳过、跳过时模型收到什么 |
| `TodoWrite` 的**实际提醒阈值** | **未核实** | gyc 侧的 3 项阈值（`todo.ts:16`）无对应可比数据 |
| `Agent` 工具的**并发上限 / 深度上限实际值** | **未核实** | `subagent_stats.refused.concurrency_limit`（主报告 §5.2 已确认字段存在）**实际阈值未知**，因此无法判断 gyc 的 `unbounded` 究竟差多少 |
| `--max-budget-usd` 的**实际拦截行为** | **未核实** | 只确认参数存在。超支是硬停还是提示，未知 |
| `--restricted` / `--safe-mode` / `--bare` 的**实际拦截强度** | **未核实** | 主报告 §5.4 记录的是 `doctor`/文档口径，非实测 |
| **沙箱在 win32 上是否真的生效** | **未核实** | 本轮未做任何沙箱实测。**这直接影响指标 22 的对比力度** |
| `ReportFindings` 的**实际行为** | **未核实** | 只确认工具名在 43 schema 中 |
| `Monitor` / `ScheduleWakeup` / `CronCreate` 的**实际行为** | **未核实** | 同上 |
| **v2.1.285 → v2.1.286 的变更清单** | **未核实** | 本轮未联网。**已确认的只是：`sdk-tools.d.ts` 字节数与工具联合类型逐项一致** |
| CC 斜杠命令清单 / 计划文件格式 / 沙箱配置项 | **未核实** | 与主报告附录 D 同因，本轮同样无法采集 |

> **对判定的影响说明**：上述未核实项集中在**「CC 的机制有多强」**，而非**「CC 有没有这个机制」**。因此本报告所有 🟢 判定的支撑点都是 **gyc 侧已确认的能力 + CC 侧已确认的「无对应 schema」**（如 `swarm`/`peer`/`task_manage` 不在 43 个工具名中），**不依赖任何未核实的行为强度推断**。

---

## 附录 A · 本轮两个专项核实结论

### A.1 `bumpReact` —— 无消费方

| 检索 | 结果 |
|---|---|
| `bumpReact`（全仓，排除 `node_modules`，含 `.ts`/`.tsx`） | 5 处：`goal.ts:111`（接口声明）、`goal.ts:153`（实现）、`goal.test.ts:33,36,37`（测试）。**业务调用 0 处** |
| 判官调用点 | `prompt.ts:1929-1936` —— `Effect.promise(() => goal.evaluate(...)).pipe(Effect.ignore, Effect.forkIn(scope))` |
| 返回值消费 | **无**。`break` 判定（`prompt.ts:1937`）只读 `outcome` |
| `MAX_GOAL_REACT` | `goal.ts:29-30` 注释提及该常量，**全仓无定义** |
| `actionFor()`（`retry.ts:170-174`） | 同类问题，**无消费方** |

**判定**：目标判官 = **纯建议性/展示性**。裁决 `ok:true` 不终止主循环。**指标 16 的「目标漂移控制」只有两道被动防线（步数上限 + 空转守卫），没有主动收敛。** → 改进动作 **A-1（P0）**。

### A.2 `resolveAction` —— 无消费方

| 检索 | 结果 |
|---|---|
| `resolveAction`（全仓） | 2 处：`modes.ts:9`（定义）、`permission/index.ts:249`（转出导出）。**调用 0 处** |
| `from ".*permission/modes"` / `from "./modes"` | 1 处：`permission/index.ts:249`（自己转出自己）。**无外部 import** |
| `PermissionMode`（`modes.ts:3`，4 值枚举） | 与 `src/tui/context/permission.tsx:5` 的 `PermissionMode = "auto" \| "normal"` **同名不同义** |
| TUI 那套的初始化 | `permission.tsx:10-13` —— 由 CLI `--auto` 参数决定，`toggle()` 在 `:21-23` 切换 |
| shell 的实际路径 | `shell.ts:841-846` 走 `classifyCommand` + `Effect.die`，**不经过 `resolveAction`** |

**判定**：`modes.ts` 的 4 模式 + 危险级别到动作的映射（`modes.ts:9-19`）**是死代码**。TUI 的 `"auto"/"normal"` 与之无连接（**其是否影响 `Permission.ask` 裁决本轮未逐行确认，标为【推断】**）。

**后果**：权限判定实际是「**配置 ruleset（`permission/index.ts:212-224`）+ `classifyCommand` 硬编码**」，**与「模式」概念无关**。这比主报告 §5.4 说的「没有模式枚举」严重 —— 不是缺一个枚举，是**枚举写了但没接线，且同名类型在两处并存造成误导**。→ 改进动作 **R-1（P0）**。

---

## 附录 B · 档位判定速查

| 档位 | 指标 | 数量 |
|---|---|---|
| 🟢 强 | 16（并行调度+漂移，含超越点）、21（原子性与可回滚） | 2 |
| 🟡 中上 | 12、13、14、15、18、19、20 | 7 |
| 🟠 偏弱 | 23（密钥隐私）、24（崩溃恢复）、25（可观测性） | 3 |
| 🔴 弱 | 17（验证闭环）、22（权限沙箱） | 2 |

**本轮 4 条 P0**：R-1（权限模式死代码）、R-2（orDie 密集区）、W-1（零验证回路）、A-1（判官不收敛）。

**无任何指标判为「超越 CC」的独立项**，但指标 16 的子代理编排（`swarm` + `peer` + `task_manage` 三工具）与指标 21 的文件级备份（`.bak`/`.absent`）**在 CC v2.1.286 的 43 个 schema 中无对应物（已确认）**。

---

*本轮全程只读：未修改任何源码，未执行 git commit。唯一写入为本文件与主报告末尾的一行索引。*