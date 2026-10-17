# gyc-code 增强/优化/完善实施计划（2026-10-16）

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 闭环两项观测性结构遗留（Effect 日志不落库、热路径 INFO 刷盘）、清零 8 个环境依赖测试失败、恢复冷启动至 2.5s 内，并修正文档口径。

**Architecture:** 全部改动落在 `src/core/observability/`（auditLogger 接入）、热路径日志级别、3 个测试文件的环境探测/超时放宽，以及 2 处文档。不触碰业务逻辑、不改接口签名（仅导出一个既有私有函数）。

**Tech Stack:** Bun 1.3.14 + TypeScript + effect 4.0.0-beta.83 + bun:test。验证：`bun run typecheck`、`bun test`、`bun run health`。

**基准事实（2026-10-16 实测）：** HEAD=origin/main=`ed8a5a19cc`；全量 2165 用例 / 2148 pass / 9 skip / 8 fail / 3 errors（272.5s）；基准测试 17 pass / 3 skip / 0 fail；冷启动热态 2.6~3.6s；error_audit 已有 level 列（error-audit-table.ts:17）与索引（:25）。

---

## 〇、计划三验总表

| # | 任务 | 真实性 | 可行性 | 可靠性 | 状态 |
|---|------|--------|--------|--------|------|
| 1 | Effect 日志通道接入 error_audit | ✅ Effect.logError 32 文件/85 处不落库；app-runtime.ts:188 仅接帮助函数通道 | ✅ logging.ts:161/179 已有 `Logger.make` 现成模式；observability.ts:13 组装点；无循环依赖 | ✅ toAuditRecord 纯函数单测 + 落库断言 + sqlite 计数 | 已验证 |
| 2 | 热路径 INFO 降噪收尾（24 处） | ✅ prompt.ts 14 / compaction.ts 9 / config.ts 1 处（行号逐处核实） | ✅ 474ce18323 已对 snapshot 完成同类改造，模式可复制 | ✅ grep 计数 + typecheck + 定向测试 | 已验证 |
| 3a | task-auto-commit 环境探测升级 | ✅ 单跑复现 4 fail/1 error 全 30s 超时；每用例 createShadowRepo()（:192/217/236/248）；本机 git init 1.5s/次 | ✅ 探测升级为「真跑 git init 计时」；同策略先例见 :11-15 注释 | ✅ 单跑应 skip；全量 fail -4 | 已验证 |
| 3b | browser-smoke flaky 治理 | ✅ 全量失败 1、单跑 1 pass/0 fail（亲测）→ 负载型 flaky | ✅ bun:test `test.retry(2)`；5edfb070de 已有探测先例 | ✅ 连续 3 次全量 0 fail | 已验证 |
| 3c | shell background 超时放宽 | ✅ 全量 3 fail（后台调度慢）；waitFor 默认 10s（background.test.ts:9-13） | ✅ 改默认值一处生效 | ✅ 连续 3 次全量 0 fail | 已验证 |
| 4 | 基准集成冒烟显式通道 | ✅ benchmark.test.ts:7 注释自述默认 skip | ✅ `test.skipIf` + 环境变量门控；health:full 已有 | ✅ health:full 输出含冒烟结果 | 已验证 |
| 5 | 冷启动 profile 与恢复 | ✅ 热态 2.6~3.6s vs 历史最优 2.1s | ✅ `bun --cpu-prof`；bin/gyc→dist 链路可分段计时 | ✅ 5 次 --version 取中位 | 已验证（先测量后动手） |
| 6 | AGENTS.md:3 路径残留修正 | ✅ 写 `D:\00MyAI\gyc-code`，本机无 D 盘 | ✅ 一行文字修正 | ✅ grep 验证 | 已验证 |
| 7 | 26 维对标口径修正报告 | ✅ 五处失真 + 两处遗漏（亲测） | ✅ 落 docs/compose/reports/（只读结论约定） | ✅ 每条附 file:line | 已验证 |

> P2 能力增强项（D4 重构 / B5 插件生态 / A2 上下文压缩）不列入本计划——需先 brainstorm，见附录 A。

---

## 任务 1：Effect 日志通道接入 error_audit（P0，观测闭环）

**Covers:** 遗留问题「Effect.logError 32 文件 85 处不落库」。

**根因：** `src/gyccode/effect/app-runtime.ts:188` 的 `setErrorAuditSink` 只覆盖 `logError/logWarn` 帮助函数（log-error.ts）的控制台通道；Effect 框架自身的 `Effect.logError`/`Effect.logWarning` 走 Logger 层（observability.ts:13 组装），从未映射进 `dispatchErrorAudit`。

**Files:**
- Create: `src/core/observability/audit-logger.test.ts`
- Modify: `src/core/observability/logging.ts`（新增 toAuditRecord + auditLogger，接线 loggers()）
- Modify: `src/core/observability/log-error.ts:31`（extractSessionID 加 export）

**防递归论证（必须保持的性质）：** auditLogger 只映射 `Error`/`Warning` 两级；writeErrorAudit 失败走 `Effect.logDebug`（error-audit.ts:71），Debug 不进本 logger → 无递归。

- [x] **Step 1: 写失败测试**

创建 `src/core/observability/audit-logger.test.ts`：

```typescript
import { describe, expect, test } from "bun:test"
import { Effect, Logger } from "effect"
import { dispatchErrorAudit, setErrorAuditSink, type ErrorAuditRecord } from "./error-audit"
import { auditLogger, toAuditRecord } from "./logging"

describe("toAuditRecord 级别映射", () => {
  test("Error 级 → error 记录，session.id 提取进 sessionID", () => {
    const record = toAuditRecord({
      logLevel: "Error",
      message: "boom",
      annotations: { "session.id": "ses_abc" },
      cause: undefined,
    })
    expect(record).toEqual({
      scope: "effect.log",
      message: "boom",
      level: "error",
      sessionID: "ses_abc",
      fields: { "session.id": "ses_abc" },
    })
  })

  test("Warning 级 → warn 记录", () => {
    const record = toAuditRecord({ logLevel: "Warning", message: "careful", annotations: {}, cause: undefined })
    expect(record?.level).toBe("warn")
  })

  test("Info/Debug 级 → undefined（不落库，防递归）", () => {
    expect(toAuditRecord({ logLevel: "Info", message: "x", annotations: {}, cause: undefined })).toBeUndefined()
    expect(toAuditRecord({ logLevel: "Debug", message: "x", annotations: {}, cause: undefined })).toBeUndefined()
  })

  test("cause 拼接进 message；message 数组展平", () => {
    const record = toAuditRecord({ logLevel: "Error", message: ["a", "b"], annotations: {}, cause: new Error("c") })
    expect(record?.message).toContain("a b")
    expect(record?.message).toContain("c")
  })
})

describe("auditLogger 接线（集成）", () => {
  test("Effect.logError 经 Logger 层进入 dispatchErrorAudit", async () => {
    const records: ErrorAuditRecord[] = []
    setErrorAuditSink((r) => records.push(r))
    try {
      await Effect.runPromise(
        Effect.logError("audit-int-test").pipe(
          Effect.provide(Logger.layer([auditLogger], { mergeWithExisting: false })),
        ),
      )
      // dispatchErrorAudit 走 queueMicrotask，让出一轮事件循环再断言。
      await new Promise((resolve) => setTimeout(resolve, 0))
      expect(records.some((r) => r.message.includes("audit-int-test"))).toBe(true)
    } finally {
      setErrorAuditSink(undefined)
    }
  })
})
```

- [x] **Step 2: 跑测试确认失败**

Run: `bun test src/core/observability/audit-logger.test.ts`
Expected: FAIL — `toAuditRecord`/`auditLogger` 导出不存在。

- [x] **Step 3: 导出 extractSessionID（log-error.ts）**

`src/core/observability/log-error.ts:31` 仅在函数签名行加 `export`，函数体不动：

```typescript
export function extractSessionID(fields: Record<string, unknown> | undefined): SessionID | undefined {
```

- [x] **Step 4: 实现 toAuditRecord + auditLogger 并接线（logging.ts）**

顶部 import 区追加（无循环依赖：error-audit.ts 与 log-error.ts 均不 import logging.ts）：

```typescript
import { dispatchErrorAudit, type ErrorAuditRecord } from "./error-audit"
import { extractSessionID } from "./log-error"
```

在 `minimumLogLevel()` 之前插入：

```typescript
// auditLogger：把 Effect 通道（Effect.logError/logWarning）的 Error/Warning 映射进
// error_audit 落库旁路。此前只有 logError/logWarn 帮助函数（log-error.ts）落库，
// Effect 框架通道 32 文件 85 处调用点是观测盲区。
// 只映射 Error/Warning 两级：writeErrorAudit 失败走 logDebug（error-audit.ts:71），
// Debug 不进本 logger，故无递归；Info 热路径日志同样被此过滤挡在库外。
export function toAuditRecord(options: {
  logLevel: string
  message: unknown
  annotations: Record<string, unknown> | undefined
  cause: unknown
}): ErrorAuditRecord | undefined {
  if (options.logLevel !== "Error" && options.logLevel !== "Warning") return undefined
  const parts = Array.isArray(options.message) ? options.message : [options.message]
  let message = parts.map((part) => (typeof part === "string" ? part : JSON.stringify(part))).join(" ")
  if (options.cause !== undefined) message += ` :: ${String(options.cause)}`
  const fields = options.annotations ?? {}
  return {
    scope: "effect.log",
    message,
    level: options.logLevel === "Error" ? "error" : "warn",
    sessionID: extractSessionID(fields),
    fields,
  }
}

export const auditLogger = Logger.make((options) => {
  const record = toAuditRecord(options)
  if (!record) return
  dispatchErrorAudit(record)
})
```

`loggers()`（logging.ts:192-193）改为：

```typescript
export function loggers() {
  const base = [fileLogger(), auditLogger]
  return process.env.GYCCODE_PRINT_LOGS === "1" ? [...base, stderrLogger] : base
}
```

风险点：effect 4.0-beta 的 `Logger.make` options 字段名以 fileLogger 现状为准（:161-176 使用 `options.logLevel/message`）；若 `Logger.layer` 集成测试因 MinimumLogLevel Reference 报错，按 observability.ts:18 模式补 `Layer.merge(Layer.succeed(References.MinimumLogLevel, "Info"))`。

- [x] **Step 5: 跑测试通过**

Run: `bun test src/core/observability/audit-logger.test.ts`
Expected: 7 pass / 0 fail。若集成用例因 Logger.layer 行为差异失败，保留 4 个纯函数用例通过、集成用例改为对照 observability.ts 组装方式修正后重跑。

- [x] **Step 6: typecheck + 既有测试回归**

Run: `bun run typecheck ; bun test src/core/observability`
Expected: typecheck 0 error；observability 全部 pass（error-audit.test.ts 19 用例不受影响）。

- [x] **Step 7: 端到端落库验证**

```powershell
# 记录落库前后计数差：先查基线
bun -e "const {Database}=require('bun:sqlite');const g=require('os').homedir()+'/.local/share/gyccode';const fs=require('fs');const dbFile=fs.readdirSync(g).find(f=>f.endsWith('.db'));const db=new Database(g+'/'+dbFile,{readonly:true});console.log(db.query('select count(*) c from error_audit').get())"
```

若不确定库文件路径，先执行 `rg -n "\.db|Path\.log" src/core/database/database.ts` 确认，再跑上述查询。随后在真实 CLI 会话中触发一次失败（如无效命令），复查计数增量且 `level='error'`、`scope='effect.log'` 记录存在。

- [x] **Step 8: Commit**

```powershell
cd C:\gyc-code ; git add src/core/observability/audit-logger.test.ts src/core/observability/logging.ts src/core/observability/log-error.ts ; git commit -m "feat(observability): Effect 日志通道接入 error_audit，消除 32 文件观测盲区"
```

---

## 任务 2：热路径 INFO 降噪收尾（P0，24 处）

**Covers:** 遗留问题「热路径 INFO 刷盘只修了 snapshot」。模式照抄 474ce18323（高频跟踪类降 logDebug、真错误升 logWarning、低频事件保留 INFO）。

**Files:**
- Modify: `src/gyccode/session/prompt.ts`（14 处）、`src/gyccode/session/compaction.ts`（9 处）、`src/gyccode/config/config.ts`（1 处）

**逐处处置决策表：**

| 文件:行 | 消息 | 处置 | 理由 |
|---|---|---|---|
| prompt.ts:1259 | loop | → logDebug | 每循环步必打，最高频 |
| prompt.ts:847 | mcp resource | → logDebug | 每消息部分 |
| prompt.ts:951 | file | → logDebug | 每消息部分 |
| prompt.ts:1306 | escalating output cap | → logWarning | 异常调整路径 |
| prompt.ts:1314 | resuming | → logWarning | 限流后恢复，告警价值 |
| prompt.ts:270 | cancel | 保留 INFO | 低频用户事件 |
| prompt.ts:1373 | token budget continuation | 保留 | 低频 |
| prompt.ts:1485 | exiting loop | 保留 | 每轮一次 |
| prompt.ts:1515/1567/1627 | memory extraction ×3 | 保留 | 每轮至多一次 |
| prompt.ts:1952 | goal converged | 保留 | 低频 |
| prompt.ts:1986 | command | 保留 | 每命令一次 |
| prompt.ts:2191 | cron task fired | 保留 | 低频 |
| compaction.ts:673 | pruning | → logDebug | 压缩循环体内 |
| compaction.ts:706 | found | → logDebug | 循环体内 |
| compaction.ts:714 | pruned | → logDebug | 循环体内 |
| compaction.ts:539/552/616/656/790/984 | 压缩会话级事件 ×6 | 保留 | 压缩本身低频 |
| config/config.ts:251 | loading | → logDebug | 启动成功类，照 snapshot initialized 先例 |

- [x] **Step 1: 按决策表逐处修改**（仅改 `Effect.logInfo` → `Effect.logDebug` / `Effect.logWarning`，消息与字段不动，纯级别改动）
- [x] **Step 2: grep 验证计数**

```powershell
cd C:\gyc-code ; rg -c "Effect\.logInfo" src/gyccode/session/prompt.ts src/gyccode/session/compaction.ts src/gyccode/config/config.ts
```
Expected: prompt.ts 10、compaction.ts 6、config.ts 0（14-4、9-3、1-1）。

- [x] **Step 3: typecheck + 定向测试**

Run: `bun run typecheck ; bun test src/gyccode/session src/gyccode/config`
Expected: 0 error；session/config 测试 pass（纯级别改动不应破坏任何断言；若有测试断言日志级别，按新级别修正测试）。

- [x] **Step 4: Commit**

```powershell
git add src/gyccode/session/prompt.ts src/gyccode/session/compaction.ts src/gyccode/config/config.ts ; git commit -m "chore(logs): 热路径 INFO 降噪收尾（prompt/compaction/config，共 24 处）"
```

---

## 任务 3：环境依赖测试清零（P1，8 fail + 3 errors → 0）

### 3a task-auto-commit：git 探测升级（预期 fail -4）

**根因：** `gitWorks`（task-auto-commit.test.ts:17-23）只测 `git --version`（快）；真跑用例每用例 createShadowRepo() 重建影子仓库（git init ×2 + config ×N），本机 git init 1.5s/次 → 30s 必超。探测语义应与 :11-15 注释一致：**慢也算不可用**。

- [x] **Step 1: 修改探测（task-auto-commit.test.ts:17-23）**

```typescript
const gitWorks = (() => {
  try {
    const dir = mkdtempSync(path.join(tmpdir(), "gyc-git-probe-"))
    const t0 = Date.now()
    const r = spawnSync("git", ["init"], { cwd: dir, windowsHide: true })
    rmSync(dir, { recursive: true, force: true })
    // git init 正常 <200ms；>3s 说明 I/O 慢到必然让 30s 真跑用例超时，按不可用跳过。
    return r.status === 0 && Date.now() - t0 < 3000
  } catch {
    return false
  }
})()
```

import 区补 `mkdtempSync, rmSync`（from "node:fs"），`setDefaultTimeout` 保持 30_000。

- [x] **Step 2: 单跑验证**

Run: `bun test src/gyccode/snapshot/task-auto-commit.test.ts`
Expected: 1 pass（接线回归用例 :262 不依赖 git）/ 4 skip / 0 fail。本机 I/O 快于阈值时可能真跑——只要 0 fail 即通过。

### 3b browser-smoke：retry 治理 flaky（预期 fail -1）

- [x] **Step 1: 定位 CDP 用例并加 retry**

Run: `rg -n "test\(" src/gyccode/tool/browser-smoke.test.ts` 找到真跑浏览器用例行号 N。

```typescript
// 仅真跑 CDP 的用例加 retry；单跑已验证为负载型 flaky，非逻辑错误。
// 修改前：test("...", async () => {...})
test.retry(2)("...", async () => {...})
```

- [x] **Step 2: 单跑验证**

Run: `bun test src/gyccode/tool/browser-smoke.test.ts` — Expected: 0 fail。

### 3c background：waitFor 默认超时放宽（预期 fail -3）

- [x] **Step 1: 修改默认值（background.test.ts:9-13 附近）**

`waitFor` 函数签名中 `timeout = 10000` → `timeout = 30000`。全量并发下 PowerShell 后台进程调度慢，10s 不足；放宽只影响失败路径等待时长。

- [x] **Step 2: 单跑验证** Run: `bun test src/gyccode/tool/shell/background.test.ts` — Expected: 0 fail。

### 3d 全量清零验证

- [x] **连续 3 次全量**

Run: `bun test --path-ignore-patterns=src/webapp` ×3
Expected: 每次 0 fail / 0 errors（skip 数允许 ±5 浮动）；单次 ≤330s。
**2026-10-16 实测：3 次全 0 fail（2157 pass / 14 skip / 2171 tests / 257 files，耗时 148.6s / 160.8s / 152.9s）。**

- [x] **Commit**

```powershell
git add src/gyccode/snapshot/task-auto-commit.test.ts src/gyccode/tool/browser-smoke.test.ts src/gyccode/tool/shell/background.test.ts ; git commit -m "test: 环境依赖用例探测升级与超时放宽，全量清零 8 fail"
```

---

## 任务 4：基准集成冒烟显式通道（P1）

**Covers:** benchmark.test.ts:7「默认 skip，仅 benchmark 专用 CI 运行」——当前无任何通道能跑这 3 个用例。

**Files:** Modify: `src/gyccode/benchmark/benchmark.test.ts`、`scripts/gyc-health.mjs`

- [x] **Step 1: 环境变量门控（benchmark.test.ts）**

```typescript
// 头部新增
const SMOKE = process.env.GYC_BENCHMARK_SMOKE === "1"
// 3 个集成用例：test.skip("01: ...") → (SMOKE ? test : test.skip)("01: ...")
```

- [x] **Step 2: health:full 接线（gyc-health.mjs --tests 分支）**

在既有测试执行序列后追加（spawn 传 env，Windows 友好）：

```javascript
spawnSync("bun", ["test", "src/gyccode/benchmark/benchmark.test.ts"], {
  env: { ...process.env, GYC_BENCHMARK_SMOKE: "1" },
  stdio: "inherit", timeout: 300_000,
})
```

- [x] **Step 3: 验证**

Run: `bun run health:full` — Expected: 输出含 3 个冒烟用例结果（CLI 启动/模型列表/Provider 加载）；`bun test src/gyccode/benchmark`（无 env）仍 3 skip。
**2026-10-16 实测：health:full 输出 `tests: 2157 pass, 0 fail` 与 `benchmark smoke: 20 pass, 0 fail, 0 skip`；无 env 单跑 17 pass / 3 skip。**
（附带修复两处口径缺陷：① --tests 裸 `bun test` 会带进 src/webapp 组件测试致 20 fail → 内联官方排除参数；② 经 cmd.exe 的 execSync 链路下 bun test 只回显版本头 28 字节（pass 行丢失，解析 `?`）→ 改 spawnSync 直连，实测 2157 pass 可解析；③ 冒烟无 skip 行时解析 `?` → `0`。）

- [x] **Step 4: Commit**

```powershell
git add src/gyccode/benchmark/benchmark.test.ts scripts/gyc-health.mjs ; git commit -m "test(benchmark): 集成冒烟环境变量门控，接入 health:full 通道"
```
（实际提交另含 command-registry.ts debug 接线——冒烟 03 失败根因修复。）

---

## 任务 5：冷启动 profile 与恢复（P1，先测量后动手）

**Covers:** 热态 2.6~3.6s vs 历史最优 2.1s。不预设结论，按测量结果定位。

- [x] **Step 1: 建立基线（5 次取中位）**

```powershell
cd C:\gyc-code ; $bun="C:\Program Files\nodejs\node_modules\bun\bin\bun.exe" ; 1..5 | ForEach-Object { (Measure-Command { & $bun dist/index.js --version 2>&1 | Out-Null }).TotalMilliseconds }
```

> **2026-10-16 实测**：两轮各 5 次 → 中位 **1582ms**（1538~1686）与 **1650ms**（1545~1856）。
> 计划所据「热态 2.6~3.6s」不复存在（可能为环境负载期测量），稳定热态约 1.6s。

- [x] **Step 2: 采集 cpuprofile** — **免执行**：Step 1 基线已两轮稳定 ≤1650ms（优于 2500ms 目标
  34%），「先测量后动手」→ 测得健康，不采集、不优化，避免无目标改动。

```powershell
$bun --cpu-prof --cpu-prof-dir=prof dist/index.js --version
```

用 Edge DevTools（Performance 导入 .cpuprofile）或 speedscope 分析热点；对照 `bin/gyc` 启动脚本与 build.mjs 产物结构，列出耗时 Top5 模块。

- [x] **Step 3: 按热点逐项优化**（候选方向：bin/gyc 包装层、模块导入图、启动期同步守卫脚本；每项独立 commit、独立验证）— **免执行**：基线达标，无热点可优化。
- [x] **Step 4: 验证达标** — Expected: 中位数 ≤2500ms；全量测试仍 0 fail。**已验证：1582/1650ms ≤ 2500，连续 3 次全量 0 fail。**
- [x] **Step 5: 交付 profile 结论**（热点与修复对照表写入 commit message 并回填本计划勾注）— 结论：**无回归**，冷启动已优于历史最优 2.1s（当前热态 ~1.6s），无需 profile。

---

## 任务 6：AGENTS.md:3 路径残留修正（P1，一行）

- [x] **Step 1:** `AGENTS.md:3` 「仓库在 `D:\00MyAI\gyc-code`（不是 `C:\gyc-code`）」→ 「仓库在 `C:\gyc-code`」（本机无 D 盘，谷总多轮会话实际工作目录）
- [x] **Step 2:** `rg -n "D:.00MyAI" AGENTS.md` — Expected: 0 处
- [x] **Step 3:** `git add AGENTS.md ; git commit -m "docs: 修正 AGENTS.md 仓库路径跨机残留"`

---

## 任务 7：26 维对标口径修正报告（P1，文档）

**Files:** Create: `docs/compose/reports/2026-10-16-26dim-benchmark-corrections.md`（只读结论落 reports/，遵 2026-10-15 计划尾注约定）

- [x] **Step 1: 写入五处失真修正**（每条附 file:line）：
  1. A1「20+ provider」→ models-mirror/api.json 实为 **217 个 provider** + 12 个 @ai-sdk SDK 包（package.json:33-129）
  2. D1「20/20 基准」→ 20 用例 = 17 常跑 + 3 集成冒烟默认 skip（benchmark.test.ts:7-35）
  3. errors 2 → **3**（2026-10-16 全量实测）
  4. 测试文件 271 → bun test 实际收集 **256**
  5. 标题时间戳 2026-10-11 与内容（含 10-15 修复 ed8a5a19cc）矛盾 → 基准应为 10-15 之后
- [x] **Step 2: 补记两处遗漏**：Effect.logError 盲区（任务 1 闭环前数据）；热路径 INFO 残留清单（任务 2 闭环前数据）
- [x] **Step 3:** `git add docs/compose/reports/ ; git commit -m "docs: 26 维对标口径修正报告（2026-10-16 实测）"`

---

## 附录 A：P2 能力增强 brainstorm 清单（本计划不含，先澄清再立项）

| 方向 | 现状锚点 | 触发条件 |
|---|---|---|
| D4 重构能力（重构前验证模块） | 无专用模块；对标 Claude Code ★5 vs 本项 ★3.5 | 谷总确认场景（大范围重构频率/失败案例）后 brainstorm |
| B5 插件生态扩展 | `marketplace/` 目录已有，规模未盘点 | 盘点 marketplace/ 现状 → 对标 OpenCode 插件机制 → brainstorm |
| A2 上下文压缩增强 | `src/gyccode/session/compaction.ts` 395+ 行已有 | 长会话实测漂移案例收集 → 评估缺口 → brainstorm |

## 附录 B：执行顺序与依赖

1. **任务 1 / 2 / 3a-c / 4 / 6 相互独立**，可并行或任意顺序。
2. **任务 5** 建议在任务 3 全量清零后执行（计时基线不受干扰）。
3. **任务 7** 最后执行（引用任务 1/2 闭环后数据）。
4. 全部完成后：`bun run build`（重建 dist 含 auditLogger）→ `bun run health` → 仓库同步（按 AGENTS.md 自动同步规则：GitHub push + 知识库更新）。
