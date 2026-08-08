# gyc-code 对标 Claude Code 2.1.88 全面分析与提升措施

日期：2026-08-08 12:30（2026-08-08 晚间重建落盘，dist/冷启动口径已按实测修正）
对标对象：Claude Code 2.1.88 源码（`E:\AI项目备份\Claude Code 源码资料\extracted-source\extracted-source\src`，1884 个 TS 文件 / 47.7 万行）
被对标对象：gyc-code（`C:\Users\谷勇成\gyc-cli`，1297 个 TS/TSX 文件 / 17.8 万行 / dist 142.5MB（2507 文件，重建时点实测，含新增 swarm/MCP/市场代码））
方法：静态代码核查 + 本机实测（Windows / Bun，Claude 侧数字为源码分析值）。每条结论带锚点。

## 〇、总纲：三条硬约束（优先级从高到低）

1. **省 token 极致少（最高优先级）**：一切机制优先为"减少输入/输出 token、维持 prompt cache 命中"服务。
2. **低资源硬件约束**：最终产物必须稳定运行于 **MacBook Air 2015（4GB 内存 / 256GB 老盘 / 无 GPU / Intel 双核 1.6GHz）**，做到不发热、风扇安静、硬件损耗最小。所有提升措施都必须是"低内存、低 CPU、低 IO"的实现。
3. **五维对标**：代码能力 / 性能 / 省 token / 安全 / 并发，在满足前两条的前提下逐项补齐。

---

## 一、规模与技术栈对比

| 维度 | gyc-code | Claude Code 2.1.88 | 结论 |
|------|----------|---------------------|------|
| 源码规模 | 1297 文件 / 17.8 万行 | 1884 文件 / 47.7 万行 | 体量约为 1/3 |
| 运行时 | Bun（`engines: bun>=1.0`）+ Effect 4 + AI SDK | Bun + React/Ink（自研 fork）| gyc 有 Effect/DB 重栈 |
| 打包 | `bun build` splitting → **2507 文件 / 142.5MB（重建实测）** | `bun build` 单文件 → **cli.js 12.4MB** | gyc 体积/IO 差 11 倍且持续膨胀 |
| 持久化 | SQLite（WAL，`cache_size=-64000`=64MB 常驻） | **JSONL append**（无常驻内存、崩溃安全） | Claude 更轻（`database.ts:30` vs `sessionStorage.ts:2572`）|
| 渲染 | Solid + opentui（双 JS heap：TUI worker + server） | Ink fork（cell buffer + patch 合并 + 对象池） | 两者都重，需降级 |
| LLM 协议 | 自研 `@gyccode/llm`（route/protocol）＋默认走 AI SDK `streamText`（重栈） | 自研 claude.ts（api 层，动态 import） | gyc 默认走重栈 |
| 记忆 | hermes-bridge 简单文件桥（已接线，无检索） | memdir 索引 + Sonnet 256-token 选择器 + 时间衰减 | 差距大 |
| 快照 | 每 step 跑 git add --all（大仓库放大器） | 无此机制（靠 transcript + tool-results 落盘） | gyc 磁盘 IO 风险 |

---

## 二、五维对比分析

### 2.1 省 token（最高优先级）

#### 2.1.1 gyc-code 现状（已做得不错的点，保持）

| 机制 | 锚点 | 说明 |
|------|------|------|
| 全局输出截断 | `gyccode/tool/truncate.ts:16-17` | `MAX_LINES=2000` / `MAX_BYTES=50KB`，超限写截断目录回 head/tail 预览 |
| Tool.define 自动包裹截断 | `gyccode/tool/tool.ts:130-144` | 所有工具输出统一过截断，回填 truncated/outputPath |
| read 双层防护 | `gyccode/tool/read.ts:16-17,162-183` | 单行 2000 字符、全文件 50KB、流式提前停 |
| shell 流式折叠 | `gyccode/tool/shell.ts:432-524,563-574` | 边收边丢 + 落盘 + 只回 tail |
| glob/grep limit | `gyccode/tool/glob.ts:49-62`、`grep.ts:67-98` | 固定 100 条 + "Results are truncated" |
| 上下文压缩 compaction | `gyccode/session/compaction.ts` | 尾 2 轮 + 25% recent（2K-8K）+ prune 保护线 40K |
| prompt cache 断点 | `llm/cache-policy.ts:47-96` | auto：最后工具/最后 system/最新 user 三处 CacheHint |
| webfetch 5MB / websearch 截断 | `webfetch.ts:11,140-147`、`websearch.ts:22-24` | 响应上限 + contextMaxCharacters |

#### 2.1.2 与 Claude Code 的核心差距（省 token 主战场）

**差距 T-1【P0】无"落盘 + 2KB 预览 + 引导去 Read"的标准化三层**（Claude `utils/toolResultStorage.ts:137-334`、`constants/toolLimits.ts:13`）
- Claude：工具结果超阈值（默认 50,000 字符）→ 整体落盘（`flag:'wx'` 幂等，L162）→ 给模型 `<persisted-output>` 2KB 预览 + 文件路径 + "用 Read 去读"。这是长会话能跑起来的根基。
- gyc：truncate.ts 有写截断目录 + head/tail 预览，方向正确；但**无"工具级阈值声明"**（`maxResultSizeChars`），且截断仍把 head+tail 全文回传（超大输出仍占上下文），未系统化"落盘替代"。
- 移植成本：~100 行；收益：单工具输出入上下文从 50KB 级降到 2KB 级。

**差距 T-2【P0】无"单条 user 消息聚合预算"**（Claude `toolResultStorage.ts:769-909`，`MAX_TOOL_RESULTS_PER_MESSAGE_CHARS=200_000`）
- N 个并行工具各 40KB 会凑成 400KB 单条消息 → 打爆上下文且全在 cache 前缀内。
- Claude 按 API 层 user 消息分组，超 200K 时**从大到小把 fresh 结果落盘替换**，并用 `ContentReplacementState`（seenIds/replacements，L390-412）**冻结决策**——重放是纯 Map 查表、字节级一致 → **保证 prompt cache 前缀稳定**。
- gyc：无此层。移植成本 ~150 行，收益极大（并行工具场景 token 骤降 + cache 不破）。

**差距 T-3【P0】无 Read 去重（file_unchanged）**（Claude `FileReadTool.ts:523-573`，`prompt.ts:7-8`）
- Claude：同文件同 offset 且 **mtime 未变** → 返回短 stub："File unchanged since last read... refer to that instead of re-reading." 实测约 **18% 的 Read 是重复读**。
- gyc：每次 read 都全量注入。移植成本 ~40 行（一个 Map + 一次 stat），零 API 成本，直接省 token 和内存。

**差距 T-4【P0】无 microcompact（细粒度清旧工具结果）**（Claude `services/compact/microCompact.ts:41-530`）
- Claude：白名单工具（Read/Shell/Grep/Glob/WebSearch/WebFetch/Edit/Write）旧结果可安全删除；**会话空闲**（缓存已冷）时把旧结果替换为 `'[Old tool result content cleared]'`；估算用 ×4/3 保守垫高。
- gyc：只有整段 compaction（1 次 API 调用）和 prune 标记，无"本地、零 API 成本"的微清理。
- 移植成本 ~300 行；收益：长会话本地即可释放 token 与内存，**4GB 机器上同时缓解内存压力**。

**差距 T-5【P1】系统提示词偏大且不随上下文伸缩**（gyc `session/system.ts:60-128`）
- gyc 现状：provider prompt 8-15KB（`anthropic 8.1KB/gemini 15.2KB`）+ skills **verbose 全量列表**（`system.ts:103-109` `Skill.fmt(list,{verbose:true})`）+ MCP instructions **无预算** → 总 20-40KB（≈5-10K token 固定税）。
- Claude：`getSystemPrompt`（`prompts.ts:444-577`）用**静态/动态边界**（`SYSTEM_PROMPT_DYNAMIC_BOUNDARY`，L114-115）+ **按需 section**（compute 返回 null 即过滤）+ **memoize 到 /clear 或 /compact**（`systemPromptSections.ts:20-58`）；动态内容（git status/CLAUDE.md/skill/agent 列表）**移出系统提示词走 attachment delta**（注释：agent 列表曾占 cache_creation 10.2%，改附件后大降）。
- 改进：skills 改精简单行列表、MCP 指令加总长预算、动态内容按需注入。

**差距 T-6【P1】token 估算太粗糙**（gyc `core/util/token.ts:3-5` = `chars/4`）
- Claude `tokenEstimation.ts:203-224`：默认 4 字节/token，**JSON 文件用 2**（密集 JSON 单字符 token 多），图片按 (w×h)/750 上限 2000；`microCompact.ts:203-205` 估算结果 **×4/3 保守垫高**。
- gyc 的 compaction 预算决策完全依赖 chars/4，估算偏差直接导致超窗或过早压缩。移植 ~30 行。

**差距 T-7【P1】compaction prompt 无结构、无 NO_TOOLS 前导、无草稿剥离**（Claude `services/compact/prompt.ts:19-335`）
- Claude：`NO_TOOLS_PREAMBLE`（"Respond with TEXT ONLY... Tool calls will be REJECTED"，防压缩 agent 浪费唯一一轮调工具）+ **9 段结构**（Primary Request / Key Technical Concepts / Files and Code / Errors / All user messages / Pending Tasks / Current Work / Next Step）+ `<analysis>` 草稿区**剥离**（`formatCompactSummary` L311-335，只留 `<summary>`）。
- gyc compaction 有 summary agent，但 prompt 结构无此纪律。移植 ~80 行，摘要质量/体积双优。

**差距 T-8【P1】无路径 relativize**（Claude `GlobTool.ts:165-166`：`files.map(toRelativePath)`）
- 绝对路径 → 相对路径，每条省几十字符。gyc glob/grep 返回绝对路径。移植 1 行。

**差距 T-9【P1】无精炼接续指令与熔断器**（Claude `query.ts:1224-1229`、`autoCompact.ts:70`）
- 接续指令："Output token limit hit. Resume directly — no apology..."（刻意不道歉不复述）。gyc 的 max_tokens 恢复无此措辞。
- 熔断：压缩连续失败 3 次停止重试（`MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES=3`，防每轮白烧 API；Claude 实测 1,279 会话 50+ 连续失败、日浪费 25 万调用）。gyc compaction 无熔断。

**差距 T-10【P1】prompt cache 无"静态/动态边界 + section 缓存 + latch"**（Claude `prompts.ts:114-351`、`claude.ts:358-434`、`bootstrap/state.ts:221-242`）
- Claude 把"随会话变化"的段落全部置于动态边界之后，防前缀哈希碎片化（2^N 变体）；静态前缀用 `scope:'global'` 跨用户缓存；**latch 机制**——AFK/fast-mode/cache-editing/thinking-clear 等选项一旦发出就持续发出，防中途切换破缓存（~50-70K token/次）。
- gyc：cache-policy 只打 3 个断点，无边界分层、无 latch。改进后 Anthropic 场景缓存命中率可显著提升。

**差距 T-11【P1】git status 无截断与快照标注**（Claude `context.ts:36-111`：`git status --short` + 最近 5 条 log，**截断 2000 字符**，注明"快照，不会更新"）
- gyc `session/system.ts` 注入 git 状态无此防护。移植 ~30 行。

**差距 T-12【P1】MCP 无描述/输出双阈值**（Claude `mcp/client.ts:218` `MAX_MCP_DESCRIPTION_LENGTH=2048`、`mcpValidation.ts:16` 输出 25K token 上限 + 0.5× 启发式预筛）
- gyc MCP 工具走 truncate.output 兜底，但无工具描述截断、无"先粗筛后精确"成本控制。

**差距 T-13【P2】TodoWrite 整表覆盖**（gyc `tool/todo.ts:46` + `session/todo.ts:29-51` 先删后插）
- Claude `TodoWriteTool.ts:65-103`：**全完成自动清空**（防无限膨胀）+ 固定极短回复 + 只变化时触发。gyc 每轮全量 JSON 往返。

---

### 2.2 性能与资源占用（MacBook Air 2015 约束）

#### 2.2.1 gyc-code 实测基线（本机 Windows / Bun 1.3.14）

| 场景 | 实测 | 4GB 老 Mac 预估 |
|------|------|----------------|
| `--version` | 2.6s / 峰值 RSS ~182MB | 5-12s+ |
| 空 `run` 启动 | 15.7s / 峰值 RSS ~265MB | 30s+，RSS 更高 |
| dist | 2507 文件 / 142.5MB（重建实测） | 老盘随机读慢 |
| TUI 交互 | 双 JS heap（worker + 主线程） | 常驻 400-700MB，逼近 4GB 上限 |

#### 2.2.2 关键资源风险点（含锚点）

**P-1【P0】全命令静态 import**（`gyccode/index.ts:25-53`）
- 20+ 子命令全部顶层静态 import；`--version` 也要加载 run（含 `@opencode-ai/sdk`）、mcp（含 `@modelcontextprotocol/sdk`）、acp、web（含 `open`）整个命令图。
- Claude 对照：`cli.tsx:37-42` `--version` **零模块加载快路径**（MACRO.VERSION 构建期内联，直接返回）；`cli.tsx:44-274` 所有特殊命令 `await import()` 动态加载（注释："All imports are dynamic to minimize module evaluation for fast paths"）。
- 改进：命令注册改 yargs.command + 动态 import；`--version` 走零依赖快路径。目标 `--version` <500ms。

**P-2【P0】run 实例启动链重**（`gyccode/project/bootstrap.ts:32-46`）
- 启动即做：config 加载 + 全部插件 init + `[lsp, shareNext, format, vcs, snapshot, project]` 并行 init + **同步扫描** tool 目录（`tool/registry.ts:186-189` `Glob.scanSync`）+ **Snapshot 首次 `git add --all` + write-tree**（`snapshot/index.ts:318-347`，大仓库可达分钟级）。
- 改进：非必需服务懒启动；快照首建放后台；tool 扫描改异步。

**P-3【P1】每 LLM step 全工作区 git 快照**（`snapshot/index.ts:235-347` + `processor.ts:102,439,450,475,558`）
- 每个 step 至少 2 次 `git add --all` + 2 次 diff。256GB 老盘 + 大仓库 = 卡顿源。
- 改进：降频（每 N step / 每 N 秒）+ 脏检查去重；或对非 git 仓库跳过。

**P-4【P1】SQLite 固定 64MB cache**（`core/database/database.ts:30` `PRAGMA cache_size = -64000`）
- 4GB 机器上这是固定常驻大头。改进：降 `-16000`（16MB）。另注意 `Session.messages()` 全量分页载入 + `structuredClone(part)`（`session.ts:830-853,641`）——长会话内存线性涨，需配合 T-4/T-2 落盘机制。

**P-5【P1】compose bundle 323KB 静态常驻**（`skill/index.ts:18` → `compose/bundle.gen.ts`）
- 任何模式都随模块加载进内存。改进：动态 `import()`，compose 禁用时不加载。

**P-6【P1】11 个内置 provider 插件启动即加载**（`plugin/index.ts:66-84,168-180`，Codex 插件还初始化 WebSocket 池）
- 对单模型用户是纯启动开销。改进：按配置懒加载。

**P-7【P1】MCP SDK 无条件实例化**（`gyccode/mcp/index.ts`）——无 MCP 配置时跳过服务创建。

**P-8【P2】dist 2507 文件随机 IO（重建实测，较上午 804 文件膨胀 3 倍）**（`build.mjs:4-15` splitting 拆太碎）——提高最小 chunk 尺寸、wasm/scm 移出主入口。

**P-9【P2】流式逐语义边界写 SQLite**（`processor.ts:300-306,520-526`）——事件投影每 step 8-15 次写事务；双核老 CPU 上可节流/批量。text-delta 不落盘（好设计，保持）。

> Claude 侧可借鉴：**JSONL append transcript**（`sessionStorage.ts:2572-2584`）替代 SQLite 常驻；启动预取承诺模式（`setup.ts:308-381`，`void` 后台初始化）；采样 profiler（`startupProfiler.ts`，非采样用户零开销）；cell buffer 渲染（`ink/screen.ts`，对象池 + patch 合并）——渲染层整套 React/Yoga 太重，**只移植"行数组增量 diff + patch 合并"思想**。

---

### 2.3 代码能力

#### 2.3.1 gyc-code 已有（强项，保持）

- 工具系统：19 内置工具 + MCP 动态工具 + 插件工具，统一 Effect Schema（`llm/tool.ts:15,133-206`），`Tool.define` 提升解码闭包（性能意识）。
- LLM 循环：流式 + 指数退避重试（429/5xx）+ AbortController 贯穿 + 工具自修复（`experimental_repairToolCall`）+ doom-loop 防护（3 连触发权限询问）。
- subagent：独立子 session 隔离 + 深度限制 + 权限继承收窄 + 后台 resume（`tool/task.ts`）。
- MCP：stdio/SSE/StreamableHTTP 三传输 + OAuth + 资源工具。
- skill 发现：多路径 + 权限过滤 + ripgrep 采样文件清单（`skill/index.ts:184-256`）。
- compaction/prune：完整（见 2.1.1）。

#### 2.3.2 差距

**C-1【P1】跨会话记忆无检索、无注入**（`gyccode/memory/hermes-bridge.ts`）
- 现状：简单文件桥（`§` 分块 + 正则 tag），已接线到 `gyc memory read/write/sync` 命令（上轮 `~` bug 已修），但**没有注入 system prompt、没有在 agent 循环中检索**，无相关度选择、无时间衰减、无自动提取。
- Claude 对照（`memdir/findRelevantMemories.ts:39-141`）：扫 frontmatter（只读每文件前 30 行、上限 200）→ 清单 → **sideQuery 调模型 max_tokens:256 选 ≤5 个** → 过滤最近已用工具文档；`memoryAge.ts:15-42` **给旧记忆贴"过时警告"而非删除**。
- 改进：低成本版 = MEMORY.md 索引 + 256-token 选择器 + 时间衰减警告，全部文件操作、无状态服务。对 4GB 机器友好。

**C-2【P1】Composer 空壳死代码**（`gyccode/composer/index.ts:17-46`）
- `listSkills()` 返回硬编码数组；写入 `.hermes/plans/`（与真实 plan 机制 `.gyccode/plans/` 脱节）。真实工作流靠 skill 包 + compose agent 提示词驱动（`skill/compose/` 已存在）。
- 改进：删除 Composer 类或接真实 discovery（`skill/discovery.ts`），避免误导。

**C-3【P2】无计划文件工具**——plan 模式靠模型自觉用 write/edit 维护（`session/reminders.ts:41-104`）。Claude 有 ExitPlanModeTool + TodoWrite 计划闭环。低成本版：加 `plan_write/plan_read` 工具或复用 todo。

**C-4【P1】无工具级声明契约**（Claude `Tool.ts:362-557`：`isConcurrencySafe` / `isReadOnly` / `shouldDefer` / `maxResultSizeChars` / `backfillObservableInput`）
- gyc 的截断是"外层统一包裹"，缺少工具自声明；`shouldDefer`（延迟工具 schema 不进入初始 prompt）能省大量工具描述 token。低成本版：为 2-3 个重量级工具加 shouldDefer + ToolSearch 替代。

**C-5【P2】agent fork 共享 cache / 只读 agent 瘦身**（Claude `runAgent.ts:390-410`）
- Explore/Plan 只读代理剔除 CLAUDE.md（省 5-15 Gtok/周）与 gitStatus（省 1-3 Gtok/周）。gyc 的 explore subagent 未做此瘦身。低成本：agent 类型增加"注入规则集"开关。

**C-6【P2】skill frontmatter token 统计**（Claude `loadSkillsDir.ts:100-105` 只统计 frontmatter，正文按需加载）——gyc `Skill.fmt(...,{verbose:true})` 全量注入，见 T-5。

---

### 2.4 安全

#### 2.4.1 gyc-code 已有（强项，保持）

- 权限模型：默认 ask，allow/deny/always/reject 级联（`permission/index.ts:28-38,67-151`）；doom-loop 二次确认。
- 文件系统：external-directory realpath 防 symlink 逃逸（`external-directory.ts:16-53`）；ignore/protected 目录（`core/filesystem/ignore.ts:3-48`、`protected.ts:35-51`）。
- webfetch SSRF：私网/回环/云元数据黑名单 + **DNS rebinding 二次校验（上轮死代码 bug 已修复，现位于正确分支）** + 5MB 上限 + 30s 超时 + 强制 ask 权限（`webfetch.ts:60-91`）。
- server：无密码仅 loopback，非回环强制密码（`serve.ts:17-23`）；Basic Auth（`server/auth.ts:17-34`）。

#### 2.4.2 差距

**S-1【P0】bash 无真正沙箱、命令注入防护是启发式**（`gyccode/tool/shell.ts:263-330,391-404`）
- 现状：命令原样交给 shell（无沙箱），靠 tree-sitter 静态解析路径 + 前缀 pattern 权限确认；对 `$()`、反引号、别名、复杂管道会漏判（`dynamic()` 判定后跳过路径收集）。
- Claude 对照（`BashTool/bashSecurity.ts` 2800+ 行）：命令替换/输入输出重定向/IFS 注入/`/proc/*/environ`/ANSI-C 引号混淆/CR 解析差异攻击/git commit -m 注入等多阶段 validator，`allow→passthrough→ask` 三态，破坏性命令警告（`destructiveCommandWarning.ts`：`git reset --hard`/`rm -rf`/`DROP TABLE`），危险路径（`pathValidation.ts`：`rm -rf /` 永远 ask、`--` 结尾处理）。
- 改进：移植核心 5-6 个 validator（命令替换/重定向/IFS/CR 差异/git commit 注入）+ 破坏性命令警告 + 危险路径，砍掉 ant-only 分类器。

**S-2【P1】日志/权限 metadata 未脱敏**（`shell.ts:394,403` 把命令串写进日志与权限 payload）
- 若命令含密钥（`export KEY=...`、`curl -H "Authorization: ..."`）会泄露到日志/LLM 上下文。
- Claude 对照（`teamMemorySync/secretScanner.ts:312-316` gitleaks 风格 regex、`bridge/debugUtils.ts:26-32` 保留前 8 后 4）。移植 ~50 行。

**S-3【P1】子进程 env 未剥离 API key**（Claude `utils/subprocessEnv.ts:17` 明确从 Bash 工具环境剥离 `ANTHROPIC_API_KEY`，防 shell 展开泄露）。gyc 的 shell 子进程会继承 process.env（含已加载的 API key）。

**S-4【P1】server 无密码时零认证**（`serve.ts:17-23` + `middleware/authorization.ts:101-116`）——仅靠 loopback 绑定；共享机器上 `--hostname 0.0.0.0` 忘设密码即裸奔。改进：默认生成随机密码或强确认。

**S-5【P1】edit 全量读无大小上限**（`tool/edit.ts:126` 整读，上轮 P1-6 未修）——stat 预检，超阈值（如 5MB）fail 并提示。

**S-6【P2】API key 文件权限未校验**（`.gyc/.env` 读取未 chmod 检查）——Claude 策略/transcript 文件 `mode:0o600`。

---

### 2.5 并发

#### 2.5.1 gyc-code 已有（强项，保持）

- SQLite：WAL + synchronous=NORMAL + busy_timeout=5000 + Semaphore(1) 串行 + 事件投影事务内幂等（`core/database/sqlite.bun.ts:121-130`、`database.ts:27-32`、`core/event.ts:239-352`）——无 "database is locked" 竞态。
- 会话并发：按 session 串行、跨 session 并行 + run-coordinator 同 key 合并（`core/session/run-coordinator.ts:24-104`）；server 端同目录并发 load 合并（`instance-store.ts:43,108-124`）。

#### 2.5.2 差距

**N-1【P0】工具并发无闸**（`session/llm.ts:276-345` streamText 未限并发）
- 单 step 内多个 tool call 并行 spawn 多个 shell 子进程 + 各自 tree-sitter 解析 + SQLite 写。**4GB 老 Mac 上会瞬间吃满内存/CPU/IO**。
- Claude 对照：`toolOrchestration.ts:91-116` 按"连续只读块（可并发）+ 单个非只读（串行）"分区，上限 `CLAUDE_CODE_MAX_TOOL_USE_CONCURRENCY` 默认 10。gyc 改进：加全局工具并发闸（max 2-3）+ 只读块分区。

**N-2【P1】事件/SSE 队列全无界**（`core/event.ts:174-178` PubSub.unbounded + `handlers/event.ts:31` Queue.unbounded）
- 多客户端 + 高事件率下内存膨胀。改 `Queue.dropping`（参考 `core/event.ts:152-164` 已有 allBounded 先例）。

**N-3【P1】双 JS heap TUI**（`cli/cmd/tui.ts:210` worker + 主线程）——4GB 机器上交互模式内存峰值主因。降级方案：非 TTY / 轻量模式单 heap；限制并发 session ≤2。

**N-4【P2】JSONL 替代 SQLite 的评估**（Claude `sessionStorage.ts:2572-2584`）
- JSONL append 天然并发安全（OS 原子 append）、无常驻内存、崩溃安全。gyc 已深度依赖 SQLite（todo/session/event 投影），**不建议短期替换**；但可在"低内存模式"下评估（P2 远期）。

---

## 三、差距分级汇总

| 级别 | 编号 | 差距 | 锚点（gyc） | 参考（Claude） |
|------|------|------|-------------|----------------|
| P0 | T-1 | 无落盘+2KB 预览三层 | `tool/truncate.ts:16` | `toolResultStorage.ts:137-334` |
| P0 | T-2 | 无消息级聚合预算+决策冻结 | `session/processor.ts` | `toolResultStorage.ts:769-909` |
| P0 | T-3 | 无 Read 去重 | `tool/read.ts` | `FileReadTool.ts:523-573` |
| P0 | T-4 | 无 microcompact | `session/compaction.ts` | `microCompact.ts:41-530` |
| P0 | P-1 | 全命令静态加载启动慢 | `index.ts:25-53` | `cli.tsx:37-42,44-274` |
| P0 | P-2 | run 启动链重 | `project/bootstrap.ts:32-46` | `setup.ts:308-381` |
| P0 | N-1 | 工具并发无闸 | `session/llm.ts:276-345` | `toolOrchestration.ts:91-116` |
| P0 | S-1 | bash 无沙箱/注入启发式 | `tool/shell.ts:263-330` | `BashTool/bashSecurity.ts` |
| P1 | T-5 | 系统提示词偏大 | `session/system.ts:60-128` | `prompts.ts:444-577` |
| P1 | T-6 | token 估算粗糙 | `core/util/token.ts:3-5` | `tokenEstimation.ts:203-224` |
| P1 | T-7 | compaction prompt 无结构 | `session/compaction.ts` | `compact/prompt.ts:19-335` |
| P1 | T-8 | 无路径 relativize | `tool/glob.ts` | `GlobTool.ts:165` |
| P1 | T-9 | 无接续指令/熔断器 | `session/retry.ts` | `query.ts:1224-1229`、`autoCompact.ts:70` |
| P1 | T-10 | prompt cache 无边界/latch | `llm/cache-policy.ts` | `prompts.ts:114-351`、`claude.ts:358-434` |
| P1 | T-11 | git status 无截断 | `session/system.ts` | `context.ts:36-111` |
| P1 | T-12 | MCP 无描述/输出阈值 | `mcp/catalog.ts` | `mcp/client.ts:218`、`mcpValidation.ts:16` |
| P1 | P-3 | 每 step git 快照 | `snapshot/index.ts:235-347` | —（无此机制） |
| P1 | P-4 | SQLite 64MB 常驻 | `core/database/database.ts:30` | `sessionStorage.ts:2572` |
| P1 | P-5 | compose bundle 静态常驻 | `skill/index.ts:18` | 动态 import 惯例 |
| P1 | P-6 | 插件启动全加载 | `plugin/index.ts:66-84` | 按需加载 |
| P1 | P-7 | MCP 无条件实例化 | `gyccode/mcp/index.ts` | 按需 |
| P1 | C-1 | 跨会话记忆无检索注入 | `memory/hermes-bridge.ts` | `memdir/findRelevantMemories.ts` |
| P1 | C-2 | Composer 空壳死代码 | `composer/index.ts:17-46` | — |
| P1 | S-2 | 日志未脱敏 | `tool/shell.ts:394,403` | `secretScanner.ts:312-316` |
| P1 | S-3 | 子进程 env 未剥离 key | `tool/shell.ts` | `subprocessEnv.ts:17` |
| P1 | S-4 | server 无密码零认证 | `serve.ts:17-23` | 强确认 |
| P1 | S-5 | edit 无大小上限 | `tool/edit.ts:126` | `FileEditTool` |
| P1 | N-2 | 队列无界 | `core/event.ts:174-178` | 有界/丢帧 |
| P1 | N-3 | TUI 双 heap | `cli/cmd/tui.ts:210` | 单进程降级 |
| P2 | T-13 | TodoWrite 整表覆盖 | `tool/todo.ts:46` | `TodoWriteTool.ts:65-103` |
| P2 | P-8 | dist 2507 文件随机 IO | `build.mjs:4-15` | 单文件 12.4MB |
| P2 | P-9 | 流式逐事件写 DB | `processor.ts:300-306` | 节流 |
| P2 | C-3/C-4/C-5/C-6 | 计划工具/工具契约/agent 瘦身/frontmatter | 见 2.3.2 | `Tool.ts:362-557` 等 |
| P2 | S-6 | key 文件权限 | `index.ts:9-20` | `mode:0o600` |
| P2 | N-4 | JSONL 远期评估 | — | `sessionStorage.ts:2572` |

---

## 四、提升措施（按优先级执行）

> 全部措施以"省 token 极致少"为第一目标、以"4GB 老 Mac 稳定运行"为硬约束。每项给出：改动点 / 参考 / 资源代价 / 收益。

### 阶段 0：省 token（P0，最高优先级）

**措施 0.1 工具输出落盘 + 2KB 预览三层（对标 T-1）**
- 改动：`gyccode/tool/truncate.ts` + `tool/tool.ts`——超阈值（建议 20K-50K 可配）整体写盘（`flag:'wx'` 幂等），回传 `<persisted-output>` 2KB 预览 + 文件路径 + "用 Read 继续读"指引。
- 参考：Claude `toolResultStorage.ts:137-334`、`toolLimits.ts:13`（阈值 50K、预览 2KB）。
- 代价：~100 行纯 IO/字符串。收益：单工具入上下文 50KB→2KB；内存同步下降（4GB 刚需）。

**措施 0.2 单条 user 消息聚合预算 + 决策冻结（对标 T-2）**
- 改动：`session/processor.ts`——按 API user 消息分组，超 200K（老机器建议 100K）从大到小落盘替换 fresh 结果；用 seenIds+replacements 冻结决策、重放走 Map（保 cache 前缀字节一致）。
- 参考：Claude `toolResultStorage.ts:769-909`（ContentReplacementState L390-412）。
- 代价：~150 行。收益：并行工具场景 token 骤降 + cache 不破。

**措施 0.3 Read 去重 file_unchanged（对标 T-3）**
- 改动：`gyccode/tool/read.ts`——按 (path, offset, limit, mtime) 缓存最近读，命中返回短 stub "File unchanged since last read..."。
- 参考：Claude `FileReadTool.ts:523-573`（省 ~18% 重复读）。
- 代价：~40 行 + 一个 LRU Map。收益：零 API 成本直接省 token。

**措施 0.4 microcompact 本地清旧结果（对标 T-4）**
- 改动：`session/compaction.ts`——白名单工具旧结果、会话空闲（或距上条 assistant 超阈值）时替换为 `[Old tool result content cleared]`；估算 ×4/3 垫高。
- 参考：Claude `microCompact.ts:41-530`。注意：**跳过 ant-only 的 cache_edits 版**，只做纯本地版。
- 代价：~300 行。收益：长会话不炸 + 4GB 内存缓解。

**措施 0.5 系统提示词瘦身 + 按需注入（对标 T-5）**
- 改动：`session/system.ts`——skills 改精简单行（title+desc）；MCP instructions 加总长预算（如 4KB）；provider prompt 按模型上下文窗口裁剪；动态内容（git status/日期）维持最小。
- 参考：Claude `prompts.ts:444-577`、`systemPromptSections.ts:20-58`。
- 代价：~60 行。收益：固定税 20-40KB → 目标 <12KB（省 2K-7K token/轮）。

**措施 0.6 token 估算升级（对标 T-6）**
- 改动：`core/util/token.ts`——`chars/4` 基础 + JSON 用 `chars/2` + 图片 (w×h)/750 + 结果 ×4/3 垫高。
- 参考：Claude `tokenEstimation.ts:203-224`。代价：~30 行。收益：compaction 预算决策更准。

**措施 0.7 compaction prompt 纪律化（对标 T-7）**
- 改动：`session/compaction.ts`——加 NO_TOOLS 前导（压缩 agent 禁工具）+ 9 段结构 + `<analysis>` 草稿剥离只留 `<summary>`。
- 参考：Claude `compact/prompt.ts:19-335`。代价：~80 行。收益：摘要质量/体积双优。

**措施 0.8 路径 relativize + git status 截断（对标 T-8/T-11）**
- glob/grep 结果 `toRelativePath`（1 行）；git 状态截断 2000 字符 + "快照"标注（~30 行）。

**措施 0.9 接续指令 + compaction 熔断器（对标 T-9）**
- max_tokens 恢复消息改精炼措辞（1 行）；compaction 连续失败 3 次熔断（~5 行）。

**措施 0.10 prompt cache 静态/动态边界 + latch（对标 T-10，依赖 Anthropic/Bedrock）**
- `llm/cache-policy.ts` + `session/system.ts`：静态前缀/动态后缀分层；可变选项（effort/thinking 等）latch 不中途切换。
- 代价：~100 行。收益：Anthropic 场景缓存命中率显著提升（省 cache_creation）。

**措施 0.11 MCP 描述/输出双阈值（对标 T-12）**：工具描述截断 2048、输出 25K token 上限 + 0.5× 启发式预筛。~50 行。

**措施 0.12 TodoWrite 增量 + 自动清空（对标 T-13）**：改增量 diff、全完成自动清空。~30 行。

### 阶段 1：低资源适配（P0，MacBook Air 2015 稳定运行）

**措施 1.1 命令图懒加载 + --version 快路径（对标 P-1）**
- 改动：`gyccode/index.ts`——子命令改 `yargs.command` + handler 内 `await import()`；`--version` 走零依赖快路径（构建期内联版本号）。
- 参考：Claude `cli.tsx:37-42,44-274`。目标：`--version` <500ms（老 Mac）、空 `run` <10s。

**措施 1.2 启动链瘦身（对标 P-2）**
- `project/bootstrap.ts`：非必需服务（lsp/shareNext/format/vcs）改后台/按需；tool 目录同步扫描改异步；Snapshot 首建放后台。参考 Claude `setup.ts:308-381` 预取承诺。

**措施 1.3 快照降频（对标 P-3）**：每 N step（如 3）或每 30s 一次 git 快照 + 脏检查；非 git 仓库跳过。老盘 IO 大头，必做。

**措施 1.4 SQLite cache 降 16MB（对标 P-4）**：`database.ts:30` `-64000 → -16000`。同步给 `Session.messages()` 分页加窗口上限（配合 0.1/0.2 落盘机制）。

**措施 1.5 解除静态常驻（对标 P-5/P-6/P-7）**：compose bundle 动态 import；provider 插件按配置懒加载；无 MCP 配置时不实例化 MCP 服务。

**措施 1.6 dist 收敛（对标 P-8）**：`build.mjs` 提高最小 chunk 尺寸（减少 2507 文件）、wasm/scm 移出主入口；目标 dist <40MB、文件数 <300。

**措施 1.7 工具并发闸（对标 N-1，同时是 4GB 刚需）**：全局并发上限 2-3 + 只读块并行/写串行分区。参考 Claude `toolOrchestration.ts:91-116`。

**措施 1.8 TUI 轻量模式（对标 N-3）**：非 TTY / 低内存模式单 heap、16ms 合帧保持、限制并发 session ≤2；可选"极简文本模式"（参考 Claude SIMPLE 模式：只给 Bash/Read/Edit 三工具，`tools.ts:273-298`）。

### 阶段 2：代码能力补强（P1）

**措施 2.1 跨会话记忆检索（对标 C-1）**：MEMORY.md 索引 + 256-token 选择器 + 时间衰减警告 + 会话结束 fire-and-forget 提取。全部文件操作，无状态服务。
**措施 2.2 删除 Composer 空壳（对标 C-2）**：`composer/index.ts` 死代码删除或接真实 discovery；修正 README 声明。
**措施 2.3 计划文件工具（对标 C-3）**：低成本 `plan_write/plan_read`（或复用 todo），补 plan→build 闭环。
**措施 2.4 工具契约声明（对标 C-4，P2 起步）**：先为 read/bash/websearch 加 `maxResultSizeChars` 与 `isReadOnly` 声明，供并发分区与落盘复用。
**措施 2.5 只读 agent 瘦身（对标 C-5）**：explore/plan agent 剔除 CLAUDE.md 与 gitStatus 注入。

### 阶段 3：安全补强（P1）

**措施 3.1 bash 安全 validator 核心移植（对标 S-1）**：命令替换/重定向/IFS/CR 差异/git commit 注入 5-6 个 validator + 破坏性命令警告 + 危险路径（`rm -rf /` 永远 ask、`--` 处理）。纯正则/状态机，无重依赖。
**措施 3.2 日志与权限 payload 脱敏（对标 S-2）**：gitleaks 风格 regex 库，命令串在进日志/权限 metadata 前脱敏（保留前 8 后 4）。
**措施 3.3 子进程 env 剥离 API key（对标 S-3）**：shell 子进程从 env 中移除已加载的 provider key。
**措施 3.4 server 默认密码或强确认（对标 S-4）**；edit 大小预检（S-5）；key 文件权限 0o600（S-6）。

### 阶段 4：并发与稳定性（P1-P2）

**措施 4.1 有界事件/SSE 队列（对标 N-2）**：`Queue.dropping`（复用 allBounded 先例）。
**措施 4.2 流式 DB 写节流（对标 P-9）**：语义边界事件批量/节流落库。
**措施 4.3 JSONL 远期评估（对标 N-4，P2）**：记录在案，不在本期动 SQLite 骨架。

---

## 五、验收标准与量化目标

### 5.1 省 token（最高优先，可量化）

| 指标 | 当前 | 目标 |
|------|------|------|
| 单工具输出入上下文 | 50KB 级 | ≤2KB 预览 + 落盘路径 |
| 系统提示词固定税 | 20-40KB | ≤12KB |
| 重复 Read 入上下文 | 存在（无去重） | 0（file_unchanged stub） |
| 单条消息工具结果 | 无上限 | ≤100K（超则落盘） |
| 压缩触发准确性 | chars/4 估算 | JSON 2 系数 + 4/3 垫高 |
| compaction 熔断 | 无 | 连续失败 3 次停止 |

### 5.2 低资源（MacBook Air 2015）

| 指标 | 当前（Windows 实测） | 目标（老 Mac 预估） |
|------|---------------------|---------------------|
| `--version` | 1.4s（重建实测；上午基线 2.6s/182MB） | <500ms / <80MB |
| 空 `run` 启动 | 15.7s / 265MB（上午基线，重建时点未重测） | <10s / <150MB |
| TUI 常驻内存 | 双 heap 400-700MB | 单 heap <350MB |
| SQLite 常驻 | 64MB | 16MB |
| 每 step git 快照 | 全量 add×2 | 每 3 step 或 30s |

### 5.3 安全/并发

- bash 命令注入 validator 覆盖 5 类高危模式（命令替换/重定向/IFS/CR/git commit 注入），危险命令有警告、危险路径永远 ask。
- 日志/权限 payload 100% 过脱敏，API key 不进入子进程 env。
- 工具并发 ≤3、事件队列有界、server 无密码拒绝公网。

---

## 六、未检项（明确标注）

- TUI/UI 层（`tui/` 27k 行、`ui/` 27k 行）仅结构扫描，未逐文件审。
- 本报告实测数据来自 Windows 开发机；老 Mac 绝对数值需真机验证（本报告给了相对权重与预估值）。
- Claude Code 侧 ant-only（feature-gated）代码未覆盖；`tools/AgentTool`、`BashTool` 等巨型文件仅抽核心锚点。
- 远期项（JSONL 替代、Ink fork 渲染）标注 P2，本期不实施。

---

*本报告承接 docs/PERF-OPTIMIZATION-2026-08-06.md 与 docs/ARCH-REVIEW-ROUND2-2026-08-07.md；五维口径沿用 AGENTS.md 审查纪律（P0/P1/P2 + 文件:行号锚点 + 不臆造）。*
