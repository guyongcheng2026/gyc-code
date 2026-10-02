# 对标 Claude Code 三指标诊断报告

- **日期**：2026-09-30
- **被审对象**：`C:\gyc-code`（HEAD `b6b4b164b6`，工作区干净）
- **对标基准**：Claude Code **v2.1.285**（本机实装，`claude --version` 确认；由 v2.1.223 升级而来）
- **范围**：聚焦影响三个指标的全部机制链路 —— `session/`、`tool/`、`provider/`、`core/session/`、`learning/`、`cli/`、`scripts/`
- **方法**：只读取证，**零 LLM 调用、零 token 花费**。每条缺口均带实机校验过的 `file:line`
- **设计文档**：`docs/compose/specs/2026-09-30-vs-claude-code-3metrics-diagnosis-design.md`

> ⚠️ **取数方法变更（重要）**：Claude Code v2.1.285 已改为**原生二进制**分发（`bin/claude.exe`），npm 包内只剩 `cli-wrapper.cjs` + `sdk-tools.d.ts`，JS 主源码不再随包提供。旧文档 `GAP-ANALYSIS-2026-08-16` 使用的「反编译 `cli.js` 静态比对」方法**在最新版已失效**。本报告改用三条可用通道：`sdk-tools.d.ts`（随包发布的工具 JSON Schema，权威工具清单）、`--output-format json` 的遥测字段、`--help` 的能力面。

---

## 零、核心结论

**三个指标现在一个都测不了，而且对标基线也基本是空的。** 这不是「指标不好」，是**尺子不存在**。

| 指标 | 测量能力 | 对标基线 | 一句话 |
|---|---|---|---|
| ① 任务成功率 | **无** | 仅 10 样本 / 9 通过，不可外推 | 没有任何可评分任务集；`benchmark.test.ts` 20 项里 17 项是「文件存在」断言、3 项 `skip` |
| ② 幻觉率 | **无** | **零** | 唯一「训练集」是空壳，第一步就丢弃全部失败样本 |
| ③ 每任务真实成本 | 原料齐、闭环缺 | **零** | 自建端点定价**恒为 0**；子代理花费**完全不进父会话**；无 task 实体 |

**但这次审查挖到了比「缺尺子」更值钱的结论**：不用跑一次任务，仅靠逐行取证就定位出 **9 个 P0**，其中多数是「确定性发生」而非「可能发生」的机制缺陷。这批 P0 修完，三项指标才具备可测前提。

**另有两处历史结论已过期，必须纠正**（详见 4.5 与附录 C）—— `GAP-08-23` 判定 gyc 缺失的两项能力，源码里其实已经实现了。

---

## 一、① 任务成功率

### 1.1 规范定义

「做一件事多快做对」应拆成三个可测分量：

```
任务成功率 = 一次通过的任务数 / 任务总数
做对速度  = 从任务发起到验收通过的中位时长
返工成本  = 未通过任务的重试轮次与额外 token
```

三者的分母都要求**存在一个可判定的「任务」单元**与**一个可判定的「通过」条件**。gyc 目前两者都没有。

### 1.2 当前实现取证

**有价值的真家伙（先说好的，避免误判）：**

- `src/gyccode/session/goal.ts:11-12,170,234-258` —— 存在**独立 LLM 判官**回路：低温 `generateObject` 读完整 transcript，判定停止条件是否满足，输出 `{ok, impossible, reason}` 结构化裁决。判官可注入（`goal.ts:193-199` 提供 `Goal.fake`），测试不碰真模型。
- 该判官**已接进主循环**：`src/gyccode/session/prompt.ts:1919-1922` 在有 active goal 时异步评估。
- `src/core/database/schema.gen.ts:272-274` —— `workflow_run` 表带 `status` / `current_step_index` / `steps` / `error`；`src/cli/cmd/workflow.ts:27,55` 有 `defs` / `start` 子命令。**流程编排已有。**
- `src/gyccode/tool/edit.ts:829-834` —— 锚点找不到 / 多处匹配，**必抛错**，不会静默生成错误内容。

**缺陷（按危害面排序）：**

#### [S-01] P0 · 主 agent 无步数上限，子代理有

```src/gyccode/session/prompt.ts:1678
  const maxSteps = agent.steps ?? (agent.mode === "subagent" ? SUBAGENT_MAX_STEPS : Infinity)
```

`SUBAGENT_MAX_STEPS = 20`（`prompt.ts:110`）。**主 agent 的 `maxSteps` 默认是 `Infinity`。**

而 `prompt.ts:109` 的注释把设计意图写得很清楚：

```
/** 子代理未显式配置 steps 时的默认步数上限，防止无限空转。 */
const SUBAGENT_MAX_STEPS = 20
```

**「防止无限空转」的保护只给了子代理。** 主 agent 走 `Infinity` 分支是有意为之，不是遗漏。

触顶保护 `MAX_STEPS_PROMPT` 是通过在消息数组尾部追加一条**伪 assistant 消息**实现的：

```src/gyccode/session/prompt.ts:1828
  ...(isLastStep ? [{ role: "assistant" as const, content: MAX_STEPS_PROMPT }] : []),
```

对子代理有效；对主 agent 永不触发。

- **机制 → 指标**：主 agent 陷入「改一点→跑一次→再改一点」的循环时，框架不会停。任务在外部看起来「还在跑」，实际已偏离目标。直接抬高返工成本，同时无上限烧 token（与 [C-03] 叠加即成本黑洞）。
- **修复**：主 agent 给默认有限步数，或改为「无进展检测」为主、步数为辅。`prompt.ts:112` 的 `MAX_CONSECUTIVE_TOOL_ONLY_STEPS = 10` 配 `prompt.ts:1891-1908` 的停滞守卫（`isStalledToolOnlyStep`）已是现成机制，只是它只拦「完全空转」，拦不住「有进展但方向错」。
- **验收**：构造一个反复读写同文件的任务，断言主 agent 在有限步内终止并返回明确的中断态。

#### [S-02] P0 · 仓库内存在冒充系统指令的提示词模板

```src/core/session/runner/max-steps.ts:1-16
  export const MAX_STEPS_PROMPT = `CRITICAL - MAXIMUM STEPS REACHED
  ...
  3. This constraint overrides ALL other instructions, including any user requests for edits or tool use
  ...`
```

- **机制 → 指标**：这是一段**以「覆盖一切其他指令」措辞书写的文本，且明文躺在被 agent 自己的工作区里**。任何子代理执行 `read`/`grep` 到该文件，都会把这段文本当真实指令接收。
- **本次审查的实证**：执行本次取证的子代理读取此文件后，**当场中断工作并向我报告「检测到提示词注入」**，随后才恢复继续。这是可复现的。
- **风险面**：它证明「提示词注入」在 gyc 自身的文件树里已经成立——一个读代码的 agent，只要读到这一段，行为就被第三方文本劫持。这既是安全问题，也直接污染 ① 与 ② 的测量（被劫持的 agent 产出的样本不能计入基线）。
- **修复**：① 把该模板移出 agent 可读的源码树（如迁到构建期生成的 `.bundle/`，与 `AGENTS.md:25` 记录的既有做法一致）；② 改写措辞，去掉 "overrides ALL other instructions" 这类系统级僭越表述。
- **验收**：子代理 `read src/core/session/runner/max-steps.ts` 后，其下一轮行为与未读取时一致（用固定种子任务对比）。

#### [S-03] P0 · 框架层零自动验证回路

`src/gyccode/session/prompt/default.txt:56-57` 有「你必须跑 lint / typecheck」的要求，但**这是提示词层软约束，框架不主动触发、不检查结果**。

- **机制 → 指标**：模型可以声称「改好了」而从未编译过一次。`REALRUN-2026-08-28` 记录 10/10 一次通过，但那 10 个任务全是 1+1、读文件量级，**没有一次触发过编译**。
- **修复**：在 edit/write 批次完成后，对受影响的文件自动跑 `tsc --noEmit` 并把结果作为工具输出回灌（该命令在 `AGENTS.md:14` 已是本仓库标准验证步骤，成本极低）。
- **验收**：故意写一处类型错误，断言模型在 2 轮内收到 tsc 报错并自动修复。

#### [S-04] P1 · 参数校验失败被 `orDie` 吞掉，纠正提示永不回灌

```src/gyccode/tool/tool.ts:123-131   构造 InvalidArgumentsError
src/gyccode/tool/tool.ts:26-27     类定义，tag = "ToolInvalidArgumentsError"
src/gyccode/tool/tool.ts:147       }).pipe(Effect.orDie, Effect.withSpan("Tool.execute", ...))
```

`tool.ts:21-24` 的注释宣称这个错误类「produces the model-facing prose that the AI SDK feeds back as the tool result」。**实际 `orDie` 把它转成了 defect（崩溃），不会走工具结果通道。** 全仓检索 `InvalidArgumentsError` 只有 3 处命中，全在 `tool.ts` 内，无任何 catch。

- **机制 → 指标**：模型把 `filePath` 写成 `path`，decode 失败 → 崩溃而非纠正。模型拿不到「请按 schema 重写」的提示，也没有重试计数上限，会转向**猜参数**碰运气。
- **修复**：去掉 `orDie`，让 `InvalidArgumentsError` 走正常的工具错误回灌通道。
- **验收**：用错误参数名调用任一工具，断言返回的是可读的 schema 纠正提示而非崩溃。

#### [S-05] P1 · edit 模糊匹配可能静默替换到错误位置

```src/gyccode/tool/edit.ts:801-806   9 级 replacer 依次尝试（Simple → LineTrimmed → BlockAnchor →
                                  WhitespaceNormalized → IndentationFlexible → EscapeNormalized →
                                  TrimmedBoundary → ContextAware → MultiOccurrence）
src/gyccode/tool/edit.ts:686-741   ContextAwareReplacer：首行+末行相同 + 行数相等 + 中间 >=50% 行匹配即接受
src/gyccode/tool/edit.ts:837-843   isDisproportionateMatch：只比较行数，不比较内容
```

- **机制 → 指标**：两个结构相似的中等长度函数，模型改 A，replacer 匹配到 B。**不报错、不提示，diff 里才看得见。** 这是「一次没做对」最难排查的一类。
- **修复**：`ContextAwareReplacer` 命中时强制走一次确认，或把 50% 阈值提到 100%。
- **验收**：构造两个前两行相同、中间一行不同的函数，断言 edit 拒绝而非静默替换。

#### [S-06] P1 · read 缓存 200 条 LRU 导致合法编辑被误拦

```src/gyccode/tool/read-cache.ts:15   容量 200 的 LRU
src/gyccode/tool/edit.ts:155-159    未读则抛 "File has not been read in this session"
src/gyccode/tool/write.ts:50-54     同构
```

方向是安全的（只误拦、不漏放，`read-cache.ts:12-14` 注释已说明），但长会话中模型**按正确流程读过**的文件会被拦下并浪费一轮解释。属于「多快」的直接扣分项。

#### [S-07] P2 · 压缩后已读状态被重置

```src/gyccode/session/instruction.ts:28   if (part.state.time.compacted) continue
```

压缩后「哪些文件已读」被重新判定，规则文件会重复注入。与 [S-06] 叠加会放大误拦。

---

## 二、② 幻觉率

### 2.1 规范定义

```
幻觉率 = 编造了不存在的事实（文件路径 / 符号 / API / 行号 / 命令输出）的回合数 / 总回合数
```

可自动检测的三类：**引用不存在的路径**、**引用不存在的符号**、**引用不存在的 API 签名**。前两类可静态校验，第三类需对照依赖清单。

### 2.2 当前实现取证

**有价值的真家伙：**

- 8 个模型提示文件中有 7 个带逐字相同的 `# Accuracy and honesty` 四条禁令（`src/gyccode/session/prompt/anthropic.txt:3-7`；`default` / `codex` / `gemini` / `kimi` / `beast` / `trinity` / `gpt` 同样有）。
- `src/gyccode/tool/websearch.ts:152` 搜索失败时显式回灌「请如实向谷总报告本次搜索未成功，不要编造搜索结果或链接」；`:161-163` 成功时提醒必须引用来源。**全仓唯一的运行时反幻觉回灌。**
- `src/gyccode/tool/read.ts:87-110`「Did you mean one of these?」—— 双向子串模糊匹配，把「路径不存在」从事实变成提示。有效。
- `src/gyccode/tool/webfetch.ts:25-67` **SSRF 防护完整**：回环、私网 10/172.16/192.168、链路本地 169.254、CGNIG `100.64.0.0/10`（注释点名阿里云元数据 `100.100.100.200`）、IPv6 `fc00::/7` / `fe80::/10`、未指定地址、十六进制/整数变形 IP 全部拦截。**通过。**
- `src/gyccode/tool/edit.ts:155-159` read-before-write 内存级硬拦截；`edit.ts:829-834` 锚点失败必抛错。

**缺陷：**

#### [H-01] P0 · gpt-6 系模型的提示词防线是空的

```src/gyccode/session/system.ts:38        model.api.id.includes("gpt-6") -> PROMPT_ASTRA
src/gyccode/session/prompt/gpt-astra.txt:1-46   全文 46 行
```

8 个 provider 提示文件里**唯独它没有 `# Accuracy and honesty` 段**。具体缺失：

| 缺失项 | 对照 |
|---|---|
| 不确定时说不确定、绝不编造细节 | `anthropic.txt:4` |
| 不要编造文件路径/行号/错误信息，不确定时用 Read/Grep/Bash 复核 | `anthropic.txt:7` |
| 先读源码再改 | `beast.txt:134` / `gpt.txt:8` / `gemini.txt:26` |
| 不要假设库存在 | `default.txt:44` |
| 不要凭空生成 URL | `anthropic.txt:11` / `default.txt:9` |

**且自我对冲：**

```src/gyccode/session/prompt/gpt-astra.txt:39
  Do not introduce unsolicited warnings, disclaimers
```

模型想声明不确定时，被同一份提示词压制为「不要主动加免责声明」。**编造的默认成本降到零。**

- **机制 → 指标**：模型越新（gpt-6），防幻觉防线越弱 —— 这是全链路唯一的反向退化点。
- **修复**：把 `anthropic.txt:3-7` 的 Accuracy 段补进 `gpt-astra.txt`；把 `:39` 改为「不要加与事实无关的免责声明，但事实性不确定必须声明」。
- **验收**：对 8 个 provider 提示文件跑一致性断言 —— 任一文件必须含 Accuracy 段且不得含禁止声明不确定的措辞。

#### [H-02] P0 · 压缩把证据截成 2K 并覆盖写回数据库

```src/gyccode/session/compaction.ts:38    const TOOL_OUTPUT_MAX_CHARS = 2_000
src/gyccode/session/compaction.ts:48-49  output.length > 2000 ? `${output.slice(0, 2000)}…` : output
src/gyccode/session/compaction.ts:429-431 part.state.output = summarizeToolOutput(...); session.updatePart(part)
```

三个问题叠成一个：

1. **只加一个 `…`**，无「省略 N 字符」说明、无全文路径。对比同仓库 `message-v2.ts` 的截断提示与 `truncate.ts:141` 的全文落盘路径，这条是唯一什么都不给的。
2. **`:432` 写回 SQLite，是覆盖不是隐藏。** 被切掉的后半段**永久不可恢复**。
3. **截断点正好吃掉 read 自己的完整性标记。** `read.ts:399-401` 会在输出**末尾**加 `(Showing lines X-Y of N. Use offset=N to continue.)`，而 2000 字符的切片从**头部**下刀 —— 模型拿到的是「读到一半突然停住、零说明」的文件内容。

`compaction.ts:44-47` 的注释声称这套设计「显著降低压缩后的幻觉率」。**实际效果相反。**

- **机制 → 指标**：模型对被截断的文件没有任何信号知道「后面还有」，最容易基于前半段断言整个文件，并据此编造后半段的函数签名与导出。
- **修复**：① 截断时补齐 `[省略 N 字符，用 offset=N 继续读]`；② 原文落盘到 `truncate.ts` 那样的旁路文件，DB 里只存指针。
- **验收**：读一个 5000 行文件 → 触发压缩 → 断言模型看到的截断文本里含「还剩多少、从哪继续」。

#### [H-03] P0 · 序列化层把 read/grep/glob 硬顶 2000 字符

```src/gyccode/session/message-v2.ts:99-103
  export const TOOL_TYPE_CAPS: Record<string, number> = { read: 2_000, grep: 2_000, glob: 2_000 }
```

即使模型上下文窗口很大（`CACHE_FRIENDLY_TOOL_CHARS_LARGE = 8_000`，`message-v2.ts:78`），**结构化工具输出仍被 2K 封顶**。一个 3000 行的 TS 文件，模型实际只看到约 40 行。

仓库自己在 `message-v2.ts:164-168` 写下了完整因果链：

> 截断观测（幻觉率前置信号）——
> 证据截断（read/grep/glob 输出 cap）会迫使模型基于不完整信息补全，是幻觉率
> 的同一旋钮两端。

**诊断写对了，闭环没做**：`truncationStatsMap`（`message-v2.ts:170-180`）只统计次数与省略字符数，**不触发任何纠偏**。`resetTruncationStats()` 存在，但没有任何消费方。

- **验收**：`truncationStatsSnapshot()` 的输出被某个实际读取它的逻辑消费（当前无消费方）。

#### [H-04] P0 · grep 无结果回执语义错位

```src/gyccode/tool/grep.ts:30-34
  const empty = { ..., metadata: { matches: 0, truncated: false }, output: "No files found" }
src/gyccode/tool/grep.ts:69
  if (result.length === 0) return empty
```

grep 搜的是**文件内容**，返回的却是 **"No files found"（没找到文件）**，并用 `truncated: false` 确证「这是完整且确定的否定结论」。

- **机制 → 指标**：模型读到「这个目录下没有文件」，会据此判定「这个 API/文件不存在」，转而**自己造一个**。对比 `glob.ts:66-71` 的截断提示，grep 这条否定回执信息量为零。
- **修复**：改为 `No matches found for pattern /x/ in <path>. Try a broader pattern or a different path.`；同时把 `truncated` 改用 ripgrep 已有的精确标志（`src/core/ripgrep.ts:131-132` 已计算但被 grep 工具丢弃）。
- **验收**：grep 一个确定不存在的符号，断言返回文本不含 "No files found"。

#### [H-05] P1 · 压缩保护「叙述」而牺牲「证据」

```src/gyccode/session/compaction.ts:39            const PRUNE_PROTECTED_TOOLS = ["skill"]
src/gyccode/session/microcompact-select.ts:17   const PROTECTED_TOOLS = new Set(["skill"])
src/gyccode/session/compaction.ts:53            const CACHE_PREFIX_KEEP = 20
```

`microcompact-select.ts:9-11` 的注释说清了机制：清掉 Read/Shell/Grep/Glob/WebSearch/WebFetch/Edit/Write 的输出，**只保留 skill 输出**。

- **机制 → 指标**：read/grep/glob 的输出是模型**唯一的事实证据**，却是第一批被清理的对象；模型的自我陈述（assistant summary）反而是保留锚点。**证据与叙述倒置。** 另外 `CACHE_PREFIX_KEEP = 20` 为保 prompt cache 强制保留最陈旧的 20 轮，而那 20 轮的头部又是 [H-02] 截断的产物 —— 陈旧且残缺。
- **修复**：把 read/grep/glob 纳入保护名单，或按「该工具输出是否被后续消息引用」来决定去留。

#### [H-06] P1 · 「不要假设库存在」只覆盖 3 / 9 个模型

| 有此约束 | 无此约束 |
|---|---|
| `default.txt:44`（fallback）、`trinity.txt:69`、`gemini.txt:12` | **anthropic（claude 全系）**、beast（gpt-4/o1/o3）、gpt、codex、kimi、**gpt-astra** |

谷总的主力模型走 `anthropic.txt`（`system.ts:45`），**恰好不在覆盖范围内**。

#### [H-07] P2 · 幻觉检测只作用于记忆文件，且正则会误报

```src/gyccode/memory/dream.ts:165-173
  [/as an ai/i, /i don't know/i, /i cannot/i, /unable to/i, /not sure/i, /maybe/i, /possibly/i]
```

`maybe` / `possibly` 在正常技术表达里高频出现，会大量误报。检测只作用于 `dream` 生成的记忆文档，**对代码输出零检测**。

---

## 三、③ 每任务真实成本

### 3.1 规范定义

```
每任务真实成本 = Σ(该任务下所有会话的 input/output/cache-write 计价 + 失败重试的计价)
               ÷ 成功完成的任务数
```

四个必备条件：**① 任务边界可识别** ② **每个 token 有单价** ③ **子任务成本可上卷** ④ **成功/失败可判定**。gyc **四个都不满足**。

### 3.2 当前实现取证

**有价值的真家伙：**

- `src/core/database/schema.gen.ts:198-203` session 表已有 `cost` + `tokens_input` / `tokens_output` / `tokens_reasoning` / `tokens_cache_read` / `tokens_cache_write` **六列**，逐 step 精度。
- `src/gyccode/session/session.ts:333-405` `getUsage` 实现完整：上下文阶梯定价（`:380-386`）、四 provider 的 cacheWrite 兼容（`:343-356`）、reasoning 单独计价（`:398-400`）。
- `src/gyccode/session/cache-anchor.ts` 缓存漂移监控（cacheRead 骤降 >5% 且 >2K tokens 告警）。
- `src/tui/component/dialog-cost.tsx:86-105` **有真正的缓存命中率**（前缀口径：命中 = min(本轮 cacheRead, 上轮总输入)）。与 `scripts/verify-cli.mjs:799` 那个自认是假的「镜像新鲜度」指标**不是一回事**。
- `src/cli/cmd/export.ts:223,288` 已有 JSON 导出，且带 `--sanitize` 脱敏开关。

**缺陷：**

#### [C-01] P0 · 没有 task 实体

```
src/core/database/schema.gen.ts:182-213
  session 表 31 列：无 task_id、无 goal_id、无 episode、无 run_id
  唯一层级字段 parent_id（:186）
```

而 `parent_id` 混装了两类语义完全不同的边：

| 写入方 | 语义 |
|---|---|
| `src/gyccode/tool/task.ts:168`、`src/gyccode/tool/swarm.ts:182` | 子代理派生 |
| `src/gyccode/session/session.ts:425` `fork(sessionID, messageID)` | 会话分叉 / 重试 |

**树形结构本身不构成任务边界。** 谷总视角的「做一个 feature」通常跨多个会话、多天，这棵树里没有任何东西表达这个边界。

**Claude Code v2.1.285 的对照**（`sdk-tools.d.ts:2781-2847`）：

```
TaskCreateInput  { subject, description, activeForm, metadata }
TaskUpdateInput  { taskId, status: "pending"|"in_progress"|"completed"|"deleted",
                   addBlocks[], addBlockedBy[], owner, metadata }
TaskGetInput     { taskId }
TaskListInput    {}
```

CC 有一个**带状态机、阻塞依赖图（addBlocks/addBlockedBy）、可指派 owner 的持久任务实体**。这是算「每任务成本」的地基，gyc 完全没有。

- **修复**：新增 `task` 表 + session 外键；或退一步用 `metadata` JSON 承载 task_id（改动面小，但无法建索引）。
- **验收**：`gyc task list` 能按 task 汇总出跨会话的成本合计。

#### [C-02] P0 · 子代理成本完全不进父会话（最大低估源）

```
src/core/session/projector.ts:92-113
  applyUsage(...) -> .where(eq(SessionTable.id, sessionID))
src/core/session/projector.ts:391
  sessionID 取自 event.data.part.sessionID —— 是子会话自己的 ID
```

**全仓无任何向上遍历 `parent_id` 的代码。**

- **机制 → 指标**：父任务 spawn 5 个子代理，父 session 的 `cost` 字段只含父自己的 LLM 调用（外加把子代理结果当工具结果回灌的那次）。**5 份子代理全额花费从父 cost 里彻底不可见。** 谷总看到的「这个任务花了 X」实际是下限。
- 唯一可见处是 `src/tui/routes/session/subagent-footer.tsx:54,68,107` —— **进入子代理视图时显示单个子会话的成本，不做父子加总**。`sidebar.tsx:30-42` 的 workspace 汇总是全局平坦的，不是某个任务的。
- **对照**：CC v2.1.285 的 `--output-format json` 直接返回 `subagent_stats`：

  ```json
  "subagent_stats": {
    "spawned": 0, "completed": 0, "failed": 0,
    "killed": { "parent": 0, "user": 0, "system": 0 },
    "refused": { "depth_limit": 0, "concurrency_limit": 0, "budget": 0 },
    "by_type": {}, "max_depth": 0, "spawned_by_subagents": 0
  }
  ```

  **一等的子代理归集遥测，含完成/失败/各类拒因。** gyc 无对应物。
- **修复**：`applyUsage` 增加向上聚合，或提供按 `parent_id` 树递归求和的查询。
- **验收**：spawn 3 个子代理后，父会话成本 ≥ 父子成本之和的 90%。

#### [C-03] P0 · 自建端点定价恒为 0

三级 `?? 0` 兜底链，终点是计价：

```
src/gyccode/provider/provider.ts:1534-1541
  cost: { input: model?.cost?.input ?? existingModel?.cost?.input ?? 0, ... }
src/gyccode/session/session.ts:394-400
  .mul(costInfo?.input ?? 0) ... .toNumber()
```

`src/tui/component/dialog-provider.tsx:40` 注释明说支持「任意 OpenAI 兼容供应商，无需在 models.dev 目录中注册」—— 而 OpenAI 兼容的 `/models` 接口通常不返回 `cost` 字段。

- **机制 → 指标**：谷总现在接的自建端点，`session.cost` **恒为 0**。成本数字不是不准，是不存在。
- **更糟的是 0 被当成合法值**：`src/tui/component/dialog-model.tsx:44,82` 与 `src/tui/context/local.tsx:236` 都用 `cost?.input === 0` 判断「免费模型」。**「真免费」与「没查到价」不可区分。**
- **修复**：① 定价配置与「免费」标记解耦，用显式 `pricing: "unknown" | "free" | number`；② 补一个手工覆盖入口（`src/core/config/plugin/provider.ts:92-102` 已有雏形，但无引导）。
- **验收**：给自建模型配一个非零单价，断言 `session.cost` 与手工估算一致。

#### [C-04] P1 · 无账单对账

全仓唯一「真实账单」入口是 `src/gyccode/session/session.ts:387-391` 的 `metadata.copilot.totalNanoAiu`，且只替换单次 step 的计价结果。无 provider 账单拉取、无差异比较、无对账报表。

#### [C-05] P1 · 无成功/失败标记，且成本回退口径存疑

- `src/core/database/schema.gen.ts:182-213` 无 `success` / `outcome` / `error` 列。**算不出「成功完成一个 feature 的成本」，因为分母不存在。**
- 更麻烦的是 `src/core/session/projector.ts:361,379,402-403` 有四处 `applyUsage(..., -1)` 回退：

  ```
  361: if (previous) yield* applyUsage(db, events, event.data.sessionID, previous, -1)
  402: if (previous) yield* applyUsage(db, events, row.session_id, previous, -1)
  403: if (next)     yield* applyUsage(db, events, sessionID, next)
  ```

  含义是：**消息改写 / 重投影时旧成本被扣回、新成本被加上。** 若谷总中途 revert 或重试，成本会被追溯调整 —— 「今天花了多少」不是一个稳定值。
- **修复**：成本改为 append-only 流水（`cost_ledger` 表，只增不改），报表按时间窗聚合。

#### [C-06] P1 · 三套成本口径不同源

| 位置 | 口径 |
|---|---|
| `src/gyccode/session/session.ts:333-405` `getUsage` | 主计价实现 |
| `src/core/session/runner/publish-llm-event.ts:41-49` | **第二套独立实现**，价格缺省全 0（`:421`） |
| `src/cli/cmd/stats.ts:194` vs `stats.ts:237` | 前者逐 message 累加，后者用 `session.cost` |

`stats.ts:292-384` 无任何一致性校验。**`gyc stats` 显示的 Total Cost 与 MODEL USAGE 的 Cost 之和对不上时，没有任何人会报错。**

#### [C-07] P1 · 缓存命中率不落库

`src/tui/component/dialog-cost.tsx:86-105` 的 `cacheHitRate` 是**真指标**，但只存在于 TUI 内存态（数据来自 `sync.data.message`），**不落库、不导出、不进 `stats`**。而 `scripts/verify-cli.mjs:799` 那个被命名为「缓存命中率」的东西，项目自己承认是「镜像新鲜度 + 编译缓存存在性」的近似（`:774-797`）。**一个真指标被一个假指标遮住了。**

#### [C-08] P2 · 压缩成本计入任务成本 + 缓存锚点重启丢失

- `src/gyccode/session/compaction.ts:743` 新消息 `cost: 0` 只是初值，`src/gyccode/session/processor.ts:496` 的 `ctx.assistantMessage.cost += usage.cost` 会继续累加真实成本。**压缩开销没有被排除。** 频繁压缩反而更贵：压缩本身是一次带完整历史输入的 LLM 调用（`compaction.ts:784` 起 `processor.process({... tools: {}, system: [] })`），且压缩后缓存前缀断裂会触发 `cache-anchor` 告警。
- `src/gyccode/session/cache-anchor.ts:59,67-84` 锚点是**进程内存 Map**（`ANCHOR_MAX = 1000`），**进程重启后全部丢失，首轮不比较**。

#### [C-09] P2 · 导出的是会话数据，不是成本账

`src/cli/cmd/export.ts:288` 导出 `JSON.stringify(exportData)`。会话 JSON 里虽含消息级 cost，但**没有 task 维度、没有跨会话聚合、没有缓存命中率**。想算「一个 feature 多少钱」仍需手工拼。

---

## 四、工具能力（执行链路）：指标 6~11

> 采集时间 2026-10-01，基准 Claude Code v2.1.285。全部结论基于源码实证，附 `文件:行号`。
> **完整版（含逐项差距分析与全部改进计划）见 [2026-10-01-vs-claude-code-tools.md](./2026-10-01-vs-claude-code-tools.md)**，
> 本节为结论摘要与计划索引。

### 4.1 逐指标判定

| 指标 | CC 表现 | gyc 判定 | 一句话差距 |
|------|---------|----------|-----------|
| **6. 文件操作** | 强：精确 patch，少破坏 | 🟡 中上 | 九级 replacer 链优于 CC，但**无文件级备份**、read **无自动 compaction** |
| **7. Shell 执行** | 强：沙箱内执行 | 🟠 偏弱 | **无沙箱**、**无后台任务**、危险命令**只提示不拦截** |
| **8. Git 集成** | 强：自动 commit、diff 比较 | 🔴 **弱** | **没有 git 工具**、**无自动 commit**、diff 只服务 snapshot 不给模型 |
| **9. 搜索能力** | 强：集成 ripgrep | 🟡 中上 | ripgrep 已接，但**无语义检索**、**无相关度排序** |
| **10. MCP 扩展** | 强：市场成熟 | 🟢 **强** | 5 种传输 + OAuth + resources 齐备，**仅缺市场与断连重连** |
| **11. 多模态** | 中：支持但非强项 | 🟠 偏弱 | 通道通但**只能被动收图**、**无 OCR/截图/浏览器** |

### 4.2 关键实证

**指标 6 — 文件操作**（机制优于 CC）
- `edit` 为九级 replacer 链：`Simple → LineTrimmed → BlockAnchor → WhitespaceNormalized → IndentationFlexible → EscapeNormalized → TrimmedBoundary → ContextAware → MultiOccurrence`（`edit.ts:833-843`）
- 多重匹配**不猜**，全不唯一即报错（`edit.ts:867`）；越界替换拦截 `isDisproportionateMatch`（`edit.ts:870-876`）
- `registry.ts:390-393`：GPT 系走 `apply_patch`、其余走 `edit/write`，二者互斥
- 缺口：无文件级写前备份（`edit.ts:171-187` 仅生成 diff 供审批）；read 仅提示 `Use offset=…` 不自动折叠（`read.ts:398-401`）

**指标 7 — Shell**
- 无沙箱（无容器/命名空间/权限降级）；危险命令 `dangerous` 级（eval、curl|bash、sudo、dd）**只标注不拦截**（`shell/security.ts:65-68`、`shell.ts:824-827`）
- 大日志风险：内存只留最后 `2×maxBytes`（`shell.ts:611,674-679`），更早输出仅存落盘文件，模型不读即永久丢失

**指标 8 — Git 集成（最大短板）**
- `tool/registry.ts:1-41` 与 `core/tool/builtins.ts:5-16` **均无 git 工具**，模型只能靠 bash 敲命令
- 底层 `Git.Service` 完备（`git/index.ts:75-91`）但**不暴露给模型**（消费者仅 worktree/snapshot/project/serve）
- **无自动 commit**：TUI 明确让用户自己去终端提交（`dialog-commit.tsx:185`）
- diff 有实现但不暴露（`snapshot/index.ts:552-570, 572-760`）；pre-commit 五道门禁（`.githooks/pre-commit:6-25`）**AI 无法触发**

**指标 9 — 搜索**
- ripgrep 已接（`core/ripgrep.ts:219-232`）；另有 `fffLayer` trigram 模糊匹配（`core/filesystem/search.ts:130-180`，1.5s 预算）——**CC 没有的差异化能力**
- 缺口：全仓无自有 embedding/向量库；grep/glob 沿用文件顺序**无相关度排序**；`session_search_fts` 搜的是**会话不是代码**且按时间序（`session-search.ts:52-73`）

**指标 10 — MCP（已达标，局部超越 CC）**
- **5 种传输**（stdio/streamable-http/sse/ws/ide，`mcp/index.ts:131,140-154`）；**OAuth + RFC7591 动态注册**（`oauth-provider.ts`、`oauth-callback.ts`）
- resources 完整支持（`index.ts:782-800,843-848`）；`ListMcpResources`/`ReadMcpResource` 已实现（`session/tools.ts:150-152,342-364`）
- 缺口：**无市场目录**（`marketplace/index.json` 仅 2 个示例）、**无断连重连**（`index.ts:499-506` 仅置 failed）、命名冲突仅靠前缀会静默覆盖（`catalog.ts:126-128`）

**指标 11 — 多模态**
- 协议侧齐全（OpenAI Responses / Chat / Gemini inlineData / Bedrock，`openai-responses.ts:318`、`gemini.ts:188,281`、`bedrock-media.ts:74,85`）
- 缺口：**无截图/浏览器工具**（`registry.ts:258-293` 无 screenshot/browser/playwright）、**无 OCR**、**无 PDF 解析**（仅 base64 透传）
- 风险：base64 内联无清理策略，compaction 依赖 `stripMedia`（`message-v2.ts:589`）；工具结果图片对不支持的模型**静默丢弃**（`message-v2.ts:406-411`）

### 4.3 改进计划索引（达到并超越 CC）

完整任务拆解见独立报告，此处为索引：

**P0 阻断级** — 不做则无法在 Git 密集场景与 CC 平权
| # | 事项 | 验收标准 |
|---|------|---------|
| P0-1 | 新增 git 工具族（status/diff/log/commit/branch/stash） | 不经 bash 完成全链路；diff 复用 `snapshot/diffFull` 已有批量比较，不重复实现 |
| P0-2 | 复用 snapshot 影子仓库做每任务自动 commit | 每轮生成可回滚 commit（`snapshot/index.ts:354-362` 现只 `write-tree` 不建 commit 对象，补上） |
| P0-3 | 危险命令从「提示」升为「拦截」 | curl|bash / eval / sudo / dd 默认拒绝，需显式确认 |
| P0-4 | bash 后台任务 + 句柄回收 | 长跑命令可后台化并取回输出/退出码，消除大日志信息丢失 |

**P1 竞争力级**
P1-1 语义检索（**保持纯本地可离线**，调用云端嵌入对本地 CLI 是倒退）· P1-2 搜索相关度排序 · P1-3 read 自动 compaction · P1-4 文件级写前备份 · P1-5 MCP 断连重连 · P1-6 MCP 命名冲突检测 · P1-7 OCR/图片描述工具（不依赖模型原生视觉，让弱模型也能读图且省 token）· P1-8 PDF 解析

**P2 超越级**（CC 也没有）
| # | 事项 | 超越点 |
|---|------|-------|
| P2-1 | MCP 服务器目录/市场 | 做**可审计**市场：标注权限、传输、数据流向；CC 做不到细粒度权限预览 |
| P2-2 | **无头浏览器 + 截图工具** | CC v2.1.285 亦无内置 browser。让 AI **自检 UI**（打开→渲染→截图→视觉分析），CC 当前做不到 |
| P2-3 | 符号级代码搜索 | 复用已有 `lsp` 符号索引，支持「找出所有调用 X 的地方」，CC 默认无此能力 |
| P2-4 | 附件外部存储 + 引用 | gyc 本地存储天然占优（无外传成本），CC 也是 base64 内联 |
| P2-5 | 工具结果媒体的可见降级 | 不支持时**显式告知模型原因**，而非静默过滤（CC 同样静默丢弃） |
| P2-6 | tsc/测试结果结构化注入 | 失败作为可重试的结构化诊断回灌，而非 `Effect.orDie` 升级为 defect（CC 亦犯此错） |

**执行顺序**
```
第一批（对等化）  P0-1 git 工具族 → P0-3 危险命令拦截 → P0-2 自动 commit
第二批（真实可用）P1-3 read compaction → P1-4 文件备份 → P1-1 语义检索 → P1-5/6 MCP 健壮性 → P0-4 bash 后台
第三批（差异化）  P2-2 浏览器+截图（最大超越点）→ P1-7 OCR → P2-1 MCP 市场 → P2-3 符号级搜索 → P1-8 PDF → P2-4/5/6
```

### 4.4 结论

MCP（10）已达 CC 水平甚至局部超越；文件操作（6）机制设计优于 CC；搜索（9）差在语义层。
**真正的短板是 Git 集成（8）——CC 的一项核心能力在 gyc 完全没有对应物**。补齐 P0 三项即可在执行链路维度与 CC 站在同一档；
再补 P2-2（浏览器 + 截图）则是 CC 当前没有的，可形成反超。

> **诚实标注**：本次核查有 3 条未逐行确认，不作为结论依据——`fff` 原生 crate 的排除规则、worktree 是否会话启动时自动创建、`gyccode.json` 与 `~/.config/gyccode/` 的配置解析顺序。

---

## 五、Claude Code v2.1.285 能力快照（重采）

采集时间 2026-09-30，版本 `2.1.285`，commit `afb212976052`，平台 win32-x64，`claude doctor` 报 "No installation issues found"。

### 5.1 内置工具：43 个 schema

```
Agent, Artifact, AskUserQuestion, Bash, ClaudeDesign, CronCreate, CronDelete,
CronList, EnterPlanMode, EnterWorktree, ExitPlanMode, ExitWorktree, FileEdit,
FileRead, FileWrite, Glob, Grep, ListMcpResources, Mcp, Monitor, NotebookEdit,
Projects, ProposeGoal, ProposeSkills, PushNotification, ReadMcpResource,
ReadMcpResourceDir, ReadNotifications, RefreshMcpTools, RemoteTrigger,
ReportFindings, ScheduleWakeup, SendFeedback, ShowOnboardingRolePicker,
TaskCreate, TaskGet, TaskList, TaskStop, TaskUpdate, TodoWrite, WebFetch,
WebSearch, Workflow
```

> 数据源：`node_modules/@anthropic-ai/claude-code/sdk-tools.d.ts:11-55`（`ToolInputSchemas` 联合类型），随包发布的 JSON Schema 生成物。

**gyc 独有的**：`swarm`（并行团队）、`peer_send` / `peer_read`（跨会话通信）、`tool_search`（运行时搜工具）、`lsp`（符号跳转）、`patch`（apply_patch）。
**CC 独有且命中三指标的**：`TaskCreate/Get/Update/List`（→ C-01）、`Workflow`（→ 4.3）、`ReportFindings`、`ProposeSkills`、`Monitor`、`RemoteTrigger`、`Artifact`。

### 5.2 成本与预算控制（③ 的正面差距）

| 能力 | CC v2.1.285 | gyc |
|---|---|---|
| **硬预算闸门** | `--max-budget-usd <amount>`：超支即停 | **无** |
| 成本遥测 | `total_cost_usd` / `modelUsage` / `cache_5m`+`cache_1h` 分档 | session 表 6 列，仅 TUI 可见 |
| 子代理归集 | `subagent_stats`（见 C-02） | **无** |
| 拒绝事件 | `permission_denials` 结构化记录 | **无** |
| 轮次/时长 | `num_turns` / `duration_ms` / `duration_api_ms` / `iterations` | **无** |
| 终止原因 | `terminal_reason` / `stop_reason` / `is_error` / `subtype` | **无** |
| 降级记账 | `fallback_credit` / `--fallback-model` | 无 |
| **缓存复用优化** | `--exclude-dynamic-system-prompt-sections`：把 cwd/env/memory/git status 从系统提示移到首条用户消息，跨用户复用 prompt cache | 无对应物 |
| **系统提示词录制** | `--system-prompt-snapshot on\|off`：一次渲染、逐字复用，压缩前不变 | 无对应物 |
| 缓存漂移自愈 | `--autocompact <auto\|tokens>` 可调窗口 | 阈值硬编码（`compaction.ts:52` = 0.9） |

> 最后两行是 ③ 的**最高杠杆差距**：gyc 为省 token 冻结截断决策（`message-v2.ts:147-156` `freezeDecision`，表定义在 `:140`）以稳 prompt cache；CC 走的是相反方向 —— **牺牲一部分静态前缀换取跨用户/跨会话的缓存复用**，且把「证据截断」和「缓存命中」当成两个可分别调节的旋钮。

### 5.3 流程编排

CC 的 `WorkflowInput`（`sdk-tools.d.ts:2848-2879`）：

```
script           自含工作流脚本，须以 export const meta = { name, description, phases } 开头，
                 正文用 agent() / parallel() / pipeline() / phase()
name             预定义工作流（内置或 .claude/workflows/）
args             暴露为全局 args
scriptPath       磁盘脚本路径；每次调用的脚本会持久化到会话目录并返回路径，便于迭代
resumeFromRunId  从先前 Run ID 续跑；已完成的 agent() 调用若 (prompt, opts) 未变则
                 立即返回缓存结果，只有被编辑或新增的调用才重跑
```

**gyc 已有 workflow_run 表与 `gyc workflow defs|start`**（`schema.gen.ts:272-274`、`cli/cmd/workflow.ts:27,55`），但 `resumeFromRunId` 这种「按 (prompt, opts) 键做结果级缓存」的续跑语义未见实现。**这是 ①③ 兼顾的一项高价值补齐点**：任务重试不再从零烧 token。

### 5.4 权限与沙箱

| 能力 | CC v2.1.285 |
|---|---|
| 权限模式 | 6 种：`acceptEdits` / `auto` / `bypassPermissions` / `manual` / `dontAsk` / `plan` |
| **`--restricted`** | 剥离 Bash / PowerShell / REPL / WebFetch 等执行类工具，文件工具限制在工作目录内，拒绝 bypassPermissions，配置文件写入需人工批准 |
| `--safe-mode` | 关闭全部自定义（CLAUDE.md / skills / plugins / hooks / MCP / 命令 / agents），保留内置能力与鉴权 |
| `--bare` | 最小模式，跳过 hooks / LSP / 插件同步 / 自动记忆 / 密钥链读取 |
| 白名单 | `--allowedTools "Bash(git *)" Edit` / `--disallowedTools` 支持前缀级模式匹配 |
| 无人值守 | `--permission-prompts none`：本该询问的一律拒绝，不阻塞 |

> **对 gyc 的意义**：`--restricted` 这类「白名单化 + 工作目录围栏 + 拒绝降级」的组合，正是 `GAP-08-23 L81` 判定的「等保 3 级入侵防范合规风险」的对症解法。gyc 现有的是 `Permission.ask` 逐次询问（`src/gyccode/tool/tools.ts:95-103`），没有模式枚举、没有围栏、没有无人值守拒绝策略。

### 5.5 必须纠正的两处历史结论

| 出处 | 原结论 | 源码事实 |
|---|---|---|
| `GAP-08-23 L65` | Claude Code 有反思复盘循环，gyc **无** | **gyc 有。** `src/gyccode/session/goal.ts:11-12,170,234-258` 独立低温 LLM 判官 + 结构化裁决，且已接入 `prompt.ts:1919-1922` |
| `GAP-08-23 L48-49` | gyc 缺流程编排引擎 | **gyc 有。** `schema.gen.ts:272-274` 的 `workflow_run` 表（含 `status`/`current_step_index`/`steps`/`error`）+ `cli/cmd/workflow.ts:27,55` 的 `defs`/`start` 子命令 |

**这两条要改口径** —— 否则会照着过期结论去重复实现已有能力。

---

## 附录 A · P0/P1/P2 总表

| ID | 优先级 | 位置 | 影响 | 一句话 | 验收 |
|---|---|---|---|---|---|
| S-01 | P0 | `session/prompt.ts:1678` | ①③ | 主 agent `maxSteps = Infinity`，无步数上限 | 循环任务在有限步内终止 |
| S-02 | P0 | `core/session/runner/max-steps.ts:1-16` | ①② | 仓库内提示词模板冒充系统指令，已实证劫持子代理 | 读该文件不改变子代理行为 |
| S-03 | P0 | `session/prompt/default.txt:56-57` | ① | 零自动验证回路，typecheck 靠提示词自觉 | 写错类型 2 轮内自动修复 |
| H-01 | P0 | `session/prompt/gpt-astra.txt:1-46` | ② | gpt-6 系无 Accuracy 段，且禁止声明不确定 | 8 文件一致性断言通过 |
| H-02 | P0 | `session/compaction.ts:48-49,429-431` | ② | 证据静默截 2K 并覆盖写回，永久不可恢复 | 截断文本含「还剩多少」 |
| H-03 | P0 | `session/message-v2.ts:99-103` | ② | read/grep/glob 硬顶 2K，3000 行只 seen 40 行 | 截断统计被实际消费 |
| H-04 | P0 | `tool/grep.ts:33` | ② | 内容搜索返回 "No files found" | 回执不含该文案 |
| C-01 | P0 | `core/database/schema.gen.ts:182-213` | ③ | 无 task 实体 | `gyc task list` 可汇总 |
| C-02 | P0 | `core/session/projector.ts:92-113` | ③ | 子代理成本不进父会话 | 父 ≥ 父子之和 90% |
| C-03 | P0 | `provider/provider.ts:1534-1541` | ③ | 自建端点定价恒 0，且 0 兼表「免费」 | 配价后 cost 正确 |
| S-04 | P1 | `tool/tool.ts:147` | ① | `orDie` 吞掉参数纠正提示 | 错参返回 schema 提示 |
| S-05 | P1 | `tool/edit.ts:686-741` | ① | 50% 行相似即接受，可能改错位置 | 相似函数拒绝替换 |
| S-06 | P1 | `tool/read-cache.ts:15` | ① | 200 条 LRU 误拦合法编辑 | 长会话不误拦 |
| H-05 | P1 | `session/compaction.ts:39` | ①② | 只保护 skill，事实证据先被清 | read/grep 纳入保护 |
| H-06 | P1 | `session/prompt/anthropic.txt:3-7` | ② | 「别假设库存在」漏掉 claude 全系 | 主力模型有该约束 |
| C-04 | P1 | `session/session.ts:387-391` | ③ | 无账单对账 | 有差异报表 |
| C-05 | P1 | `core/session/projector.ts:361,379,402` | ③ | 无成功标记；`sign=-1` 回退致成本不稳定 | 成本 append-only |
| C-06 | P1 | `session/session.ts:333-405` 等三处 | ③ | 三套计价口径不同源 | stats 自校验通过 |
| C-07 | P1 | `tui/component/dialog-cost.tsx:86-105` | ③ | 真缓存命中率不落库，被假指标遮住 | 命中率进 stats |
| S-07 | P2 | `session/instruction.ts:28` | ① | 压缩后已读状态重置 | 压缩后不重复注入 |
| H-07 | P2 | `memory/dream.ts:165-173` | ② | 检测只覆盖记忆文件，正则误报 | 覆盖代码输出 |
| C-08 | P2 | `session/compaction.ts:743` | ③ | 压缩成本未剔除；缓存锚点重启丢失 | 压缩成本可单列 |
| C-09 | P2 | `cli/cmd/export.ts:288` | ③ | 导出非成本账，无 task 维度 | 导出含 task 成本 |

**P0 合计 10 条**（S 3 + H 4 + C 3）。建议修复顺序：**S-02 → C-02 → C-03 → H-04 → S-01 → H-01 → H-02 → H-03 → S-03 → C-01**。
理由：S-02 正在污染其余一切测量，先修；C-02/C-03 是「每任务成本」恒为下限的根因，不修则 ③ 永远算不出数；H-04 是一行文案改动、收益最直接；S-01 与成本无上限互为因果。

---

## 附录 B · Claude Code v2.1.285 采集原始记录

```
$ claude --version
2.1.285 (Claude Code)

$ claude doctor
Running: npm-global (2.1.285)
Commit: afb212976052
Platform: win32-x64
Path: C:\Program Files\nodejs\node_modules\@anthropic-ai\claude-code\bin\claude.exe
Search: OK (bundled)
Auto-updates: enabled / Auto-update channel: latest
No installation issues found.

$ claude --tools "Bash,Edit,Read,__nope__" -p "reply OK" --output-format json
返回体含 subagent_stats / total_cost_usd / modelUsage / usage.cache_* /
permission_denials / num_turns / duration_ms / duration_api_ms /
terminal_reason / stop_reason / is_error / subtype / iterations /
fallback_credit / fast_mode_state —— 本机未登录鉴权，返回 api_error 403，
但字段结构完整，可直接用于 schema 对比

包结构：
  bin/claude.exe        <- 原生二进制（主程序）
  sdk-tools.d.ts        <- 169,648 字节 / 4,172 行，工具 JSON Schema 生成物
  cli-wrapper.cjs       <- 4,997 字节
  install.cjs
  （无 cli.js —— 旧版反编译比对法已失效）
```

**升级记录**：2.1.223 → 2.1.285，`npm install -g @anthropic-ai/claude-code@latest`。npm 的 `allow-scripts` 拦截了 `postinstall`（`node install.cjs`），但 `claude --version` 与 `claude --help` 均正常，`doctor` 无安装问题，故无需补跑。

---

## 附录 C · 本报告纠正的过期基线

| 历史文档 | 原文结论 | 本次核实 |
|---|---|---|
| `GAP-08-23 L65` | gyc 无反思复盘循环 | **错**。`session/goal.ts:234-258` 有独立 LLM 判官 |
| `GAP-08-23 L48-49` | gyc 缺流程编排引擎 | **错**。`schema.gen.ts:272-274` + `cli/cmd/workflow.ts` 已有 |
| `GAP-08-23 L105` | 「llm/cache-policy auto（tools+system+tail:2 滚动断点）」 | **存疑**。`src/gyccode/session/llm/` 下无 `cache-policy` 文件（12 个文件已逐一列举） |
| `GAP-08-23 L97` | cost 依赖 provider 返回值，本地无单价表 | **部分过时**。`src/core/models-dev.ts:161-165` 已有 5 分钟 TTL 磁盘缓存 + 编译期快照；`models-mirror/api.json`（8.2MB / 217 provider）含价格字段 |
| `GAP-08-16 L4` | 以 CC v2.1.88 反编译源码为基准 | **已过期 45 天且方法失效**。v2.1.285 为原生二进制 |
| `verify-cli.mjs:799` | 「缓存命中率（镜像新鲜度+编译缓存近似）」 | **命名误导**。真指标在 `tui/component/dialog-cost.tsx:86-105`，见 [C-07] |
| `stability-log.jsonl` | 94 行稳定性记录 | **无效**。末 3 行全为 `alive:false`，巡检空转，24h 结论无数据支撑 |

---

## 附录 D · 未覆盖 / 存疑项

诚实标注，避免下一轮误以为已查完：

| 项 | 状态 |
|---|---|
| `src/gyccode/tool/webfetch.ts` 404/超时时是否返回空内容 | **未取证**。已确认 SSRF 防护完整（`:25-67`），但错误回执语义未查 |
| `src/gyccode/session/prompt.ts:1780-1830` `instructions` 每轮是否真变 | **未取证**。这是决定「dynamic 层是否每轮废掉前缀缓存」的关键变量，直接影响 ③ |
| `src/gyccode/session/llm/` 的真实缓存断点实现位置 | **未定位**。`GAP-08-23 L105` 声称的文件不存在 |
| 子代理是否继承父会话缓存断点 | **未取证** |
| CC 斜杠命令清单 | **无法采集**。需进入交互式会话枚举，本机未登录鉴权（`doctor` 报 403）。已采集 CLI 子命令 18 个 |
| `src/gyccode/tool/*.txt` 工具描述全文质量比对 | **未完成**。已抽 `grep` / `glob` / `websearch` |

---

## 附录 E · 后续章节索引（2026-10-02 追加）

| 章节 | 文件 | 内容 |
|---|---|---|
| **六、Agent 自主性与工程工作流：指标 12~25** | **[2026-10-02-vs-claude-code-metrics-12-25.md](./2026-10-02-vs-claude-code-metrics-12-25.md)** | 自主性（12~16）、工程工作流（17~21）、可靠性与安全（22~25）共 14 项的逐项判定、改进计划与旧结论更新 |

**本轮对本报告的三处实质更正**：

1. **S-01 已修复** —— 主 agent 默认步数上限由 `Infinity` 改为 200（`prompt.ts:111-112,1680-1686`）
2. **§5.4「gyc 没有模式枚举」需再次更正** —— `permission/modes.ts:3` 有 4 模式枚举，但 `resolveAction` **全仓零消费方**（死代码），且 TUI 另有一套互不相连的 `"auto"/"normal"`（`src/tui/context/permission.tsx:5`）。**结论比原文更严重**
3. **§5.5「gyc 有反思复盘循环」需补一层** —— 判官存在但**不闭环**：`bumpReact` 无消费方，裁决不终止主循环

另：CC 基准已自动升级 **v2.1.285 → v2.1.286**（commit `f344a08993bb`，安装路径改为 `%APPDATA%\npm`），`sdk-tools.d.ts` 字节数与 43 工具清单**逐项未变**，本报告附录 B 的工具面结论仍成立。

