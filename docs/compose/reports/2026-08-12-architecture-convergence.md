# 架构评估报告：执行器统一 / API 收敛 / 功能接入路线图

> 日期：2026-08-12
> 范围：对四项待办（统一 v1/v2 执行器、保持双事件通道现状、研究 3 功能接入、收敛双轨 server API）的深度分析与建议
> 方法：静态代码追踪（v1/v2 执行链、httpapi 双 API、MCP/plugin 结构）+ swarm 子代理并行研究

---

## [A] v1/v2 会话执行器统一 —— 评估

### 现状（已追踪确认）

| 维度 | v1（gyccode 层） | v2（core 层） |
|---|---|---|
| 执行栈 | `src/gyccode/session/` 共 **433KB**（prompt 89KB、compaction 37KB、processor 28KB、tools 24KB、llm 17KB 等） | `src/core/session/runner/` 共 **55KB**（llm.ts 21KB + model/max-steps/publish/to-llm-message） |
| 协议 | SessionV1（`@gyccode/core/v1/session`） | SessionV2（`@gyccode/core/session`） |
| 服务入口 | TUI/CLI：TUI → httpapi `InstanceHttpApi.session.prompt` → v1 `SessionPrompt`/`SessionProcessor`（handlers/session.ts 用 SessionPrompt） | web：httpapi `server Api.session.prompt` → v2 `SessionV2` → `SessionRunner.run`（src/server/handlers/session.ts 用 SessionV2） |
| 引擎能力 | 完整交互栈（工具循环、压缩、记忆提取、summary/title、MCP、skill、swarm/task 工具） | 精简核心引擎（工具循环、压缩、权限、快照、多轮续跑均 [x]） |

### v2 未完成项（runner/llm.ts 头部注释 "unchecked items"）
- 集群多节点 ownership；durable busy/retrying/idle 状态
- **policy 过滤的 built-in/MCP/plugin/structured-output 工具定义解析（未完成）**
- snapshot/patch/retry 增量持久化
- scoped runtime context、progress、attachment 归一化、插件、cancellation settlement
- compaction 续跑、title/summary/compaction 状态后台维护、durable 输出事件暴露、流式 delta 合并

### 结论
- v2 是**设计目标**（注释："rather than rebuilding the legacy SessionPrompt monolith"），但当前是**精简核心**，多项能力未完成。
- 统一 = 让 TUI/CLI 改走 v2 = 需先补全 v2 未完成项（约等于把 v1 的 MCP/skill/记忆/title 等能力移植到 core）——**超大规模工程（多周），不可单次会话实施**。
- 风险：TUI 是生产主入口，贸然切换会破坏现有功能。

### 建议（分阶段，每阶段可独立验证）
1. **阶段 0（本报告）**：确认 v2 为统一目标方向，冻结 v1 新功能开发。
2. **阶段 1**：补全 v2 的 MCP/plugin 工具解析 + snapshot/patch 持久化（最高优先级未完成项）。
3. **阶段 2**：补全 v2 的 title/summary/compaction 后台维护 + durable 输出事件。
4. **阶段 3**：TUI 前端切到 v2（httpapi server API 的 session.prompt），灰度验证后下线 v1。
5. 每阶段 TDD + 全量测试守护。

---

## [B] httpapi 双 server API 收敛 —— 评估

### 现状（已追踪确认）
`src/gyccode/server/routes/instance/httpapi/server.ts`（325 行）同时注册两套：

| | v1（instanceRoutes） | v2（serverRoutes） |
|---|---|---|
| Api 命名空间 | `RootHttpApi`("gyccode-root") + `InstanceHttpApi` + `ServerApi`(makeApi) + `EventApi`/`PtyConnectApi`/`PublicApi` | `Api` = `makeDefaultApi`（HttpApi.make("server")） |
| Handlers | gyccode/.../httpapi/handlers/ **19 文件** | src/server/handlers/ **18 文件** |
| 独有 | tui/mcp/file/instance/sync/workspace/experimental/control/control-plane/global/config | agent/command/credential/fs/health/integration/location/message/model/reference/skill |
| 重叠（同语义双实现） | event/permission/project-copy/provider/pty/question/session | 同左 |

### 关键判断
- 两套**命名空间不同（gyccode-instance vs server），路由不冲突**，但存在**同语义 API 的双实现**（session/prompt 就有 v1 SessionPrompt 版与 v2 SessionV2 版）。
- TUI 走 v1 instance API；web/第三方走 v2 server API——**双入口双实现**。

### 收敛方案
- **目标**：确立 v2 `server` API 为唯一 web API，v1 instance API 逐步迁移/下线。
- **阶段 1**：列出 v1 独有 group（tui/mcp/file/instance/sync/workspace/experimental/control/control-plane/global/config）在 v2 的等价物，缺失的补建到 v2。
- **阶段 2**：重叠 7 个 group 统一到 v2 实现（保留 v1 兼容别名过渡）。
- **阶段 3**：TUI 前端切到 v2 server API 后，下线 v1 instance API。
- 与任务 A 阶段 3 同步（TUI 统一到 v2 时一并收敛 API）。

---

## [C] 3 个未接线功能接入路线图 —— swarm 研究结论（3 代理一致）

### C1. `mcp/transport-ide.ts`（IDE 传输）— 工作量中（~1-2 天）
- **现状**：`IDETransport` 完整实现（本地 HTTP /health + getEditorCommand），零引用。
- **接入点**：`src/gyccode/mcp/index.ts` 已预留——
  - `:131` `MCPTransportKind` 已含 `"ide"` 字面量
  - `:140-154` `resolveTransport()` 注释预留 ide（函数本身未被调用）
  - `:241` `type Transport` 联合（stdio/http/sse/ws）需并入 ide
  - `:409-452` `create()` 按 `mcp.type` 分派处加 `ide` 分支
- **路径**：① `core/v1/config/mcp.ts` 加 `Ide` schema（editor/port/extensionId）；② `create()` 加 ide 分支 + 生命周期 `addFinalizer`；③ `cli/cmd/mcp.ts` 加 `--editor/--port` 选项。
- **注意**：现有传输全是"出站"（gyccode 主动连），IDETransport 是"入站监听"；IDETransport 未实现 MCP JSON-RPC `Transport` 接口（仅 health 握手），需确认 IDE 扩展侧协议，风险中。

### C2. `plugin/marketplace.ts`（插件市场）— 工作量中高（~2-3 天）
- **现状**：`PluginMarketplace`（fetchIndex/search/install/update）完整，registry=https://plugins.gyc-code.dev/index.json，下载 .tgz 到 `.gyc/plugins/cache`；**注意 `PluginMeta` 类名与 `plugin/meta.ts` 的 namespace 重名，需改名避撞**。
- **现有插件链**：`cli/cmd/plug.ts`（installPlugin→readPluginManifest→patchPluginConfig）；`install.ts`；`loader.ts loadExternal→resolve→shared.ts resolvePluginTarget`（Npm.add 是唯一安装路径）。
- **接入点**：`shared.ts:207-213 resolvePluginTarget` 的 npm 安装前接入 marketplace 下载目标；CLI `plug.ts` 加 `plugin search/list` 子命令暴露 `search()`。
- **风险**：marketplace 下载 .tgz 与现有 npm/node_modules 布局不一致（loader 靠 readPluginPackage 读 package.json），需解包或与 Npm.add 调和；命名冲突。

### C3. `control-plane/dev/debug-workspace-plugin.ts`（调试工作区）— 工作量低（0-0.5 天）
- **现状/用途**：注册 `"debug"` workspace adapter（`experimental_workspace.register` → `registerAdapter` → `getAdapter` 被 workspace.ts 消费），写 /tmp 数据 + waitForHealth。
- **接入点**：dev 机制已存在（`control-plane/adapters/index.ts:37-41 registerAdapter`、`:5-8 BUILTIN{worktree}`）；**保持外部 dev 插件即可**（README 已说明用法），无需代码接线；可选加 CLI 快捷命令。
- **注意**：硬编码 `/tmp` 仅 Unix（Windows 需改路径）。

### 优先级
- **C3（debug 插件）**：零改动/低——保持现状。
- **C1（IDE 传输）**：中——接入点清晰、有现成占位，是唯一有正式功能的模块。
- **C2（插件市场）**：中高——需先解决安装路径（tgz vs npm）与命名冲突。

---

## 综合建议（按投入产出排序）

1. **立即（低风险）**：C3 保持现状 + 修正硬编码 /tmp；C1 接线（IDE 传输，接入点明确）。
2. **中期（中风险）**：C2 插件市场（先定 tgz/npm 双轨策略）。
3. **长期（高风险，需产品决策）**：任务 A 统一执行器 + 任务 B 收敛 API——两者阶段 3 同步（TUI 切 v2 时一并收敛），是持续迭代路线图，建议按 A/B 的阶段计划逐步推进，每阶段 TDD + 全量测试守护。