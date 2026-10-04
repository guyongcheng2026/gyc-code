# 待设计清单（TODO-DESIGN）

> 本清单记录工作中所有"待设计"的内容——需架构决策后才能实施，不属即时缺陷。
> 用户询问"待设计"任务时，依此清单逐条列出供决策。
> 更新规则：新增待设计项时追加到本节；决策完成后标记状态并移除。

> **推荐路线（2026-09-24 评估，待谷总拍板）**：D3 默认按「v1 冻结新功能 + v2 按洞分批补全」推进——该路线解锁 `src/core/tool/bash.ts` 等 20+ 条「Port after V2」依赖型源码 TODO；拍板前维持现状（双轨并存），v1 不接新特性以控制 433KB 迁移面增速。D1-D7 其余项维持待决策。

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

### 🔲 待决策（2026-09-27 内核 1.18.32 升级遗留）

| # | 待设计内容 | 现状与背景 | 需决策点 | 来源 |
|---|---|---|---|---|
| D8 | **上游 AI SDK 补丁是否引入** | 上游 1.18.32 新增 `patches/@ai-sdk%2Fopenai@3.0.88.patch`（去除 serviceTier 能力校验与参数剔除）；gyc 无 `patches/` 机制与 `patchedDependencies` | 是否新建 `patches/` + 登记依赖补丁并移植该补丁；或永久保持不引入（gyc 自研 `src/llm` 直构请求、vendored copilot 语言模型自带 serviceTier 逻辑） | 2026-09-27 内核升级 |
| D9 | **anthropicBlockBinding 是否移植** | 上游把 thinking 绑定控制（`blockBinding` + thinking-binding-controls）改为按 Claude 5.1+ 生效并支持 opt-out；gyc 用 `anthropicUsesModernAdaptiveThinking` 走等价路径，未实现 `blockBinding` | 是否引入（前置依赖 D8 的 SDK 补丁支持）或永久保持差异 | 2026-09-27 内核升级 |
| D10 | **内核升级流程沉淀为 SKILL** | 本次升级流程可复用：gh-proxy 取上游参考仓库 → 建映射表 → 逐文件 hunk 移植 → EOL/BOM 归一化比对 → tsc + 全量测试 | 是否新建 `gyc-kernel-upgrade` SKILL 固化该流程（含「本地已拆分文件按符号定位」等坑位） | 2026-09-27 内核升级 |

### ✅ 已完成（2026-10-03 落地，附证据）

| 编号 | 内容 | 落地位置与验证方式 |
|---|---|---|
| W-2 | 提交前四检接入工具层 | `.githooks/pre-commit-checks.mjs` 抽取为可调用模块（含超时与输出截断收口）；`src/gyccode/tool/git.ts:280,290,309` 新增 `run_checks`（默认关闭）；`pre-commit-checks.test.ts` 9 项 |
| W-3 | 推送与合并请求工具 | `git.ts:483` `GitPushTool`（`force` 走既有 `destructiveGuard`）、`:556` `GhPrCreateTool`、`:592` `CiStatusTool`（零新增依赖，缺 `gh` 时返回可读诊断）；`registry.ts:156-158,332-334` 注册；`git-extended.test.ts` 6 项 |
| W-4 | swarm teammate 有界并发 | `src/gyccode/tool/swarm.ts:34,43-57,129-130,270` 由 `unbounded` 改为信号量有界，默认 4、夹到上限、非法值回落；`swarm-concurrency.test.ts` 5 项 |
| W-5 | 备份回滚入口 | `git.ts:629` `FileRollbackTool` 复用 `file-backup.ts` 既有函数，未改动该文件；`registry.ts:159,335` 注册 |
| A-3 | `dontAsk` 权限模式 | `permission/modes.ts` 登记；`index.ts` 未命中 allow 的请求直接拒绝而不挂 `Deferred` |
| A-4 | 工作目录路径围栏 | `permission/index.ts:25` `FENCED_PERMISSIONS`；编辑/写入/读取/补丁/笔记本五类带 path 的权限做围栏校验 |
| A-5 | 权限拒绝流水表 | `src/core/session/permission-denial-table.ts` DDL；迁移 `20261001000003_permission_denials`；`migration.gen.ts:51`、`schema.gen.ts:292-294` |
| A-1 | 结构化错误落库 | `src/core/observability/error-audit-table.ts` DDL；`error-audit.ts`（写入函数 + 可注入 sink + 微任务投递）；`log-error.ts:12-26,32,38,45` 接线；`src/gyccode/effect/app-runtime.ts:178-182` 注入；迁移 `20261001000004_error_audit`；`error-audit.test.ts` 12 项 |
| S-05 | 高相似内容误替换 | `edit.ts:868-871,887` 已加「匹配跨度远大于 oldString 则拒绝」与「多处匹配要求补上下文」两道闸门 |
| S-06 | 缓存淘汰与读取状态同步 | `tool/read-cache.ts:42-56,94-95` readSet 与缓存淘汰语义对齐；`edit.ts:143,215`、`write.ts:98` 写后失效缓存 |
| TUI 崩溃 | 富渲染绕过句柄预算闸门 | `routes/session/index.tsx:2557,2874,2936`、`feature-plugins/system/diff-viewer.tsx:870-905`、`routes/session/permission.tsx:61-92` 四条路径补接入 `LimitedContent`；`rich-render-guarded.test.ts` 12 项锁死接线关系 |
| MCP 日志 | 长会话重复刷 `[MCP] Calling ... with params` | 源码侧早已改（`mcp/standard-elements.ts:78-81` 需 `GYCCODE_DEBUG=1` 才输出）；实际来源是 9 月的陈旧孤儿产物 `dist/cli/tui/worker.js`，已删除 |
| 模型目录 | 全量同步与指定免费模型核验 | `bun scripts/sync-models.mjs` → 220 供应商 / 8157 模型；Ling 3.0 Flash Sante 与 Laguna S 2.1 均已收录；**Pixel Canary 在全部 220 家供应商中均无记录**（见 U-1） |
| 手册 | 附录 A/B/C 此前未接入生成脚本 | `scripts/gen_manual_docx.py:33-34,136-141` 补 `import manual_content_8/9` 并串入 `appendix_a/b/c`；`manual_content_5.py` 补四个新工具与 `git_commit.run_checks`；`manual_content_3.py` 补 `dontAsk`、路径围栏与拒绝流水 |

### ❌ 未解决项（需谷总决策）

| 编号 | 内容 | 现状 |
|---|---|---|
| U-1 | Pixel Canary 未收录 | 对 `models-mirror/api.json` 全部 220 家供应商做 `pixel` / `canary` 模糊检索，零命中。无法确认它是新发布尚未被上游目录收录，还是名称记法有误。若能提供确切的供应商与模型 ID，可作为临时补充收录 |
| U-2 | `Failed to create TextBuffer` 原生路径根因 | 已把四条富渲染路径纳入句柄预算闸门并加测试锁死，但未能复现崩溃本身（opentui 真实渲染需原生终端，bun test 起不来）。若仍复现，需在原生终端下抓取句柄分配栈 |
| U-3 | tool part 状态停在 `running`（生产库 24 条残留） | 与权限超时无关：超时只救活未被杀死的进程，被 SIGKILL 的 part 不会落地对账。根因未定位，需先确认会话启动是否存在状态对账路径 |

### ✅ 已决策（历史，供追溯）

| # | 内容 | 决策 |
|---|---|---|
| C1 | IDE 传输接入 | 2026-08-12：不接线，记录待设计（D1） |
| C3 | debug 插件 /tmp 路径 | 2026-08-12：已修正为 os.tmpdir()（平台无关） |
| A/B | 执行器统一 / API 收敛 | 2026-08-12：仅出路线图（报告已写入），不实施 |

---

---

## 2026-10-04 取证复核（撤回 4 条误判）

对本轮提出的 5 条「已确认缺陷」逐条回源码核对，**4 条不成立**，已从缺陷清单移除：

| # | 原说法 | 裁定 | 实据 |
|---|---|---|---|
| 1 | 权限 ask 无超时 | 已修并推送 | `c6893c3`；`src/gyccode/permission/index.ts:243-261` 有 `Effect.timeout` + `catchTag("TimeoutError")` → `RejectedError`，`:35` 默认 30 分钟，已配 `ask-timeout.test.ts` |
| 2 | `gyc run` 25 分钟挂起是 bug | 不成立 | 默认 30 分钟自动拒绝；复现时提前 5 分钟 kill，未观察到恢复 |
| 3 | task 表 token 口径分叉 | 不成立 | `src/core/session/task-table.ts:15-20` 无 `tokens_reasoning` 列，reasoning 并入 output 是单桶设计 |
| 4 | post-commit 推送静默失败 | 不成立 | `.githooks/post-commit:9-12` 本就有 `if ! err=$(...)` → 追加 `.git/worklog-sync.log` |
| 5 | 守卫漏检跨行空 catch | 已修并推送 | `d94e86e`；`scripts/check-bug-patterns.mjs:39-41` 已是整段 `text.matchAll(...)` 而非逐行匹配 |

第 5 条已实测验证：以 `.ts` 探针确认跨行空 catch 被拦截（退出码 1），带注释的 `catch (e) { /* … */ }` 不误报。

> 注意：守卫不扫 `.mjs`，用 `.mjs` 探针会得到假阴性（文件数不变）。

> 教训：`git show <ref>` 取到的内容可能滞后于工作区。判定缺陷必须以**工作区实际文件**为准，
> 否则会把已修复项当成缺陷重复报。

## 相关文档
- 架构评估报告：`docs/compose/reports/2026-08-12-architecture-convergence.md`
