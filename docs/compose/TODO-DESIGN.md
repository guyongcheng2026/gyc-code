# 待设计清单（TODO-DESIGN）

> 本清单记录工作中所有"待设计"的内容——需架构决策后才能实施，不属即时缺陷。
> 用户询问"待设计"任务时，依此清单逐条列出供决策。
> 更新规则：新增待设计项时追加到本节；决策完成后标记状态并移除。

---

## 待设计项（按状态分组）

### 🔲 待决策

| # | 待设计内容 | 现状与背景 | 需决策点 | 来源 |
|---|---|---|---|---|
| D1 | **C1: IDE 传输接入** | `mcp/transport-ide.ts` 是入站 HTTP 监听（/health + getEditorCommand），不实现 MCP SDK Transport 协议，与 `mcp/index.ts` 客户端体系方向相反；gyccode 无 MCP server 实现 | IDE 集成架构形态：①gyccode 作为 MCP server 暴露工具给 IDE（需实现 JSON-RPC，大工程）；②IDE 作为工具调用方（HTTP 触发）；③保持独立不接入 | 2026-08-12 架构评估 |
| D2 | **C2: 插件市场接入** | `plugin/marketplace.ts` 完整实现（fetchIndex/search/install/update），registry=https://plugins.gyc-code.dev，下载 .tgz 到 .gyc/plugins/cache；`PluginMeta` 类名与 `plugin/meta.ts` namespace 重名 | tgz 下载与现有 npm 安装（shared.ts resolvePluginTarget→Npm.add）双轨策略；命名冲突改名方案；CLI 是否加 `plugin search/list` 子命令 | 2026-08-12 架构评估 |
| D3 | **v1/v2 执行器统一** | v1（gyccode/session 433KB）服务 TUI/CLI，v2（core/session/runner 55KB）服务 web；v2 是设计目标但有多项未完成（MCP/plugin 工具解析、snapshot/patch 持久化、title/summary/compaction 维护等） | 是否确认 v2 为统一目标方向并冻结 v1 新功能；分阶段补全 v2 的优先级 | 2026-08-12 架构评估 |
| D4 | **httpapi 双 API 收敛** | httpapi server.ts 同时注册 instanceRoutes（v1, 19 handlers）+ serverRoutes（v2, 18 handlers），命名空间不同（gyccode-instance vs server），重叠 7 group（event/permission/project-copy/provider/pty/question/session） | 确立 v2 server API 为唯一 web API；v1 独有 group（tui/mcp/file/instance/sync/workspace/experimental/control/control-plane/global/config）在 v2 的等价物梳理与迁移 | 2026-08-12 架构评估 |
| D5 | **双事件通道 TUI 直连 EventV2** | EventV2→EventV2Bridge→GlobalBus 桥接合理（保持现状）；GlobalBus 是全局 EventEmitter 广播出口 | 是否让 TUI 直接消费 EventV2（绕过 GlobalBus 桥接），以获得类型化事件；当前桥接已满足需求 | 2026-08-12 架构评估 |
| D6 | **debug 插件内置化** | `control-plane/dev/debug-workspace-plugin.ts` 是外部 dev 工具插件，硬编码 /tmp 已改为 os.tmpdir() | 是否内置（加入 plugin/index.ts internalPlugins + RuntimeFlags 开关）；是否加 CLI 快捷命令 | 2026-08-12 架构评估 |
| D7 | **MCP config 加 Ide 类型** | `core/v1/config/mcp.ts` Info = Union([Local, Remote])，无 Ide；`MCPTransportKind` 已含 "ide" 占位（mcp/index.ts:131） | 若 D1 采用"gyccode 作为 MCP server"或"最小启动服务"形态，需加 Ide schema + create() 分支 + CLI --editor/--port 选项；与 D1 联动 | 2026-08-12 架构评估 |

### ✅ 已决策（历史，供追溯）

| # | 内容 | 决策 |
|---|---|---|
| C1 | IDE 传输接入 | 2026-08-12：不接线，记录待设计（D1） |
| C3 | debug 插件 /tmp 路径 | 2026-08-12：已修正为 os.tmpdir()（平台无关） |
| A/B | 执行器统一 / API 收敛 | 2026-08-12：仅出路线图（报告已写入），不实施 |

---

## 相关文档
- 架构评估报告：`docs/compose/reports/2026-08-12-architecture-convergence.md`