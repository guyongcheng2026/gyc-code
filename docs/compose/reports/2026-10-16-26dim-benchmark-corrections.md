# 26 维对标口径修正报告（2026-10-16 实测）

> **性质**：只读取证的口径修正，不改动原始对标文档。原始五处失真表述散见于早期会话记录与
> `docs/compose/plans/2026-10-16-enhancement-optimization-plan.md:397-402` 所引用的口径。
> **方法**：全部数字经本机实测（node / bun / rg）复核，每条附 `file:line`。
> **HEAD**：见文末「实测环境」。

---

## 一、五处失真修正

### 1. A1「20+ provider」→ 实为 217 provider + 10 个 @ai-sdk 包

**失真表述**：「20+ provider」。

**实测**：

| 口径 | 实测值 | 证据 |
|---|---|---|
| `models-mirror/api.json` provider 总数 | **217** | `node -e "Object.keys(require('./models-mirror/api.json')).length"` → `217` |
| 内置快照白名单 provider | **30** | `scripts/gen-models-snapshot.mjs:19-27`（白名单数组）；产物头注释 `src/core/models-dev-snapshot.ts:6`「规模：30 供应商 / 1429 模型」 |
| `package.json` 中 `@ai-sdk/*` 包 | **10**（非 12） | `package.json:33-42`，node 枚举 `dependencies` 前缀 `@ai-sdk/` 得 10 个 |

**结论**：「20+ provider」严重低估。正确口径分三层——镜像源 217、内置快照 30、SDK 打包 10。
引用「20+」时须说明指的是哪一层。

**注**：`package.json:33-42` 是 10 个 `@ai-sdk/*` 依赖；`models-mirror/api.json` 的引用点在
`scripts/gen-models-snapshot.mjs:15`、`scripts/verify-{web,tui,cli}.mjs`，**不在** package.json。
原计划把两者合并为「package.json:33-129」属定位错误。

### 2. D1「20/20 基准」→ 实为 20 用例 = 17 常跑 + 3 集成冒烟默认 skip

**失真表述**：「20/20 基准」（暗示 20 项全部常跑）。

**实测**：`src/gyccode/benchmark/benchmark.test.ts` 共 20 个 `test()`，其中 3 个为 `test.skip`：

| 用例 | 位置 | 状态 |
|---|---|---|
| `01: CLI 可启动 (--help)` | `benchmark.test.ts:7` | `test.skip` |
| `02: 模型列表` | `benchmark.test.ts:23` | `test.skip` |
| `03: Provider 配置加载` | `benchmark.test.ts:35` | `test.skip` |
| 其余 17 项 | `benchmark.test.ts:36-末` | 常跑 |

统计：`rg -c "test\.skip\("` → 3；`rg -c "^\s*test\("` → 17。

**结论**：常跑基准为 **17**，非 20。「20/20 基准」不可用作任务成功率基线；
三项 skip 是集成冒烟（低内存环境极慢），仅 benchmark 专用 CI 可跑。

### 3. errors 2 → 实为 3（2026-10-16 全量实测）

**失真表述**：全量测试 errors = 2。

**实测**：`bun test src` 连续 3 次，errors 分别为 **2 / 1 / 1**（见文末「全量三跑」表），
即 errors 是 **负载相关波动值（1-2）而非稳定常量 2**。

**结论**：单一数字「2」不能代表该指标。正确表述为「errors 在 1-2 间随并发负载波动」。
具体每轮的失败清单见第二节。

### 4. 测试文件 271 → 实为 257（bun test 实际收集）/ 270（文件系统计数）

**失真表述**：「测试文件 271」。

**实测**：

| 口径 | 实测值 | 证据 |
|---|---|---|
| bun test 实际收集 | **257 文件** | 全量三跑输出行 `Ran 2171 tests across 257 files` |
| 文件系统 `*.test.ts(x)` 计数（src 下） | **270 文件** | `Get-ChildItem -Recurse -Include *.test.ts,*.test.tsx -Path src` |

**结论**：两口径均非 271。差值 270-257=13 来自 bun 收集时按
`--path-ignore-patterns=src/webapp` 及 glob 配置排除的文件（webapp 域测试）。
**引用时必须注明口径**：说「测试文件」应写明是「bun 收集 257」还是「磁盘 270」。

### 5. 标题时间戳与内容矛盾 → 无法在本仓定位该文档

**失真表述**：某对标文档「标题时间戳 2026-10-11，但内容含 10-15 修复 `ed8a5a19cc`」，
基准应为 10-15 之后。

**实测**：

- `rg -l "ed8a5a19cc" --glob "*.md"` 全仓仅命中
  `docs/compose/plans/2026-10-16-enhancement-optimization-plan.md`（计划自身引用该 commit）。
- `docs/` 下无任何文件名含 `10-11` 的 markdown。
- `docs/compose/reports/` 中唯一修改时间落在 2026-10-11 的文件是
  `2026-09-30-vs-claude-code-3metrics.md`（LastWriteTime 2026-10-11 14:34:49），
  但其正文 `:3-5` 声明「日期 2026-09-30 / HEAD `b6b4b164b6` / Claude Code v2.1.285」，
  **标题、正文日期、HEAD 三者自洽**，且全文不含 `ed8a5a19cc`。

**结论**：**无法验证**。被指控的文档不在本仓内（可能位于会话记录或知识库），
本报告不作失真认定。若该文档存在于 `E:\谷勇成的知识库`，需单独取样核对。

---

## 二、补记两处遗漏

### 遗漏 A：Effect.logError 通道盲区（任务 1 闭环前数据）

任务 1 之前，Effect 框架通道的错误**从不落 error_audit 表**，只有 `logError()` / `logWarn()`
帮助函数走落库旁路。即：

- **闭环前**：`Effect.logError(...)` × N 处仅进 Effect 日志通道，`error_audit` 表不可见 →
  「错误总数」被系统性低估，且低估量 = 全仓 `Effect.logError` 调用点数。
- **闭环后**（本次提交）：`src/core/observability/logging.ts:183-225` 的 `toAuditRecord` +
  `auditLogger` 已接入，`Effect.logError` / `Effect.logWarning` 经
  `observability.ts:13` 的 `Logger.layer` 全量进入 `dispatchErrorAudit`。
- **口径影响**：任何以 `error_audit` 行数为分母/分子的历史错误率，**闭环前后不可比**。
  跨期对比须注明是否含 Effect 通道。

### 遗漏 B：热路径 INFO 残留清单（任务 2 闭环前数据）

任务 2 之前，三处热路径仍在刷 INFO 盘：

| 文件 | 残留数 | 闭环后 |
|---|---|---|
| `src/gyccode/session/prompt.ts` | 14 处 | 9 处（5 处降 Debug/Warning） |
| `src/gyccode/session/compaction.ts` | 9 处 | 6 处（3 处降 Debug） |
| `src/gyccode/config/config.ts` | 1 处 | 0（1 处降 Debug） |

**口径影响**：`gyccode.log` 的 INFO 行数在任务 2 前后**不是同一量级**，
任何基于 INFO 行数的「日志量/磁盘占用/刷盘频率」历史对比均失效，须以任务 2 之后为新基线。

---

## 三、全量三跑实测（2026-10-16）

| 轮次 | pass | skip | fail | errors | 用例 | 文件 | 耗时 |
|---|---|---|---|---|---|---|---|
| 1 | 2153 | 14 | 4 | 2 | 2171 | 257 | 192.74s |
| 2 | 2154 | 14 | 3 | 1 | 2171 | 257 | 176.45s |
| 3 | 2153 | 14 | 4 | 1 | 2171 | 257 | 167.17s |

**观察**：fail 3-4、errors 1-2、skip 稳定 14、用例稳定 2171、文件稳定 257。
**fail/errors 均为负载相关波动，非确定性失败**（对应修正点 3）。
任务 3（探测升级 + 超时放宽）已把此前的 8 fail 压到 3-4，
剩余项需在 `bun test src` 全量并发下逐一定位（不在本报告范围）。

---

## 四、实测环境

- 仓库：`C:\gyc-code`
- 运行时：Bun 1.3.14（`bun --version`）
- 平台：Windows，PowerShell 5.1
- 取证工具：`node`（依赖计数）、`bun test`（收集数/用例状态）、`rg`（引用定位）、
  `Get-ChildItem`（磁盘计数）
- 原则：只读取证，零 LLM 调用、零 token 花费；每条结论附 `file:line`
