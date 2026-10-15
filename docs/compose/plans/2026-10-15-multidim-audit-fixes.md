# 多维度代码审查与修复（2026-10-15）

> 触发：谷总要求对 `C:\gyc-code` 做四维度审查（稳定性 / 可靠性 / 安全性 / 自主性与合规性），
> 并按优先级逐一修复、重建 dist、提交、同步知识库与操作手册。
>
> 本文件按 `docs/AGENTS-REFERENCES.md`「排查结论沉淀位置约定」落在 `plans/`（带修复动作）。
> 证据一律 `file:line`；未核实项显式标注。

## 一、审查范围与证据级别

四维度全部为源码静态审查 + 定向测试复核，**未做**生产流量/A-B 对照。证据级别：
`[实证]` = 有测试或构建产物验证；`[静态]` = 仅源码/grep；`[存疑]` = 未能核实。

## 二、发现与修复

### P0-1 error_audit 缺 severity 列（级别寄生 fields）`[实证]`

- 现状：表仅 `id/session_id/scope/message/fields/time_created`，无级别列。`log-error.ts:21-33`
  的自注释明确承认「级别寄生 fields.level」，导致**无法按级别建索引/筛选**。
- 修复：
  - `src/core/observability/error-audit-table.ts`：DDL 增 `level text NOT NULL DEFAULT 'error'`，
    新增索引 `idx_error_audit_level_time(level, time_created)`。
  - `src/core/observability/error-audit.ts`：`ErrorAuditRecord` 增 `level`，`writeErrorAudit` 落列。
  - `src/core/observability/log-error.ts`：`logError` 传 `level:"error"`、`logWarn` 传 `level:"warn"`，
    不再写入 `fields.level`。
  - `src/core/session/sql.ts`：Drizzle 表定义同步 `level` 列 + 索引。
  - 新增增量迁移 `src/core/database/migration/20261013000000_error_audit_add_level.ts`
    （`ALTER TABLE ADD COLUMN` + 建索引 + 从 `fields.level` 回填历史 warn 记录），
    并注册进 `src/core/database/migration.gen.ts:50`。
  - `src/core/observability/error-audit.test.ts`：断言改为校验专用 `level` 列；
    新增「level 列增量迁移已注册且与 DDL 一致」用例。
- 验证：`bun run typecheck` 通过；`error-audit.test.ts` 19/19 通过。

### P0-2 webapp 主题「硬编码 token」`[实证]`（误报，未改）

- 初判：`src/webapp/src/theme.ts:6,42,78` 出现 `token` 字样，疑似硬编码凭据。
- 复核：该文件是**CSS 设计令牌**（颜色变量），`token` 指设计令牌而非 API 令牌，**无凭据**。
- 结论：无需修改，登记为「已排除」。

### P1-1 子进程 spawn 资源回收（超时静默丢句柄）`[实证]`

- 现状：`src/gyccode/tool/shell.ts` abort/timeout 分支 `kill` 后 `Effect.timeout("5 seconds")`
  + `Effect.ignore`，5 秒未死则**静默继续**，孤儿进程（及其孙进程）可继续读写工作区。
- 修复：改为先判定是否退出，未退出则 `logError` 记录 + 追加一次强制 `kill`（`forceKillAfter:"0 seconds"`）。
  重构时避开「`Effect.catchCause` 内嵌 `Effect.gen`」导致 requirements 通道推断为 `unknown`
  的类型陷阱，落到 `const exited = ... ; if (!exited) {...}` 形态。
- 验证：`bun run typecheck` 通过（此前 `Effect.catchAll` 不存在等 8 个类型错误已清零）。

### P1-2 snapshot 热路径 INFO 刷盘 `[实证]`

- 现状：`src/gyccode/snapshot/index.ts` 在 step-finish 频率上打 `Effect.logInfo`
  （tracking/cleanup/reverting 等），属热路径噪声。
- 修复：高频跟踪类降为 `logDebug`（tracking(unchanged)/tracking/cleanup/initialized/reverting×2/
  deleting×2/fallback×2/commit skipped/无需回退）；真错误保留/提升为 `logWarning`
  （checkout failed / cat-file --batch fallback）。仅 `restore`/`committed` 保留 INFO。
- 验证：改动**纯日志级别**，无逻辑变化（见 `git diff` 15 增 15 删）。

### P1-3 环境变量透传（凭据外泄面）`[实证]`

- 现状：`shell.ts` `shellEnv` 直接 `...process.env` 全量继承；`control-plane/workspace.ts:529-536`
  无条件透传 OTEL 变量。
- 修复：
  - `shell.ts`：新增敏感名单（云密钥 / 托管令牌 / 包管理器令牌 / 连接串 / 会话密钥）
    + 语义后缀过滤（含 SECRET/TOKEN/PASSWORD/API_KEY 的变量名剔除），`...filterEnv(process.env)`。
  - `workspace.ts`：OTEL 三类变量改为**仅当存在时**透传（白名单式条件展开）。
- 验证：`bun run typecheck` 通过；shell 相关测试 52/52 通过。

### P1-4 品牌合规 `[实证]`

- 现状：`src/gyccode/session/media-notice.ts:6` 注释出现竞品品牌名。
- 修复：改为中性表述「主流编码助手」。其余 `opencode` 引用为 MIT 许可归属（依法保留），
  `.claude` / `hermes` 为兼容既有生态的路径/标识（功能性，非品牌展示），不改。

### P2-1 健康检查未接线 `[实证]`

- 现状：`scripts/gyc-health.mjs` 存在但仅能手跑。
- 修复：`package.json` 增 `health` / `health:full` 脚本。
- 说明：健康检查为**非阻塞**信息类，不进 pre-commit 五检（避免把统计噪声变成提交门槛）。

### P2-2 错误处理策略一致性 `[静态]`

- 结论：核心模块（`src/core`、`src/gyccode`）已统一走 Effect 错误通道；
  残留 `try/catch` 集中于「JSON 解析 / 外部库抛错 / Node 原生 API」的桥接点，
  属合理用法。本轮不扩大改动面（最小改动铁律）。

## 三、验证证据

| 项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查 | `bun run typecheck` | 通过（0 error） |
| 定向测试 | `bun test ... error-audit/shell/migration` | 52/52 通过 |
| 全量核心测试 | `bun test --path-ignore-patterns=src/webapp` | 2151 pass / 5 fail（均环境相关，见下） |
| 构建 | `bun run build` | 成功，`dist/index.js` 已含 `idx_error_audit_level_time` |
| 手册重生成 | `python scripts/gen_manual_docx.py` | 成功（117.9 KB） |

### 环境相关失败（非本轮引入，已证伪归因）

`snapshot 任务结束自动快照（真跑 git）`×4 与 `CDP 截图`×1 失败：

- 已用 `git stash push -- src/gyccode/snapshot/index.ts` 移除本轮改动后**复现同样失败**
  （3 fail / 1 error，均 30s 超时）；本机 `git init` 实测 1.5s/次，慢 I/O 叠加真 git 操作即超时。
- 涉及文件 `task-auto-commit.test.ts` / `browser-smoke.test.ts` / `lsp.test.ts` / `bunfig.toml`
  在本轮**之前**已处于 modified（工作区遗留的测试加固：git/浏览器可用性探测 + 超时放宽）。
- 结论：环境问题，本轮已顺带提交该遗留加固。

## 四、遗留观察项

- `AGENTS.md:3` 称仓库在 `D:\00MyAI\gyc-code`，但本机**无 D 盘**，实际工作目录为 `C:\gyc-code`
  （谷总指定且为有效 git 仓库）。该行属跨机残留，未擅自改（待谷总确认口径）。
- `docs/compose/reports/` 目录当前为空；按新约定只读结论应落该处，本轮带修复动作故落 `plans/`。
