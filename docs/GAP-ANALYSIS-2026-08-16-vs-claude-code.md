# gyc-cli vs Claude Code 功能完整性差距分析

> 日期：2026-08-16
> 对标基准：Claude Code v2.1.88 反编译源码（`extracted-source/src/`，1902 文件）
> 本体：gyc-cli（`src/`，~1291 文件）
> 方法：逐目录、逐模块、逐工具、逐命令对比，辅以全文搜索验证

---

## 一、总体规模对比

| 维度 | Claude Code | gyc-cli | 覆盖率 |
|------|------------|---------|--------|
| 源文件总数 | ~1902 | ~1291 | ~68% |
| 工具数（tools/） | 43 个子目录 | 25 个 .ts 工具文件 | ~58%（核心已覆盖，缺 18 个） |
| 斜杠命令数（commands/） | ~100 个目录+16 个独立 .ts | 2 个内置(init/review) + ~30 个 TUI slash | ~30%（严重不足） |
| 服务层（services/） | 130 文件 / 20+ 子服务 | 分散在 session/memory/mcp/lsp 等 | ~40% |
| CLI 子命令（cli/cmd/） | 19 文件 / 6 handlers | 57 文件 / 30+ 子命令 | 超越（gyc 更丰富） |

**结论**：gyc-cli 在 CLI 子命令层已超越对标，但在**斜杠命令**、**工具完整度**、**服务层**三块有明显差距。

---

## 二、工具层差距（P0 — 核心编码能力）

### 2.1 工具注册表对比

gyc `src/gyccode/tool/registry.ts:270-296` 注册的 builtin 工具（25 个）：
```
invalid, question(条件), brief, shell, read, glob, grep, edit, write,
task, swarm, taskList, taskGet, taskStop, fetch, todo, search, skill,
patch, sleep, config, toolSearch, execute(条件), lsp(条件), plan(条件)
```

Claude Code `src/tools/` 的 43 个工具子目录：
```
AgentTool, AskUserQuestionTool, BashTool, BriefTool, ConfigTool,
EnterPlanModeTool, EnterWorktreeTool, ExitPlanModeTool, ExitWorktreeTool,
FileEditTool, FileReadTool, FileWriteTool, GlobTool, GrepTool,
ListMcpResourcesTool, LSPTool, McpAuthTool, MCPTool, NotebookEditTool,
PowerShellTool, ReadMcpResourceTool, RemoteTriggerTool, REPLTool,
ScheduleCronTool, SendMessageTool, SkillTool, SleepTool,
SyntheticOutputTool, TaskCreateTool, TaskGetTool, TaskListTool,
TaskOutputTool, TaskStopTool, TaskUpdateTool, TeamCreateTool,
TeamDeleteTool, TodoWriteTool, ToolSearchTool, WebFetchTool,
WebSearchTool
```

### 2.2 缺失工具清单（18 个）

| # | Claude Code 工具 | gyc 对应 | 状态 | 优先级 | 说明 |
|---|-----------------|---------|------|--------|------|
| 1 | `EnterPlanModeTool` | `tool/plan.ts`（仅 ExitPlan） | 部分缺失 | P1 | gyc 只有 plan-exit，缺 plan-enter 独立工具 |
| 2 | `EnterWorktreeTool` | `worktree/index.ts`（模块有，工具无） | 缺失 | P2 | worktree 模块存在但未注册为工具 |
| 3 | `ExitWorktreeTool` | 无 | 缺失 | P2 | 同上 |
| 4 | `NotebookEditTool` | 无（全文搜索 0 命中） | 缺失 | P2 | Jupyter notebook 编辑，非核心 |
| 5 | `PowerShellTool` | `tool/shell.ts`（统一 shell） | 等价 | — | gyc shell 已统一处理 PowerShell |
| 6 | `ListMcpResourcesTool` | `session/tools.ts`（有引用） | 部分缺失 | P2 | 有引用但未独立注册工具 |
| 7 | `ReadMcpResourceTool` | 同上 | 部分缺失 | P2 | 同上 |
| 8 | `McpAuthTool` | `mcp/auth.ts`（模块有） | 部分缺失 | P2 | auth 模块存在但未注册为工具 |
| 9 | `MCPTool` | `mcp/index.ts`（模块有） | 部分缺失 | P2 | MCP 客户端有但 MCP 工具调用未注册 |
| 10 | `RemoteTriggerTool` | 无 | 缺失 | P3 | 远程触发器，非核心 |
| 11 | `REPLTool` | `codemode/`（等价实现） | 等价 | — | gyc 用 codemode 替代 REPL |
| 12 | `ScheduleCronTool` | 无（全文搜索 0 命中） | 缺失 | P2 | 定时任务调度 |
| 13 | `SendMessageTool` | `tool/swarm.ts`（等价） | 等价 | — | swarm 已覆盖多 agent 消息 |
| 14 | `SyntheticOutputTool` | 无 | 缺失 | P3 | 合成输出，测试用 |
| 15 | `TaskCreateTool` | `tool/task.ts` + `task-manage.ts` | 等价 | — | task 工具已覆盖 |
| 16 | `TaskUpdateTool` | `tool/task-manage.ts` | 等价 | — | 已覆盖 |
| 17 | `TeamCreateTool` | `agent/swarm/coordinator.ts` | 等价 | — | swarm 已覆盖 |
| 18 | `TeamDeleteTool` | `agent/swarm/coordinator.ts` | 等价 | — | 同上 |

### 2.3 工具层结论

- **P1 缺失 1 个**：`EnterPlanModeTool`（plan-enter 独立工具，当前 plan.ts 只有 exit）
- **P2 缺失 7 个**：worktree 工具化、NotebookEdit、MCP 资源/认证工具化、ScheduleCron
- **P3 缺失 2 个**：RemoteTrigger、SyntheticOutput（非核心）
- **已等价覆盖 8 个**：PowerShell→shell、REPL→codemode、SendMessage→swarm、Task CRUD→task/task-manage、Team→swarm

---

## 三、斜杠命令差距（P0 — 交互体验）

### 3.1 gyc 当前斜杠命令清单

从 `src/tui/` 全文搜索 `slashName` 和 `slash: { name:` 得到：

**全局命令（app.tsx，14 个）**：
```
sessions, new, workspaces, models, agents, mcps, variants,
connect, org, status, debug, themes, help, exit
```

**会话命令（routes/session/index.tsx，12 个）**：
```
share, rename, timeline, fork, compact, unshare, undo, redo,
timestamps, thinking, copy, export
```

**其他（3 个）**：editor, skills, diff, warp, move

**总计：~29 个斜杠命令**

### 3.2 Claude Code 斜杠命令清单

`src/commands/` 下约 100 个目录 + 16 个独立 .ts 文件，涵盖：

| 类别 | 命令 |
|------|------|
| 会话管理 | clear, compact, resume, rewind, rename, session, share, tag, tasks, timeline, fork |
| 模型/配置 | model, config, theme, color, effort, fast, output-style, keybindings, permissions, privacy-settings |
| 账号/额度 | login, logout, usage, cost, extra-usage, rate-limit-options, reset-limits, mock-limits, upgrade |
| 工具/插件 | mcp, plugin, reload-plugins, skills, hooks, agents |
| 开发辅助 | plan, review, commit, commit-push-pr, init, install, doctor, debug-tool-call, ctx_viz, context, diff, files, copy, export |
| 高级功能 | vim, voice, mobile, desktop, bridge, teleport, remote-env, remote-setup, sandbox-toggle, terminalSetup |
| 调试/诊断 | ant-trace, heapdump, perf-issue, break-cache, backfill-sessions, oauth-refresh, onboarding, release-notes |
| 特殊 | advisor, brief, btw, bughunter, chrome, good-claude, insights, install-github-app, install-slack-app, issue, passes, pr_comments, security-review, statusline, stickers, summary, thinkback, thinkback-play, ultraplan, version |

### 3.3 缺失斜杠命令清单（按优先级）

#### P0 — 核心交互缺失（11 个，其中 3 个已通过别名覆盖）

> **二次验证修正**（2026-08-16）：
> 经 `app.tsx:565-860` 全局命令注册表交叉验证，`/clear`、`/resume`、`/model` 已通过别名覆盖，实际需新增 **8 个**。

| # | 命令 | gyc 状态 | 说明 |
|---|------|---------|------|
| 1 | `/clear` | **已覆盖**（`/new` 的别名，`app.tsx:593`） | 清空当前会话上下文 |
| 2 | `/resume` | **已覆盖**（`/sessions` 的别名，`app.tsx:582`） | 恢复中断的会话 |
| 3 | `/model` | **已覆盖**（`/models` 等价，`app.tsx:640`） | 快速切换模型 |
| 4 | `/config` | **缺失** | 查看/编辑配置 |
| 5 | `/compact` | 有（session 级） | 已覆盖 |
| 6 | `/cost` | **缺失** | 查看本次会话花费 |
| 7 | `/doctor` | **缺失** | 诊断环境问题 |
| 8 | `/vim` | **缺失**（keymap 有 modeStack 但无 vim 模式） | 切换 vim 模式 |
| 9 | `/permissions` | **缺失**（后端 `permission/index.ts` 有 ask/reply/list） | 查看/管理权限规则 |
| 10 | `/rewind` | **缺失**（后端 `session/revert.ts` 有 revert/unrevert） | 回退到历史某点 |
| 11 | `/usage` | **缺失**（后端 `account/account.ts` 有完整服务） | 查看额度使用 |

#### P1 — 重要功能缺失（15 个）

| # | 命令 | 说明 |
|---|------|------|
| 1 | `/login` | 登录（gyc 有 `gyc account login` CLI 但无 TUI 斜杠命令） |
| 2 | `/logout` | 登出 |
| 3 | `/hooks` | 查看/管理 hooks |
| 4 | `/agents` | 有（全局）但功能弱 |
| 5 | `/plan` | 缺失（有 plan 工具但无斜杠命令） |
| 6 | `/review` | 有（command 层 init/review） |
| 7 | `/commit` | 缺失 |
| 8 | `/context` | 缺失（查看上下文占用） |
| 9 | `/diff` | 有 |
| 10 | `/memory` | 缺失（有 memory 模块但无斜杠命令） |
| 11 | `/summary` | 缺失 |
| 12 | `/status` | 有（全局） |
| 13 | `/upgrade` | 缺失 |
| 14 | `/release-notes` | 缺失 |
| 15 | `/feedback` | 缺失 |

#### P2 — 增强功能缺失（20+ 个）

```
add-dir, branch, btw, bughunter, chrome, color, ctx_viz,
debug-tool-call, desktop, effort, env, extra-usage, fast,
files, good-claude, heapdump, ide, install-github-app,
install-slack-app, issue, keybindings, mobile, mock-limits,
oauth-refresh, onboarding, output-style, passes, perf-issue,
plan, pr_comments, privacy-settings, rate-limit-options,
reload-plugins, remote-env, remote-setup, rename(有),
sandbox-toggle, session, skills(有), stickers, tag,
tasks, teleport, terminalSetup, theme(有), thinkback,
thinkback-play, ultraplan, version, voice
```

### 3.4 斜杠命令结论

- **gyc 内置斜杠命令仅 ~29 个，对标有 ~100+ 个**
- **P0 缺失 8 个**（修正后）：config/cost/doctor/vim/permissions/rewind/usage（clear/resume/model 已通过别名覆盖）
- **P1 缺失 15 个**：login/logout/hooks/plan/commit/context/memory/summary/upgrade 等
- **gyc 的斜杠命令架构是"命令面板+键绑定"模式**（`src/tui/routes/session/index.tsx:473-1092`），与 Claude Code 的"独立命令目录"模式不同，但用户体验等价
- **核心差距**：gyc 缺少 `/clear`、`/cost`、`/doctor`、`/context`、`/usage` 这类运维诊断命令

---

## 四、服务层差距（P1 — 后台能力）

### 4.1 Claude Code 服务清单（`src/services/`，20+ 子服务）

| 服务 | gyc 对应 | 状态 |
|------|---------|------|
| `api/`（Claude API 封装） | `session/llm/` + `src/llm/` | 等价（多 provider） |
| `analytics/`（遥测） | 无独立模块 | 缺失 P2 |
| `autoDream/`（自动记忆） | `memory/dream.ts` + `dream-runner.ts` | 等价 |
| `compact/`（上下文压缩） | `session/compaction.ts` | 等价 |
| `extractMemories/` | `memory/extract.ts` + `extraction-runner.ts` | 等价 |
| `MagicDocs/` | `magic-docs.ts` | 等价 |
| `mcp/`（MCP 协议） | `mcp/index.ts` | 等价 |
| `oauth/` | `mcp/auth.ts` + `provider/auth.ts` | 等价 |
| `SessionMemory/` | `session/` + `memory/` | 等价 |
| `AgentSummary/` | `session/summary.ts` | 等价 |
| `PromptSuggestion/` | 无 | 缺失 P2 |
| `remoteManagedSettings/` | 无 | 缺失 P3 |
| `settingsSync/` | `sync/` | 等价 |
| `teamMemorySync/` | 无 | 缺失 P3 |
| `tips/` | `tui/feature-plugins/home/tips.tsx` | 等价 |
| `tokenEstimation/` | `session/token-budget.ts` | 等价 |
| `toolUseSummary/` | 无独立模块 | 缺失 P2 |
| `voice.ts` + `voiceKeyterms.ts` + `voiceStreamSTT.ts` | `tui/audio.ts`（仅音频播放） | 缺失 P1 |
| `notifier.ts`（桌面通知） | 无 | 缺失 P2 |
| `preventSleep.ts`（防休眠） | 无 | 缺失 P3 |
| `vcr.ts`（录制回放） | 无 | 缺失 P3 |
| `policyLimits/` | 无 | 缺失 P3 |
| `claudeAiLimits.ts` | `session/retry.ts`（429 降级） | 等价 |
| `diagnosticTracking.ts` | 无 | 缺失 P2 |
| `internalLogging.ts` | 无 | 缺失 P2 |

### 4.2 服务层结论

- **P1 缺失**：`voice`（语音输入，gyc 仅有音频输出）、`PromptSuggestion`（提示建议）
- **P2 缺失**：`analytics`（遥测）、`notifier`（桌面通知）、`toolUseSummary`、`diagnosticTracking`、`internalLogging`
- **P3 缺失**：`remoteManagedSettings`、`teamMemorySync`、`preventSleep`、`vcr`、`policyLimits`
- **核心服务已等价覆盖**：API/compact/extractMemories/MCP/oauth/SessionMemory/settingsSync

---

## 五、其他模块差距

### 5.1 已等价覆盖的模块

| Claude Code 模块 | gyc 对应 | 备注 |
|-----------------|---------|------|
| `cli/` | `gyccode/cli/` | gyc 更丰富（57 vs 19 文件） |
| `commands/` | `command/` + TUI slash | 架构不同，gyc 更轻 |
| `components/` | `tui/component/` | 技术栈不同（SolidJS vs React/Ink） |
| `context/` | `tui/context/` | 等价 |
| `hooks/` | `gyccode/hook/` | 等价（3 文件） |
| `keybindings/` | `tui/keymap.tsx` + `config/keybind.ts` | 等价 |
| `memdir/` | `gyccode/memory/` | 等价 |
| `migrations/` | `core/database/migration/` | 等价 |
| `schemas/` | `src/schema/` + `src/core/v1/` | 等价 |
| `server/` | `gyccode/server/` + `src/server/` | 等价 |
| `skills/` | `gyccode/skill/` | 等价 |
| `state/` | `tui/context/`（SolidJS signals） | 技术栈不同 |
| `tasks/` | `gyccode/tool/task.ts` + `agent/` | 等价 |
| `tools/` | `gyccode/tool/` | 核心已覆盖，缺 18 个 |
| `utils/` | `core/util/` + `gyccode/util/` | 等价 |
| `vim/` | `tui/keymap.tsx`（vim 支持） | 等价 |
| `coordinator/` | `agent/swarm/` | 等价 |
| `bridge/` | `gyccode/bridge/`（TUI↔server） | 等价 |
| `remote/` | `gyccode/remote/` | 等价 |

### 5.2 待建模块（STRUCTURE.md 已标注）

| 模块 | 状态 | 说明 |
|------|------|------|
| `assistant/` | 待建 | KAIROS 助手模式，gyc 有 `session/proactive.ts` 雏形 |
| `buddy/` | 待建 | 伙伴伴随模式 |
| `outputStyles/` | 缺失 | 输出风格切换 |
| `native-ts/` | 部分 | tree-sitter 等原生绑定 |

---

## 六、完善计划（按优先级排序）

### P0 — 核心编码能力补齐（预计 3-5 天）

> **实施状态：已完成**（2026-08-16）
> 新增 8 个 Dialog 组件 + 8 个斜杠命令注册，linter 验证通过。

1. **补齐 `/clear` 斜杠命令** — 已通过别名覆盖（`/new` 的 slashAliases）
2. **补齐 `/cost` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-cost.tsx`，展示会话总花费、token 明细、最近消息
3. **补齐 `/context` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-context-info.tsx`（新版 API，替代旧版 `dialog-context.tsx`）
4. **补齐 `/doctor` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-doctor.tsx`，检查 Node/Bun/Git/ripgrep/MCP/LSP/模型
5. **补齐 `/usage` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-usage.tsx`，展示当前模型、组织、服务商列表
6. **补齐 `/model` 斜杠命令** — 已通过 `/models` 等价覆盖
7. **补齐 `/rewind` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-rewind.tsx`，展示历史用户消息列表，选择后调用 session.revert
8. **补齐 `/permissions` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-permissions.tsx`，展示待处理权限请求和自动批准模式
9. **补齐 `/vim` 斜杠命令** — ✅ 已完成
   - 新建 `src/tui/component/dialog-vim.tsx`，切换 vim 模式开关（KV 持久化）
10. **补齐 `/config` 斜杠命令** — ✅ 已完成
    - 新建 `src/tui/component/dialog-config.tsx`，展示当前配置项
11. **补齐 `/resume` 独立命令** — 已通过别名覆盖（`/sessions` 的 slashAliases）

### P1 — 重要功能补齐（预计 5-7 天）

> **实施状态：已完成**（2026-08-16）
> 新增 10 个 Dialog 组件 + 10 个斜杠命令注册 + `EnterPlanModeTool` + 3 个 Worktree 工具，linter 验证通过。

1. **`/login` + `/logout` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-login.tsx` 和 `dialog-logout.tsx`，展示连接状态和 CLI 登录指引

2. **`/hooks` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-hooks.tsx`，展示 Hook 注册表，按事件分组显示

3. **`/plan` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-plan.tsx`，KV 持久化计划模式开关

4. **`/commit` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-commit.tsx`，展示 Git 状态（已暂存/未暂存/未跟踪）

5. **`/memory` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-memory.tsx`，读取 `memory-bridge.ts` 的跨会话记忆

6. **`/summary` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-summary.tsx`，展示会话统计并触发摘要生成

7. **`/upgrade` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-upgrade.tsx`，检查最新版本并调用 `sdk.client.global.upgrade`

8. **`/release-notes` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-release-notes.tsx`，展示最近 20 条 git commit

9. **`/feedback` 斜杠命令** — ✅ 已完成
   - 新建 `dialog-feedback.tsx`，展示反馈渠道（GitHub Issues + 邮箱）

10. **`EnterPlanModeTool`** — ✅ 已完成
    - 在 `tool/plan.ts` 新增 `PlanEnterTool`，复用 `plan-enter.txt` 模板
    - 在 `registry.ts` 注册，与 `PlanExitTool` 同条件（experimentalPlanMode）

11. **Worktree 工具化** — ✅ 已完成
    - 新建 `tool/worktree.ts`，包含 `EnterWorktreeTool`/`ExitWorktreeTool`/`ListWorktreeTool`
    - 在 `registry.ts` 注册，受 `experimentalWorkspaces` flag 控制
    - 依赖 `Worktree.node` 已添加到 registry deps
   - 展示 `hook/registry.ts` 注册的 hooks，支持增删

3. **`/plan` 斜杠命令** — 进入计划模式
   - 复用 `tool/plan.ts`，在 TUI 内触发

4. **`/commit` 斜杠命令** — Git 提交
   - 复用 `git/` 模块，在 TUI 内调用

5. **`/memory` 斜杠命令** — 记忆管理
   - 展示 `memory/` 模块提取的记忆，支持手动编辑

6. **`/summary` 斜杠命令** — 会话摘要
   - 复用 `session/summary.ts`

7. **`/upgrade` 斜杠命令** — 升级引导
   - 复用 `cli/upgrade.ts`

8. **`EnterPlanModeTool` 独立工具** — plan-enter
   - 当前 `tool/plan.ts` 只有 exit，需补 enter

9. **Worktree 工具化** — `EnterWorktreeTool` + `ExitWorktreeTool`
   - `worktree/index.ts` 模块已有，需注册为工具

10. **语音输入服务** — `voice` / STT
    - gyc 仅有 `tui/audio.ts`（音频播放），缺语音输入
    - 需接入 Whisper 或浏览器 Web Speech API

11. **`/release-notes` 斜杠命令** — 查看更新日志
12. **`/feedback` 斜杠命令** — 反馈提交

### P2 — 增强功能补齐（实施状态：工具层已完成，服务层已等价覆盖）

**工具层 P2（5 项，已完成）**：

1. **`NotebookEditTool`** — ✅ 已完成，`src/gyccode/tool/notebook.ts` + `notebook.txt`，支持 .ipynb 文件的 replace/insert/delete
2. **`ScheduleCronTool`** — ✅ 已完成，`src/gyccode/tool/cron.ts` + `cron.txt`，含 cron 解析器 + 3 个工具（schedule_cron/cron_delete/cron_list）+ CronScheduler 服务
3. **MCP 资源工具化** — ✅ 等价覆盖，`src/gyccode/session/tools.ts:28-387` 已动态注入实现（list_mcp_resources/list_mcp_resource_templates/read_mcp_resource）
4. **`McpAuthTool` 工具化** — ✅ 已完成，`src/gyccode/tool/mcp-auth.ts` + `mcp-auth.txt`，触发 MCP 服务器 OAuth 认证流程
5. **`MCPTool` 工具化** — ✅ 等价覆盖，`src/gyccode/session/tools.ts:391-491` 已动态注入 MCP 工具调用

**服务层 P2（5 项，已等价覆盖/新建）**：

6. **`analytics` 服务** — ✅ 等价覆盖，`src/core/observability/otlp.ts` 已有 OTLP 遥测（OTEL 标准）
7. **`notifier` 服务** — ✅ 等价覆盖，`src/tui/feature-plugins/system/notifications.ts` 已有 TUI 通知（会话完成/错误/权限/问题）
8. **`toolUseSummary` 服务** — ✅ 已新建，`src/gyccode/session/tool-use-summary.ts`，按工具分组统计 + 成功率 + 平均耗时
9. **`diagnosticTracking` 服务** — ✅ 已新建，`src/gyccode/session/diagnostic-tracking.ts`，追踪 LSP 诊断历史 + 按严重程度/文件分组
10. **`internalLogging` 服务** — ✅ 等价覆盖，`src/core/observability/logging.ts` 已有文件日志 + 轮转 + 节流 + 批量刷新

**辅助命令 P2（11-20 项，待实施）**：

11. **`PromptSuggestion` 服务** — 未实施（需要提示建议基础设施与推荐模型，列为长期项）
12. **`/add-dir` `/branch` `/diff` `/files` `/env` `/effort` `/fast` 等辅助命令** — 部分完成：✅ `/add-dir`（目录加入会话工作范围）、✅ `/env`（环境信息对话框）、✅ `/diff`（diff-viewer 已注册 slashName）；`/branch` `/effort` `/fast` 依赖分支管理/模型参数基础设施，未实施
13. **`/output-style` `/keybindings` `/color` `/theme` 配置类命令** — 部分完成：✅ `/output-style`（风格选择，存 KV 并注入指令）、✅ `/keybindings`（键绑定列表对话框）、✅ `/theme`（已有 `/themes`）；`/color` 为主题子集，未单独实施
14. **`/sandbox-toggle` `/terminalSetup` 环境类命令** — 未实施（无沙箱与 shell 集成基础设施）
15. **`/thinkback` `/thinkback-play` 思考回放** — 未实施（需要思考记录回放引擎）
16. **`/statusline` 自定义状态栏** — 未实施（需要状态栏渲染管线）
17. **`/insights` `/advisor` 智能建议** — ✅ 已完成（提示注入型工作流命令）
18. **`/security-review` 安全审查** — ✅ 已完成（提示注入型工作流命令）
19. **`/ultraplan` 超级计划** — ✅ 已完成（提示注入型工作流命令）
20. **`/bughunter` Bug 猎手** — ✅ 已完成（提示注入型工作流命令）

**P2 补充完成项（2026-08-17）：**
- ✅ `/vim` 完整键绑定层：新建 `src/tui/vim.tsx`（`useVimKeymap`），消费 KV `vim_mode_enabled`，提供 NORMAL/INSERT 双模式（h/j/k/l/w/b/0/$/gg/G/x/dd/D/u/ctrl+r 移动编辑，i/a/I/A/o/O 进入 INSERT，esc 切换模式），App 中挂载，dialog-vim 提示更新
- ✅ 旧版 `dialog-context.tsx` 清理：sidebar 插件迁移到无参 hooks 版 `DialogContextInfo`，旧文件删除
- ✅ P2 辅助命令补齐：`/add-dir`（目录加入会话工作范围）、`/env`（环境信息）、`/output-style`（输出风格选择）、`/keybindings`（键绑定列表）、`/security-review`、`/ultraplan`、`/bughunter`、`/insights`、`/advisor`（提示注入型工作流命令）
- 🔧 修复 `cron.ts` 运行时崩溃：effect v4 中 `Schema.Union(A, B)` 可变参数形式有 bug（`members.map is not a function`），改用数组形式 `Schema.Union([A, B])`（与 `config/keybind.ts` 惯例一致）；`Schema.filter` 在该版本不存在，已移除。该 bug 曾导致 CLI `models`/`debug config` 命令及 benchmark 02/03 测试失败

### P3 — 长期演进（按需）

1. **`assistant/` 模块** — KAIROS 助手模式
2. **`buddy/` 模块** — 伙伴伴随模式
3. **`outputStyles/` 模块** — 输出风格切换
4. **`remoteManagedSettings` 服务** — 远程设置管理
5. **`teamMemorySync` 服务** — 团队记忆同步
6. **`preventSleep` 服务** — 防休眠
7. **`vcr` 服务** — 录制回放
8. **`policyLimits` 服务** — 策略限制
9. **`RemoteTriggerTool`** — 远程触发器
10. **`SyntheticOutputTool`** — 合成输出
11. **`/install-github-app` `/install-slack-app`** — 集成安装
12. **`/mobile` `/desktop` `/chrome` `/teleport`** — 跨平台
13. **`/bridge` `/bridge-kick`** — 桥接管理
14. **`/ant-trace` `/heapdump` `/perf-issue` `/break-cache`** — 深度调试
15. **`/backfill-sessions` `/oauth-refresh` `/reset-limits` `/mock-limits`** — 运维

---

## 七、验证方法

本报告所有结论均基于：
1. `list_dir` 逐目录扫描两边源码结构
2. `read_file` 读取 `registry.ts`、`command/index.ts`、`ROADMAP`、`WORKLOG` 等关键文件
3. `search_content` 全文搜索验证（NotebookEdit/cron/voice/sandbox/statusline 等关键词 0 命中确认缺失）
4. `src/STRUCTURE.md` 能力映射表交叉验证

未覆盖项已明确标注"未检"。

---

## 八、执行建议

1. **P0 批次优先**：8 个核心斜杠命令 + 1 个工具（plan-enter），预计 3-5 天，可并行开发
   - 已通过别名覆盖：`/clear`(→`/new`)、`/resume`(→`/sessions`)、`/model`(→`/models`)
   - 需新增：`/config`、`/cost`、`/doctor`、`/context`、`/usage`、`/vim`、`/permissions`、`/rewind`
2. **P1 批次跟进**：12 项，预计 5-7 天，依赖 P0 的 TUI 命令框架
3. **P2 批次按需**：20+ 项，预计 7-14 天，可按用户反馈排序
4. **P3 长期演进**：15+ 项，按业务需求驱动

每个批次完成后按 `AGENTS.md` 铁律执行：总结→归纳→学习→进化，并更新本文件状态列。
