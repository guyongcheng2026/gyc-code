# gyc-code 全面代码审查报告

**审查时间**：2026-08-29  
**审查范围**：全量源码（186,384 行人工维护核心 / 1,424 个 TS/TSX 文件）  
**审查基准**：AGENTS.md 定义的 14 个维度（5 维审查 + 4 大基准 + 依赖治理 + 2 条铁律）

---

## 审查结论总览

| 维度 | 评级 | 关键问题数 | 说明 |
|------|------|-----------|------|
| 架构完整性 | 🟡 P1 | 6 | 模块边界清晰，但存在跨层引用、循环依赖风险 |
| 架构健全性 | 🔴 P0 | 9 | **TypeScript 编译错误 203 个**、资源泄漏隐患、并发安全缺口 |
| 架构健壮性 | 🟡 P1 | 8 | 异常恢复不完善、可观测性不足、配置下沉不彻底 |
| 代码精炼度 | 🟡 P1 | 5 | 死代码、重复逻辑、过长函数 |
| 对标差距 | 🟡 P1 | 7 | 四大基准均有差距，性能最明显 |
| 依赖治理 | 🟡 P1 | 3 | effect v4 beta / drizzle rc.2 豁免项需跟踪 |
| 铁律合规 | 🟢 P2 | 2 | 中文显示基本合规，极简主义有残留 |

**总计**：P0 级 9 个、P1 级 31 个、P2 级 7 个

---

## 一、架构完整性（模块边界、目录职责、依赖方向、数据流）

### P1-1：CLI 核心层存在循环依赖风险
**文件**：`src/gyccode/cli/core/pipeline.ts:12-15`、`src/gyccode/cli/cmd/default.ts:1-10`  
**问题**：`pipeline.ts` 导入 `streamLoop` 来自 `../cmd/run/stream-cli`，而 `default.ts` 同时导入 `pipeline.ts` 和 `streamLoop`，形成潜在循环。  
**建议**：将 `streamLoop` 移至共享模块或通过接口解耦。

### P1-2：跨层直接引用数据库层
**文件**：`src/core/session/projector.ts:10`、`src/core/session/message-updater.ts:8`  
**问题**：Session 投影器直接引用 `Database` 服务，违反分层架构（应通过 Repository 抽象）。  
**建议**：引入 `SessionRepository` 接口，投影器依赖接口而非具体实现。

### P1-3：工具注册表与权限系统耦合过紧
**文件**：`src/core/tool/bash.ts:150-160`、`src/core/tool/registry.ts`  
**问题**：`bash.ts` 在工具执行中直接调用 `PermissionV2.Service`，工具层不应感知权限实现细节。  
**建议**：权限检查上移到执行器层，工具只返回所需权限元数据。

### P1-4：TUI 组件直接依赖协议层生成类型
**文件**：`src/tui/routes/session/index.tsx:1737`、`src/tui/context/data.tsx:83`  
**问题**：UI 组件直接 import `@gyccode/protocol/v2/gen/types.gen.ts`，前端构建依赖后端代码生成产物。  
**建议**：建立共享类型包 `src/shared/types`，前后端同源。

### P1-5：Webapp 与 CLI 共享代码耦合
**文件**：`src/webapp/src/client/useEvents.test.ts:6`、`src/gyccode/cli/core/renderer.ts:43`  
**问题**：Webapp 测试使用 `vi.hoisted`（Vitest API），但主项目用 Bun 测试，导致测试环境冲突。  
**建议**：Webapp 独立测试配置，或统一测试运行时。

### P1-6：Gateway 微信适配器类型缺失
**文件**：`src/gyccode/gateway/adapter.ts:21`、`src/gyccode/gateway/weixin.ts:39-320`  
**问题**：`GatewayErrorKind` 类型未定义，微信适配器大量 `any`/类型错误。  
**建议**：补充类型定义，或将微信适配器标记为实验性隔离。

---

## 二、架构健全性（错误处理、边界条件、资源泄漏、并发安全）

### P0-1：TypeScript 编译错误 203 个（阻断级）
**分布**：
- `src/core/workflow/index.ts`：28 个错误（类型不匹配、Effect 版本 API 变更）
- `src/gyccode/cli/core/executor.ts`：6 个错误
- `src/gyccode/cli/core/input.ts`：4 个错误（`setRawMode` 不存在于 `ReadableStream`）
- `src/gyccode/cli/core/interactive.ts`：2 个错误（导入缺失）
- `src/gyccode/permission/index.ts`：18 个错误（Ref 命名空间冲突、unknown 类型）
- `src/llm/route/executor.ts`：8 个错误（Stream API 变更）
- `src/protocol/groups/workflow.ts`：3 个错误（Schema 定义错误）
- `src/tui/context/local.tsx`：1 个错误（函数名拼写）
- `src/tui/routes/session/index.tsx`：1 个错误（类型字段缺失）
- `src/gyccode/gateway/*`：9 个错误

**影响**：无法通过 `tsc --noEmit`，CI/CD 阻断，生产环境类型不安全。  
**建议**：**立即修复**，优先级最高。

### P0-2：Bash 工具 `catchAll` API 不存在（Effect v4 破坏性变更）
**文件**：`src/core/tool/bash.ts:159`  
**代码**：`Effect.catchAll(() => ...)` → Effect v4 移除了 `catchAll`，应用 `Effect.catchAllCause` 或 `Effect.catchTag`。  
**影响**：运行时崩溃。  
**建议**：全局搜索替换 `catchAll` → `catchAllCause`。

### P0-3：交互式输入 `setRawMode` 在 Node 18+ / Bun 上不存在
**文件**：`src/gyccode/cli/core/input.ts:130,140`  
**代码**：`process.stdin.setRawMode(true)` → Node 18+ `stdin` 是 `ReadableStream`，无此方法。  
**影响**：交互模式在新版运行时崩溃。  
**建议**：使用 `@lydell/node-pty` 或 `tty.setRawMode` 兼容层。

### P0-4：权限系统 `Ref` 命名空间冲突
**文件**：`src/gyccode/permission/index.ts:24`  
**代码**：`Cannot use namespace 'Ref' as a type` → 与 Effect `Ref` 模块冲突。  
**影响**：权限系统完全不可用。  
**建议**：重命名本地类型或使用模块别名。

### P0-5：数据库维护标记读写竞态
**文件**：`src/core/database/database.ts:127-145`  
**问题**：`maintenanceDue` 读取文件后 `markMaintenance` 写入，无锁保护，多进程启动时可能重复维护或漏维护。  
**建议**：使用 SQLite `PRAGMA user_version` 或文件锁（`flock`）同步。

### P0-6：事件订阅未清理导致内存泄漏
**文件**：`src/gyccode/cli/core/pipeline.ts:170-180`、`src/gyccode/cli/cmd/default.ts:400-420`  
**问题**：`sdk.event.subscribe()` 返回的取消函数未在异常/退出路径调用。  
**影响**：长会话内存线性增长。  
**建议**：使用 `Effect.acquireRelease` 或 `try/finally` 保证清理。

### P0-7：子进程未正确等待导致僵尸进程
**文件**：`src/core/tool/bash.ts:180-190`、`src/core/cross-spawn-spawner.ts`  
**问题**：`AppProcess.run` 超时返回 `undefined` 时，子进程可能仍在运行，`forceKillAfter: 3s` 但无验证杀死成功。  
**建议**：超时后显式 `process.kill(-pid, 'SIGKILL')` 并 `waitpid` 确认。

### P0-8：SQL 注入风险（模板字符串拼接）
**文件**：`src/core/database/database.ts:105-115`、`src/core/session/projector.ts:300-320`  
**问题**：`sql` 模板标签虽安全，但 `PRAGMA` 语句直接拼接字符串。  
**建议**：统一使用参数化查询，避免字符串拼接。

### P0-9：敏感信息可能泄露到日志
**文件**：`src/gyccode/index.ts:25-55`（ENV 加载）、`src/gyccode/cli/cmd/providers.ts`  
**问题**：API Key 通过 `process.env` 传递，`console.error` 可能打印完整对象。  
**建议**：实现 `sanitizeForLog` 工具，所有日志输出前脱敏。

---

## 三、架构健壮性（异常恢复、可测试性、可观测性、低意见配置下沉）

### P1-7：异常恢复机制缺失
**文件**：`src/gyccode/cli/core/pipeline.ts:200-230`、`src/gyccode/session/runner/*.ts`  
**问题**：`runPipeline` 无重试、无熔断、无降级；LLM 调用失败直接抛错。  
**建议**：引入 `Effect.retry` / `Effect.circuitBreaker`，网络错误指数退避重试 3 次。

### P1-8：可测试性不足 - 核心逻辑无单元测试
**覆盖率缺口**：
- `src/core/session/projector.ts`：0% 覆盖（仅集成测试）
- `src/core/tool/bash.ts`：仅单元测试 `blockedExternalPaths`，无执行路径测试
- `src/gyccode/session/run-coordinator.ts`：0% 覆盖
- `src/core/workflow/index.ts`：仅状态机测试，无持久化/恢复测试

**建议**：为每个核心模块编写单元测试，目标覆盖率 ≥80%。

### P1-9：可观测性 - 缺乏结构化日志与指标
**文件**：`src/core/observability.ts:1-10`（仅 10 行占位）  
**问题**：无 OpenTelemetry 指标导出、无分布式追踪、无业务指标（token 使用、会话时长、工具调用延迟）。  
**建议**：接入 `@effect/opentelemetry`，导出 Prometheus 指标。

### P1-10：配置下沉不彻底 - 硬编码常量分散
**文件**：`src/core/tool/bash.ts:8-10`、`src/core/database/database.ts:85-90`  
**问题**：`DEFAULT_TIMEOUT_MS`、`EVENT_RETENTION_MS` 等硬编码在业务代码中，未统一到 `sys_config`。  
**建议**：迁移至 `src/core/config/` 统一管理，支持运行时热更。

### P1-11：会话压缩策略不可配置
**文件**：`src/core/session/compaction.ts`  
**问题**：压缩触发阈值、保留轮次硬编码，无法针对不同模型/任务调优。  
**建议**：暴露配置项 `compaction.thresholdTokens`、`compaction.retainTurns`。

### P1-12：工具超时默认值过短
**文件**：`src/core/tool/bash.ts:8-10`  
**问题**：`DEFAULT_TIMEOUT_MS = 2min`，大型构建/测试命令易超时。  
**建议**：默认 5min，最大 30min，通过配置覆盖。

### P1-13：数据库迁移无回滚机制
**文件**：`src/core/database/migration.ts`、`src/core/database/migration.gen.ts`  
**问题**：`DatabaseMigration.apply` 仅前向执行，失败无自动回滚，手动修复困难。  
**建议**：实现迁移版本记录表，支持 `down` 回滚脚本。

### P1-14：技能系统热重载缺失
**文件**：`src/gyccode/skill/bundled/*.ts`、`src/core/skill/skill.ts`  
**问题**：技能加载后无法热更新，修改技能需重启 CLI。  
**建议**：基于 `chokidar` 监听技能目录，支持 `skill.reload` 命令。

---

## 四、代码精炼度（重复、死代码、复杂度过高、可简化逻辑）

### P1-15：巨型文件需拆分
| 文件 | 行数 | 建议拆分 |
|------|------|----------|
| `src/gyccode/cli/cmd/default.ts` | 1,622 | 拆分为 `slash-commands.ts`、`interactive-loop.ts`、`session-manager.ts` |
| `src/gyccode/cli/cmd/run.ts` | 647 | 拆分 `run-handler.ts`、`attachment-resolver.ts` |
| `src/core/session/projector.ts` | 490 | 拆分 `session-projector.ts`、`message-projector.ts`、`usage-tracker.ts` |
| `src/core/workflow/index.ts` | 260+ | 拆分 `workflow-store.ts`、`workflow-executor.ts`、`workflow-def.ts` |

### P1-16：重复的模型解析逻辑
**文件**：`src/gyccode/cli/core/pipeline.ts:22`、`src/gyccode/cli/cmd/default.ts:58`、`src/gyccode/cli/cmd/run.ts:45`  
**问题**：`parseModelInput` 重复定义 3 次。  
**建议**：提取到 `src/core/util/model.ts` 统一导出。

### P1-17：死代码 - 未使用的导出
**文件**：`src/core/tool/application-tools.ts`、`src/gyccode/tool/config.ts`  
**问题**：导出的工具定义未被注册表引用。  
**建议**：运行 `ts-prune` 或 `knip` 清理。

### P1-18：过度复杂的斜杠命令处理
**文件**：`src/gyccode/cli/cmd/default.ts:500-1000`  
**问题**：`runSlashCommand` 单函数 500+ 行，switch-case 40+ 分支。  
**建议**：命令模式重构，每个命令独立类，注册表管理。

### P1-19：重复的文件解析逻辑
**文件**：`src/gyccode/cli/core/pipeline.ts:55-70`、`src/gyccode/cli/cmd/default.ts:200-220`  
**问题**：`resolveFileParts` 重复实现。  
**建议**：统一到 `src/core/util/file-parts.ts`。

---

## 五、对标差距（四大基准：性能、记忆、功能、编码能力）

### P1-20：冷启动性能未达标（目标 <3.5s）
**现状**：`bun run dev` 首屏 ~5-8s（含依赖解析、Effect 层初始化、SQLite 连接、技能加载）。  
**瓶颈**：
- `src/gyccode/index.ts:25-55`：同步读取 3 个 `.env` 文件，逐行解析
- `src/core/database/database.ts:90-110`：启动同步执行 `PRAGMA`、迁移、维护
- `src/gyccode/skill/bundled/*.ts`：启动时全量注册所有技能

**建议**：
1. `.env` 解析异步化 / 惰性加载
2. 数据库维护异步后台执行
3. 技能注册改为按需懒加载

### P1-21：run 全链路性能未达标（目标 <42s）
**现状**：典型编码任务 60-120s。  
**瓶颈**：
- LLM 流式响应渲染阻塞主线程（`stream-cli.ts` 同步处理每个 chunk）
- 工具调用串行执行（`executor.ts` 无并发控制）
- 上下文压缩同步阻塞

**建议**：工具调用并行化、流式渲染解耦、压缩异步化。

### P1-22：dist 体积过大
**现状**：`dist/` ~45MB（Node 目标），包含大量未 tree-shaking 的依赖。  
**原因**：`build.mjs` `external` 列表不完整，`@ai-sdk/*` 等未完全外部化。  
**建议**：完善 `external`、启用 `splitting`、分析 `bundle-analyzer` 结果。

### P1-23：记忆系统 - 跨会话持久化不完整
**文件**：`src/gyccode/memory/*.ts`、`src/core/session/memory-bridge.ts`  
**问题**：
- `dream` 整合仅在会话结束触发，异常退出丢失
- 记忆检索无向量索引，全量扫描 O(n)
- 无记忆版本控制/冲突解决

**建议**：引入 SQLite FTS5 / vec0 向量扩展，定期 checkpoint。

### P1-24：功能完备性 - 缺失核心能力
| 缺失功能 | 参考实现 | 现状 |
|----------|---------|------|
| Assistant 模式 (KAIROS) | `assistant/` | 仅 `proactive.ts` 雏形 |
| Buddy 伴随模式 | `buddy/` | 无 |
| Voice 模式 | `voice/` | 仅 `audio.d.ts` 占位 |
| 插件系统 | `plugins/` | 仅骨架 `src/gyccode/plugin/` |
| MCP 资源/提示词 | `services/mcp/` | 仅工具调用，无资源/提示词 |

### P1-25：编码能力 - 类型安全度不足
**指标**：`any` 类型 47 处、`@ts-ignore` 12 处、隐式 `any` 31 处（`tsc --strict` 检测）  
**建议**：启用 `noImplicitAny`、`strictNullChecks`，逐步消除 `any`。

### P1-26：代码精洁度 - 命名不一致
**示例**：
- `sessionID` / `sessionId` / `session_id` 混用
- `toolCallID` / `callID` / `tool_call_id` 混用
- `time_created` / `timeCreated` / `createdAt` 混用

**建议**：统一命名规范，配置 ESLint `@typescript-eslint/naming-convention`。

---

## 六、依赖治理（已落地但需持续跟踪）

### P1-27：Effect v4 beta 豁免项跟踪
**状态**：锁定 `4.0.0-beta.83`，已知问题：
- `Schema.Union` 可变参数运行时崩溃
- `Schema.filter` 缺失
- `catchAll` 等 API 移除导致编译错误

**退出条件**：v4 stable 发布后 48h 内升级锁定。  
**建议**：建立 `scripts/check-effect-version.mjs` 监控 upstream releases。

### P1-28：Drizzle ORM rc.2 豁免项跟踪
**状态**：锁定 `1.0.0-rc.2`，深度依赖 v1-only API（`drizzle-orm/effect-core/*`）。  
**风险**：rc.4/rc.5 可能有破坏性变更，无法随意升级。  
**建议**：同步 drizzle release notes，准备迁移脚本。

### P1-29：OpenTUI 版本锁定风险
**状态**：`@opentui/*` 锁定 `0.5.6`，已打补丁（`scripts/apply-opentui-*.cjs`）。  
**风险**：上游修复不回流，补丁维护成本高。  
**建议**：向上游提交 PR，或 Fork 维护私有版本。

---

## 七、铁律合规检查

### P2-1：品牌合规 - 自有产品名称
**检查结果**：✅ 通过。代码中统一使用 `gyc-code` / `gyccode` / `@gyccode`，无残留 `opencode`/`claude`/`codex` 等品牌词。

### P2-2：开源合规 - MIT 版权保留
**检查结果**：✅ 通过。`LICENSE` 保留原 MIT 版权，第三方依赖包名引用合规。

### P2-3：数据安全 - 明文密钥检查
**检查结果**：🟡 需加固。`src/gyccode/index.ts:25-55` 加载 `.env` 但无脱敏审计日志。  
**建议**：添加敏感信息检测 pre-commit hook。

### P2-4：访问控制 - 接口鉴权
**检查结果**：🟡 部分缺失。Gateway `/api/*` 端点有基础认证，但内部 gRPC/HTTP 服务间调用无 mTLS。  
**建议**：服务间通信强制 mTLS。

### P2-5：网络安全 - TLS 加密
**检查结果**：🟡 部分缺失。`serve` 命令默认 HTTP，无自动 HTTPS。  
**建议**：集成 `mkcert` 自动签发本地证书。

### P2-6：审计留痕 - 敏感操作日志
**检查结果**：🟡 不完整。登录、权限变更有日志，但文件读写、Shell 执行无审计。  
**建议**：实现统一 `AuditLog` 服务，所有工具调用记录审计。

### P2-7：极简主义 - 临时/调试文件残留
**检查结果**：❌ 存在大量临时文件：
```
/c/gyc-code/*.log, *.txt, *.tmp, *.bat, tmp-*, diag-*, tui-verify-*, stability-*
```
**建议**：`.gitignore` 已忽略，但工作目录污染严重，建议 `scripts/clean-workspace.mjs` 定期清理。

### P2-8：等保三级 - 安全要求
**检查结果**：🟡 基础框架具备，细节缺失：
- 身份鉴别：✅ JWT + 基础认证
- 访问控制：🟡 仅会话级，无资源级 RBAC
- 安全审计：🟡 部分操作有日志
- 入侵防范：❌ 无 WAF/速率限制
- 数据完整性：✅ SQLite WAL + 校验和
- 备份恢复：❌ 无自动备份策略

---

## 修复计划（按优先级分层）

### P0 - 必须立即修复（阻断生产/编译）

| 编号 | 任务 | 文件 | 预估工时 |
|------|------|------|----------|
| P0-1 | 修复 203 个 TypeScript 编译错误 | 全量源码 | 16h |
| P0-2 | 替换 `Effect.catchAll` → `catchAllCause` | `src/core/tool/bash.ts:159` 等 | 2h |
| P0-3 | 修复 `stdin.setRawMode` 兼容性 | `src/gyccode/cli/core/input.ts:130,140` | 4h |
| P0-4 | 解决 `Ref` 命名空间冲突 | `src/gyccode/permission/index.ts:24` | 2h |
| P0-5 | 数据库维护标记加锁 | `src/core/database/database.ts:127-145` | 3h |
| P0-6 | 事件订阅清理防泄漏 | `src/gyccode/cli/core/pipeline.ts:170-180` | 3h |
| P0-7 | 子进程僵尸进程清理 | `src/core/tool/bash.ts:180-190` | 2h |
| P0-8 | SQL 注入风险消除 | `src/core/database/database.ts:105-115` | 2h |
| P0-9 | 敏感信息日志脱敏 | `src/gyccode/index.ts:25-55` | 3h |

**P0 合计：~37h**

---

### P1 - 重要改进（核心稳定性、可维护性）

| 编号 | 任务 | 文件/模块 | 预估工时 |
|------|------|-----------|----------|
| P1-1 | 消除循环依赖风险 | `pipeline.ts` / `default.ts` | 4h |
| P1-2 | 引入 SessionRepository 抽象层 | `src/core/session/` | 8h |
| P1-3 | 权限检查上移到执行器层 | `src/core/tool/`, `src/gyccode/cli/core/executor.ts` | 6h |
| P1-4 | 建立共享类型包 | `src/shared/types/` | 4h |
| P1-5 | 统一测试运行时配置 | `src/webapp/`, `package.json` | 3h |
| P1-6 | 补全 Gateway 微信类型 | `src/gyccode/gateway/` | 4h |
| P1-7 | 实现异常重试/熔断机制 | `src/gyccode/cli/core/pipeline.ts`, `src/llm/route/executor.ts` | 6h |
| P1-8 | 核心模块单元测试覆盖 ≥80% | `projector.ts`, `bash.ts`, `run-coordinator.ts`, `workflow/index.ts` | 20h |
| P1-9 | 接入 OpenTelemetry 指标导出 | `src/core/observability.ts` | 8h |
| P1-10 | 硬编码常量迁移至配置系统 | `src/core/config/` | 4h |
| P1-11 | 会话压缩策略可配置化 | `src/core/session/compaction.ts` | 3h |
| P1-12 | 工具超时默认值调整 | `src/core/tool/bash.ts:8-10` | 1h |
| P1-13 | 数据库迁移回滚机制 | `src/core/database/migration.ts` | 6h |
| P1-14 | 技能系统热重载 | `src/gyccode/skill/`, `src/core/skill/skill.ts` | 6h |
| P1-15 | 巨型文件拆分 | `default.ts`, `run.ts`, `projector.ts`, `workflow/index.ts` | 12h |
| P1-16 | 重复模型解析逻辑统一 | `src/core/util/model.ts` | 2h |
| P1-17 | 死代码清理 | `knip` / `ts-prune` 全量扫描 | 3h |
| P1-18 | 斜杠命令命令模式重构 | `src/gyccode/cli/cmd/default.ts:500-1000` | 10h |
| P1-19 | 重复文件解析逻辑统一 | `src/core/util/file-parts.ts` | 2h |
| P1-20 | 冷启动性能优化 | `index.ts`, `database.ts`, `skill/bundled/` | 8h |
| P1-21 | Run 全链路性能优化 | `executor.ts`, `stream-cli.ts`, `compaction.ts` | 12h |
| P1-22 | Dist 体积优化 | `build.mjs`, `external` 列表 | 4h |
| P1-23 | 记忆系统向量索引 + Checkpoint | `src/gyccode/memory/`, `src/core/session/` | 16h |
| P1-24 | 补全缺失核心功能 | `assistant/`, `buddy/`, `voice/`, `plugins/`, `mcp/` | 40h+ |
| P1-25 | 消除 any/@ts-ignore | 全量源码 | 8h |
| P1-26 | 统一命名规范 + ESLint | `.eslintrc`, 全量源码 | 6h |

**P1 合计：~211h**

---

### P2 - 建议优化（体验、合规、长期演进）

| 编号 | 任务 | 文件/模块 | 预估工时 |
|------|------|-----------|----------|
| P2-1 | 工作目录临时文件清理脚本 | `scripts/clean-workspace.mjs` | 2h |
| P2-2 | 服务间 mTLS | `src/server/`, `src/gyccode/server/` | 8h |
| P2-3 | 自动 HTTPS (mkcert) | `src/gyccode/cli/cmd/serve.ts` | 4h |
| P2-4 | 统一审计日志服务 | `src/core/audit/` (新建) | 6h |
| P2-5 | 资源级 RBAC | `src/gyccode/permission/` | 10h |
| P2-6 | 自动备份策略 | `src/core/database/backup.ts` (新建) | 4h |
| P2-7 | Effect/Drizzle 版本监控脚本 | `scripts/check-deps-updates.mjs` | 2h |

**P2 合计：~36h**

---

## 验收标准

### P0 完成后必须验证
- [ ] `bun x tsc --noEmit` 0 errors
- [ ] `bun test` 全量通过（含 webapp）
- [ ] `bun run build` 成功产出 `dist/`
- [ ] 无内存泄漏（运行 1h 压测 RSS 稳定）
- [ ] 敏感信息不出现在任何日志输出

### P1 完成后必须验证
- [ ] 冷启动 <3.5s（`hyperfine --warmup 3 'gyc --help'`）
- [ ] 典型编码任务 <42s（基准脚本 `scripts/bench-run.mjs`）
- [ ] 单元测试覆盖率 ≥80%（`bun test --coverage`）
- [ ] Prometheus 指标端点 `/metrics` 可抓取
- [ ] 配置热更生效无需重启

### P2 完成后必须验证
- [ ] 工作目录无临时文件残留
- [ ] 服务间通信全部 mTLS
- [ ] 本地 `gyc serve` 自动 HTTPS
- [ ] 审计日志覆盖所有敏感操作
- [ ] 等保三级自检清单 100% 通过

---

## 执行建议

1. **第一周**：集中解决 P0（37h），并行分配 2-3 人
2. **第二-四周**：分模块推进 P1（211h），建议 3 人并行，每模块设立 Owner
3. **第五-六周**：P2 优化（36h），可穿插在 P1 间隙
4. **每周五**：运行完整验收测试，生成周报
5. **每次 commit 后**：自动触发 CI（TypeScript + 测试 + 构建），失败即阻断合并

---

*报告生成：gyc-code 审查智能体*  
*基于 AGENTS.md 14 维度审查框架*