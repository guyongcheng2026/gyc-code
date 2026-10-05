# OpenTUI 渲染器稳定性第二轮：崩溃收口、Windows resize、可观测性与流式性能

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 先把 `@opentui` 从 0.5.6 升到 0.5.14（无 API 破坏，且直接修掉 rope 释放、portal 泄漏、背压丢帧），再收敛「一次后台失败即退出整个 TUI」「Windows 拖拽终端不重排」「渲染异常静默」三类稳定性缺陷，并把流式期的 CPU 空转压下去。

**Architecture:** 分两层——依赖升级层（Task 0，含补丁链适配）、仓库侧收口层（Task 1/2/3）、上游补丁侧补 resize（Task 4）、性能与可观测性侧（Task 5/6/7/8/9）。渲染器生命周期不动（已核实单进程仅创建一次，`src/tui/app.tsx:327`），避免引入新的重建路径。

**Tech Stack:** Bun + TypeScript、`@opentui/core` **0.5.6 → 0.5.14**、`@opentui/solid` **0.5.6 → 0.5.14**、`@opentui/keymap` **0.5.6 → 0.5.14**、Solid、effect v4 beta、bun:test、postinstall 补丁链（`scripts/apply-opentui-*.cjs`）

**前序轮次:** `docs/compose/plans/2026-10-02-opentui-stability-long-session.md`（P0 句柄表止血 + P1 内存泄露，已完成）。本轮是补充，不重复其已修项。

---

## 一、排查结论（2026-10-05，只读排查，未改代码）

证据分级：**A** = 我在本次会话直接读到源码；**B** = 子代理只读报告，未逐行复核；**C** = 下沉到 `node_modules` 核实，标 `node_modules/@opentui/...` 行号。

### 版本事实（2026-10-05 直接核实，npm 实测）

| 项 | 值 |
|---|---|
| 本地锁定 | `@opentui/core` / `solid` / `keymap` 均为 **0.5.6**，发布于 **2026-08-20** |
| 最新发布 | **0.5.14**，发布于 **2026-09-30**（5 天前），仓库 `github.com/anomalyco/opentui` |
| 差距 | **落后 8 个版本 / 6 周更新** |
| API 破坏性 | **无**。0.5.6 vs 0.5.14 全量 `.d.ts` 比对：导出 913 → 922，**仅存于 0.5.6 的符号 0 个**，无 d.ts 增删；5 处同名声明变更全为加宽（`MousePointerStyle` +29 值等）。`createCliRenderer` 签名一致，`CliRendererStats` 逐字节相同，唯一签名改动是 `startSelection` 加可选尾参 |
| 上游 native 层状态 | **未核实**。2026-10-01/02/04 连发 `native-3/4/5-snapshot` annotated tag（描述仅 "hardening/integration snapshot"），但 releases 页无对应 Release，tag 注释不含 commit 列表，不足以判断是否在重构 |
| koffi 补丁风险 | **低**。0.5.14 的 chunk 仍含 6 处 `node:ffi` 且仍有 `loadBackend()` 锚点，`apply-opentui-ffi-patch.cjs` 的动态探测可继续命中 |

**结论：升级优先于打补丁。** Task 0 排在所有任务之前。但 B 类三项缺陷在 0.5.14 实测**仍未修**，所以 Task 4 补丁依然必要，两者不冲突。

### A. 崩溃 / 退出类

| 编号 | 问题 | 证据 | 等级 |
|---|---|---|---|
| A-1 | `src/tui/` 下 27 处 `void sdk.client.*` fire-and-forget，其中 **15 处无 `.catch`**，拒绝直达 `onUnhandledRejection`（`src/tui/app.tsx:483`）→ 降级安全模式并 `process.exit`。无 catch 清单：`routes/session/permission.tsx:184/196/434/442`、`routes/session/question.tsx:50/58/74`、`component/prompt/index.tsx:455/1129/1151`、`routes/session/index.tsx:647/692/731/737/1156`、`routes/session/dialog-message.tsx:33`、`component/dialog-context-info.tsx:120`、`component/dialog-session-rename.tsx:22`、`app.tsx:1085/1105` | B | P0 |
| A-2 | `isRecoverableRejection` 有 6 条模式兜底常见瞬时错误（`src/tui/util/crash-classify.ts:13-24`，已直读），故 15 处并非每次都致命；但**服务端返回的 5xx / 业务错误文案不命中任何模式**，仍会击穿 | A | P0 |
| A-3 | TUI 主进程 `src/tui/app.tsx` **无 `process.on("SIGINT")`**（全仓仅 `src/cli/core/interactive.ts:219`、`src/cli/cmd/gateway.ts:204` 两处）。Ctrl+C 因 `win32InstallCtrlCGuard`（`src/tui/terminal-win32.ts:173`）清 `ENABLE_PROCESSED_INPUT` 而变成字符 `0x03`，走 `app.exit` 正常路径；**但 Ctrl+Break / 外部 taskkill / 关窗 → Node 默认立即退出，绕过 `destroyRenderer`（`src/tui/util/renderer.ts:3-7`）→ 终端残留 ANSI 乱码** | B | P0 |
| A-4 | `src/tui/app.tsx:1085` / `:1105` 的 `session.fork(...).then(...)` 无 catch。`:1085` 是 `--session<id>` 未带 `--fork` 的一次性分叉，`:1105` 是带 `--fork` 时等 `sync.status === "complete"` 再分叉。失败仅 toast（`:1089`），但**拒绝未捕获 → 整个 TUI 降级退出**，用户丢失会话上下文与输入草稿 | B | P0 |
| A-5 | `src/cli/tui/worker.ts:64-69`：非堆 OOM 的 `uncaughtException` 只记日志**不退出**，worker 带病存活；与 `:47` 的 `unhandledRejection` 分支策略不一致 | B | P1 |

### B. 上游缺陷（opentui 0.5.6，仓库侧只能 patch）

| 编号 | 问题 | 证据 | 归因 |
|---|---|---|---|
| B-1 | **Windows 无终端尺寸事件源**。opentui 唯一源是 `process.on("SIGWINCH", this.sigwinchHandler)`（`chunk-node-ks0581vk.js:7358`，仅 `_usesProcessStdout` 时注册），handler 读 `this.stdout.columns \|\| 80` / `rows \|\| 24`（`:7133-7137`），去抖 100ms（`:7323`）。全目录无 `stdout.on("resize")`、无 win32 `WM_SIZE` / `GetConsoleScreenBufferInfo` 轮询；所有 `onResize` 实现（`:934/:967/:3001/:3210/:5793`）都是被动回调，非事件源。**0.5.14 实测复核：仍只有 SIGWINCH（`chunk-node-wp7ct2m6.js:7296/7528/9872`），仍无 `stdout.on("resize")`、无 WM_SIZE** | C | 上游缺陷 → Task 4（**升级不解决**） |
| B-2 | **已用句柄数无 API**。全库无 `handleBudget`/`handleCount`/`activeHandle`/`usedHandle`/`liveHandle`；`getRenderStats`（`chunk-node-2h23nsbj.js:13796`）对应的 `NativeRenderStats`（`renderer.d.ts:5,63,580`）不含句柄数。**0.5.14 实测复核：仍无** | C | 上游缺 API（见 F-1） |
| B-3 | **渲染异常静默**。帧回调异常被 catch 后 `console.error("Error in frame callback:")` 吞掉继续（`chunk-node-ks0581vk.js:9794-9800`）；未捕获异常 `emit("render:error", ...)`（`:9872`）**无人监听**，退化为 `handleError = console.error + console.show()`（`:7169-7174`）。`getStats()`（`:9935-9952`）只有 fps/frameCount/frameTimes，**无累计错误数**。**但 `CliRenderEvents.RENDER_ERROR` / `HANDLER_ERROR` / `FRAME` / `RESIZE` 均为公开枚举成员（0.5.6 与 0.5.14 相同，已直读 `renderer.d.ts`）→ 仓库侧可直接订阅** | C | 上游无计数器，但订阅入口公开 → Task 1 + Task 8 |

### C. 性能类（CPU 持续高占用）

| 编号 | 问题 | 证据 | 等级 |
|---|---|---|---|
| C-1 | `sessionTargetFps` **不接终端能力 scale，也不按会话规模降档**（文档 `2026-10-02-...md:101-106` 自认 P2-2 未做）。非 plain 终端恒 60fps 流式 / 30fps 空闲，长会话也不降档 | B | P1 |
| C-2 | `<markdown streaming={true}>` 每个 delta（30ms 窗口）整块重解析 + tree-sitter WASM（`src/tui/routes/session/index.tsx:2122-2131`）；`props.part.text.trim()` 在 JSX 内联求值，每帧新建字符串（`:2118`） | B | P1 |
| C-3 | `<For each={messages()}>` 遍历全量数组（`src/tui/routes/session/index.tsx:1577`），折叠区逐条 mount `CollapsedMessage`（上限 500），**只有条级折叠无行级虚拟化** | B | P1 |
| C-4 | `estimateContentHandles` 两遍扫全文（`src/tui/util/handle-budget.ts:47-87`），经 `createMemo`（`src/tui/component/limited-content.tsx:58`）在**每次 text 变化（= 每 delta）**重跑 | B | P1 |
| C-5 | UTF-8 代码页守护 **200ms 间隔**，每次回调重新 `load()` kernel32 + `win32EnableUtf8Console()`（`src/tui/terminal-win32.ts:104-113`），恒定 5Hz FFI；且 `:110` 空 catch | B | P2 |
| C-6 | `expandKeyAliases` **每次按键 `new RegExp` ×4**（`src/tui/keymap.tsx:119-126`） | B | P2 |
| C-7 | i18n 查表命中后**每个参数 `new RegExp`**（`src/tui/fallback/i18n.ts:67`） | B | P2 |
| C-8 | `<spinner interval={80}>` = 每实例 12.5fps 定时器（`src/tui/component/spinner.tsx:19`），并发实例数未核实 | B | P2 |

**未发现**的问题（已核实，避免重复排查）：`clearInterval` 缺失（全量定时器均有清理）；无上限 Map/Set 或只加不删的监听器（`sync.tsx:204` LRU 20、`prompt/index.tsx:150` LRU 16、`sync.tsxx:526-544` 100 条上限均有界；`routes/session/index.tsx:115` 用 `WeakSet` 不泄漏）。以上为 B 级。

### D. 可观测性缺口

| 编号 | 问题 | 证据 | 等级 |
|---|---|---|---|
| D-1 | `logError` 在 TUI 主进程是**半黑洞**：落库 sink 只在 `src/gyccode/effect/app-runtime.ts:180` 注册，而该模块仅被 worker 懒加载（`src/cli/tui/worker.ts:96,194`），TUI 主进程不引入。故 `app.tsx:382/784/984`、`worker-pool.ts:129` 的 logError **只走 stderr**，不进 `gyccode.log`（`src/core/observability/logging.ts:126`）也不进 `error_audit` 表 | B | P1 |
| D-2 | 帧率统计只在 `GYC_TUI_STATS=1` 时开启（`app.tsx:332` 调 `renderer.getStats()`），且 **10 分钟才写一条**（`app.tsx:593`）；前缀是 `GYC_` 而非仓库约定的 `GYCCODE_` | B | P1 |
| D-3 | 无慢帧采样、无 CPU profile 采集、无长期 heapdump（`GYCCODE_AUTO_HEAP_SNAPSHOT` 仅靠堆压力触发，`app.tsx:549`） | B | P2 |
| D-4 | `check-bug-patterns.mjs` 只拦空 `catch {}`（`:41`）与空壳自递归（`:48`），且 `src/tui/app.tsx:17` **整文件豁免**。拦不到 `.catch(() => {})`、无 catch 的 fire-and-forget、Effect `catchCause(() => Effect.void)` 式静默 | B | P2 |

### E. 资源清理缺口

| 编号 | 问题 | 证据 | 等级 |
|---|---|---|---|
| E-1 | `process.once("SIGCONT")` 注册后无解绑（`src/tui/app.tsx:1449`；`enabled: platform !== "win32"` 故本机不触发，代码缺口仍在），重复挂起会叠多个一次性监听 | B | P2 |
| E-2 | `fallback/safe-mode.ts:49` `fallbackClaimed` 一次性护栏**不可复位** → 一次降级后同进程后续任何崩溃只能硬退（`app.tsx:434`） | B | P2 |
| E-3 | FPS 节流里 `setTimeout` 无 `unref()`、无 cancel（`src/tui/fallback/terminal.ts:303-308`），`stop()`（`:327`）后仍可能有 pending 回调写终端 | B | P2 |
| E-4 | `src/tui/app.tsx:302,470,606-745` 十余处 `void appendFile(...).catch(() => {})`，日志写入失败全静默 | B | P2 |

### F. 文档过期（须校正，否则后人重复劳动）

| 编号 | 问题 | 证据 | 等级 |
|---|---|---|---|
| F-1 | `docs/AGENTS-REFERENCES.md:45` 与 `2026-10-02-...md:103` 称 `globalHandleBudget.reserve/release` **未接线**；实际已接线：`limited-content.tsx:67` `reserved = globalHandleBudget.reserve(amount) ? amount : 0`，`:63`/`:74` release，`:72` `createEffect(acquire)`，`:73` `onCleanup`。**文档滞后于提交 `08c1b53`** | A | P2 |

### 历史证据（git log，B 级）

反复出现的 5 类：① 长会话内存泄露 / 超长会话崩溃（`0b2e7fd`、`9efe20a`、`c8994c0`、`ff3ec09`、`be84c3d`、`849716c`、`639d82c`、`66e31e7`）② 流式渲染跟不上 / CPU 空转（`3c4f25d`、`d19a2ec` delta-flush、`56d4825`、`7f4a6a6` 自适配 FPS）③ 滚动条 / 闪烁 / 布局抖动（`ad673ce`、`7616c9d`、`f8e9299`、`d840ca0` resize 无闪帧、`648078e` bg-pulse fps race）④ 运行几分钟后崩溃 / 退回终端（`43ce24b`、`02609f2`、`ec0ffd0`）⑤ 句柄表撞顶（`0b2e7fd`、`d94e86e`、`6c25492` NaN 污染焊死闸门、`ec7de16`）。①②④ 说明本轮 A/C 类问题有复发路径，不是一次性。

---

## 二、任务分解

### Task 0: 升级 opentui 0.5.6 → 0.5.14

**为什么第一个:** 排查中途才核实的事实——本地锁在 **0.5.6（发布于 2026-08-20）**，而最新是 **0.5.14（2026-09-30，5 天前）**，**落后 8 个版本 / 6 周更新**。这 8 个版本里有 4 条直接命中谷总报的症状，若不先升级，后面的补丁是在给旧版打补丁。

**升级收益（按与症状的相关度排序）：**

| 上游条目 | 修的是什么 | 对应本仓症状 |
|---|---|---|
| #1544 text buffer rope 释放、#1522 portal teardown 泄漏 | 文本缓冲与 portal 的内存未释放 | 内存虚高波动 |
| #1170 backpressure 复活、#1457 backpressure 后重试最后一自动帧 | 背压下丢帧/画面不刷新 | 卡顿、显示异常 |
| #1462 大 diff 渲染限界、#1537 buffer 原地 resize、#1538 draw text 复用存储、#1545 延迟布局 | 大内容渲染开销 | CPU 空转 |
| #1453 CJK 字间换行 | 中日韩字间距处理 | 中文排版 |
| #1504 编辑器销毁后可读光标 | 外部编辑器返回后光标态 | `src/tui/editor.ts` 挂起/恢复流程 |
| #1508 worker 终止时保留 error listener | worker 退出时错误监听丢失 | worker 带病存活（A-5） |
| #1440 忽略非法终端尺寸、#1549 net-zero resize 后重绘 | resize 后的重绘一致性 | 布局抖动 |
| #1450 无 tab 根跳过刷新、#1539 跳过无选区 native reset | 无谓的整帧刷新 | CPU 空转 |

**已核实无 API 破坏**（对比 0.5.6 与 0.5.14 两份 tarball 的全量 `.d.ts`）：导出名 913 → 922，**仅存于 0.5.6 的符号为 0 个**，无 d.ts 文件增删；5 处同名声明变更全为**加宽**（`MousePointerStyle` +29 值、`ImageErrorCode` +`busy`、`WidthMethod` +`unicode-wide`、`AudioStreamFormat` +`pcm`、音频结构体尾部追加可选字段）。`createCliRenderer(config?: CliRendererConfig)` 两版一致；`CliRendererStats` / `NativeRenderStats` / `NativeRenderStatsStruct` **逐字节相同**。唯一签名改动是 `startSelection(r, x, y, behavior?: SelectionBehavior)` 加了可选尾参，向后兼容。

**未修的（所以 Task 4 仍必要）:** B-1 的 Windows resize 无事件源、B-2 的句柄计数 API —— 这两项在 0.5.14 **仍未修复**（已实测 0.5.14 的 tarball：只有 SIGWINCH，无 `stdout.on("resize")`／无 WM_SIZE；无任何句柄计数字段）。

**Files:**
- Modify: `package.json`（三个 `@opentui/*` 版本号）
- Modify: `scripts/apply-opentui-ffi-patch.cjs`（确认动态发现仍命中，实测已支持）
- Test: 无新增单测（依赖升级以集成验证为主）

- [ ] **Step 1: 记录升级前基线（用于回归对比，不可跳过）**

Run:

```powershell
node scripts/verify-opentui-patches.cjs
bunx tsc --noEmit
bun run test
```

把三条命令的真实输出记入执行记录（pass/skip/fail 计数）。**升级后必须跑同一组命令对比，fail 数不得增加。**

- [ ] **Step 2: 确认补丁脚本能适配新的 chunk 文件名**

实测事实：`@opentui/core` 的 chunk 文件名在 0.5.14 已变（`chunk-node-2h23nsbj.js` / `chunk-node-ks0581vk.js` → `chunk-node-80p7e6t6.js` / `chunk-node-wp7ct2m6.js`）。

逐一确认三个补丁的目标文件定位方式：
- `scripts/apply-opentui-ffi-patch.cjs` — 用 `readdirSync` + `/^chunk-node-.*\.js$/` **动态发现**，已实测 0.5.14 的 `chunk-node-80p7e6t6.js` 仍含 6 处 `node:ffi` 且仍有 `var backend = loadBackend();` 锚点 → **无需改动**
- `scripts/apply-opentui-patch.cjs` / `scripts/apply-opentui-orphan-patch.cjs` — 目标 `@opentui/solid/index.bun.js`，该文件名 0.5.14 **未变** → **无需改动**，但仍需在升级后实跑确认 marker 生效

Run（升级前先跑一次留基线）:

```powershell
node scripts/verify-opentui-patches.cjs
```

- [ ] **Step 3: 升级版本**

`package.json` 中三个版本号同步改（**三者必须同版本**，仓库已如此）：

```json
"@opentui/core": "0.5.14",
"@opentui/core-win32-x64": "0.5.14",
"@opentui/keymap": "0.5.14",
"@opentui/solid": "0.5.14"
```

- [ ] **Step 4: 安装并确认补丁重新应用**

Run:

```powershell
bun install
node scripts/verify-opentui-patches.cjs
```

Expected: 四行 `[OK]`（现有三行 + Task 4 新增的第 4 行，若 Task 4 已做）或三行 `[OK]`（若 Task 4 尚未做）。

**若某行报「未匹配到原版代码，patch 失败」** —— 这是补丁链的刻意设计（宁可安装期显式失败，也不要静默拿到未打补丁的渲染器）。此时读该补丁脚本的 FROM 锚点，按 0.5.14 的真实代码更新 FROM/TO，不要绕过。

- [ ] **Step 5: 回归验证**

Run:

```powershell
bunx tsc --noEmit
bun run test
```

Expected: 0 error；测试 fail 数与 Step 1 基线一致（不增）。

- [ ] **Step 6: 实机验证（关键）**

Run: `bun run dev`

逐项确认（这些都是升级可能引入回归的面）：
1. 启动与正常渲染
2. 中文输入法组字（#1453 CJK 换行改动可能影响中文排版，**重点看**）
3. 流式输出时的帧率（对照 Task 1 建立基线后再比）
4. 外部编辑器挂起/恢复（#1504 改过这条路径）
5. 拖拽终端窗口（升级不修 resize，但仍要确认没变差）

- [ ] **Step 7: 提交**

```bash
git add package.json bun.lock
git commit -m "chore(tui): 升级 opentui 0.5.6 → 0.5.14，收敛内存泄漏与背压丢帧"
```

> `bun.lock` 是生成物，AGENTS.md 列为禁改清单，但依赖升级时**必须由 `bun install` 重新生成并一并提交**，不可手工编辑。

---

### Task 1: 渲染健康度采集（错误计数 + 帧时趋势）

**为什么第一:** B-3/D-2/D-3 决定了后续所有性能判断有没有数据。先有度量，再动 C 类。

**Files:**
- Create: `src/tui/util/render-health.ts`
- Test: `src/tui/util/render-health.test.ts`
- Modify: `src/tui/app.tsx`（内存 meter 循环内顺带采样，`:572` 起；**不新增定时器**）

- [ ] **Step 1: 写失败测试**

`src/tui/util/render-health.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { RenderHealthMonitor } from "./render-health"

describe("RenderHealthMonitor", () => {
  it("keeps stats history bounded and returns newest last", () => {
    const m = new RenderHealthMonitor({ capacity: 3, now: () => 1_000 })
    m.push({ at: 1, fps: 60, frameCount: 10, avgFrameMs: 4 })
    m.push({ at: 2, fps: 59, frameCount: 20, avgFrameMs: 5 })
    m.push({ at: 3, fps: 58, frameCount: 30, avgFrameMs: 6 })
    m.push({ at: 4, fps: 57, frameCount: 40, avgFrameMs: 7 })
    const h = m.history()
    expect(h.length).toBe(3)
    expect(h[2]!.at).toBe(4)
    expect(h[2]!.avgFrameMs).toBe(7)
  })

  it("reports trend direction between oldest and newest sample", () => {
    const m = new RenderHealthMonitor({ capacity: 8, now: () => 0 })
    m.push({ at: 1, fps: 60, frameCount: 10, avgFrameMs: 4 })
    m.push({ at: 2, fps: 40, frameCount: 20, avgFrameMs: 12 })
    const t = m.trend()
    expect(t).toEqual({ fpsDelta: -20, avgFrameMsDelta: 8 })
  })

  it("returns undefined trend with fewer than two samples", () => {
    const m = new RenderHealthMonitor({ capacity: 8, now: () => 0 })
    expect(m.trend()).toBeUndefined()
    m.push({ at: 1, fps: 60, frameCount: 1, avgFrameMs: 4 })
    expect(m.trend()).toBeUndefined()
  })

  it("counts render errors and survives a reset", () => {
    const m = new RenderHealthMonitor({ capacity: 4, now: () => 0 })
    m.noteError()
    m.noteError()
    m.noteError()
    expect(m.errors()).toBe(3)
    m.reset()
    expect(m.errors()).toBe(0)
    expect(m.history().length).toBe(0)
  })

  it("never grows history beyond capacity under sustained pushes", () => {
    const m = new RenderHealthMonitor({ capacity: 16, now: () => 0 })
    for (let i = 0; i < 500; i++) m.push({ at: i, fps: 60, frameCount: i, avgFrameMs: 4 })
    expect(m.history().length).toBe(16)
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/tui/util/render-health.test.ts`
Expected: FAIL —— `Cannot find module './render-health'`

- [ ] **Step 3: 写实现**

`src/tui/util/render-health.ts`：

```ts
/**
 * 渲染健康度采集：帧时趋势 + 渲染错误计数。
 *
 * 背景（2026-10-05 排查）：opentui 0.5.6 吞掉帧回调异常
 * （chunk-node-ks0581vk.js:9794-9800）且 getStats() 无累计错误数
 * （:9935-9952），渲染异常对仓库侧完全不可见；帧率统计又只在
 * GYC_TUI_STATS=1 时开启且 10 分钟写一条。本模块提供有界采样，
 * 让「CPU 空转」与「渲染异常」可归因。
 */

export interface RenderStatsSample {
  at: number
  fps: number
  frameCount: number
  avgFrameMs: number
}

export interface RenderTrend {
  fpsDelta: number
  avgFrameMsDelta: number
}

export interface RenderHealthOptions {
  /** 历史采样保留条数，默认 32 */
  capacity?: number
  now?: () => number
}

export class RenderHealthMonitor {
  private readonly capacity: number
  private readonly now: () => number
  private readonly samples: RenderStatsSample[] = []
  private errorCount = 0

  constructor(options: RenderHealthOptions = {}) {
    this.capacity = Math.max(1, options.capacity ?? 32)
    this.now = options.now ?? Date.now
  }

  push(stats: Omit<RenderStatsSample, "at">): void {
    this.samples.push({ at: this.now(), ...stats })
    if (this.samples.length > this.capacity) this.samples.shift()
  }

  history(): readonly RenderStatsSample[] {
    return this.samples
  }

  trend(): RenderTrend | undefined {
    if (this.samples.length < 2) return undefined
    const oldest = this.samples[0]!
    const newest = this.samples[this.samples.length - 1]!
    return {
      fpsDelta: newest.fps - oldest.fps,
      avgFrameMsDelta: newest.avgFrameMs - oldest.avgFrameMs,
    }
  }

  noteError(): void {
    this.errorCount += 1
  }

  errors(): number {
    return this.errorCount
  }

  reset(): void {
    this.samples.length = 0
    this.errorCount = 0
  }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/tui/util/render-health.test.ts`
Expected: PASS，5 pass / 0 fail

- [ ] **Step 5: 接入 app.tsx 内存 meter（不新增定时器）**

在 `src/tui/app.tsx` 已有的内存 meter 回调（`:572` 起，`:753` 清 interval）内，**同一回调**里追加采样。import 增加：

```ts
import { RenderHealthMonitor } from "./util/render-health"
```

在 renderer 创建处（`acquireRelease` 内，`:323-367`）附近声明：

```ts
const renderHealth = new RenderHealthMonitor({ capacity: 64 })
```

在 meter 回调内追加（renderer 变量已在该作用域内）：

```ts
const stats = renderer.getStats()
renderHealth.push({
  fps: stats.fps,
  frameCount: stats.frameCount,
  avgFrameMs: stats.averageFrameTime,
})
```

**字段名已坐实:** 直接读 `node_modules/@opentui/core/chunk-node-*.js` 的 `getStats` 返回块，0.5.6 与 0.5.14 **一致**为：

```js
{
  ...nativeStats,
  fps: this.renderStats.fps,
  frameCount: this.renderStats.frameCount,
  frameTimes,
  averageFrameTime: avg,
  minFrameTime: min,
  maxFrameTime: max,
  frameCallbackTime: this.renderStats.frameCallbackTime,
}
```

即上游字段名是 **`averageFrameTime`**，不是 `avgFrameMs`（子代理早期报告的 `avgFrameMs` 有误）。映射关系 `avgFrameMs ← averageFrameTime` 是因为 monitor 的入参字段名由本仓 `RenderStatsSample` 自定，可保持不变。

**更优方案（可选，先核实再决定）:** `CliRenderEvents` 含 `FRAME = "frame"`、`RESIZE = "resize"`、`RENDER_ERROR = "render:error"`、`HANDLER_ERROR = "handler:error"` 四个公开枚举成员（0.5.6 与 0.5.14 相同，已读 `renderer.d.ts`）。说明渲染器**逐帧 emit 事件**。若 `FRAME` 的 payload 含耗时字段，订阅它可拿到逐帧耗时，比轮询 `getStats()` 更细。**查 `renderer.d.ts` 中 `FRAME` 的事件签名确认 payload 结构后再决定**；payload 不含耗时则维持上面的轮询写法。该调用是同步查询，无副作用。

- [ ] **Step 6: 提交**

```bash
git add src/tui/util/render-health.ts src/tui/util/render-health.test.ts src/tui/app.tsx
git commit -m "feat(tui): 增加渲染健康度采集，为帧时归因与错误计数提供数据"
```

---

### Task 2: fire-and-forget 统一收口

**为什么:** A-1/A-2/A-4。这是本轮最高优先——一次后台 RPC 失败让整个 TUI 降级退出，用户损失最大。

**Files:**
- Create: `src/tui/util/fire-and-forget.ts`
- Test: `src/tui/util/fire-and-forget.test.ts`
- Modify: 15 处调用点（清单见 Step 5）

- [ ] **Step 1: 写失败测试**

`src/tui/util/fire-and-forget.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { settled } from "./fire-and-forget"

describe("settled", () => {
  it("swallows rejection and reports it via onError", async () => {
    const seen: unknown[] = []
    const returned = settled(Promise.reject(new Error("boom")), "test.scope", (e) => seen.push(e))
    await returned
    expect(seen.length).toBe(1)
    expect((seen[0] as Error).message).toBe("boom")
  })

  it("resolves without calling onError on success", async () => {
    let calls = 0
    const returned = settled(Promise.resolve(1), "test.scope", () => calls++)
    await expect(returned).resolves.toBeUndefined()
    expect(calls).toBe(0)
  })

  it("tolerates a throwing onError without rejecting", async () => {
    const returned = settled(Promise.reject(new Error("boom")), "test.scope", () => {
      throw new Error("handler exploded")
    })
    await expect(returned).resolves.toBeUndefined()
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/tui/util/fire-and-forget.test.ts`
Expected: FAIL —— `Cannot find module './fire-and-forget'`

- [ ] **Step 3: 写实现**

`src/tui/util/fire-and-forget.ts`：

```ts
/**
 * fire-and-forget 调用收口：把「发起后不等待」的 promise 挂上拒绝处理，
 * 避免一次后台 RPC 失败直达 process 级的 unhandledRejection。
 *
 * 背景（2026-10-05 排查）：src/tui 下 27 处 `void sdk.client.*` 中有 15 处
 * 无 .catch，其拒绝会走到 src/tui/app.tsx:483 的 onUnhandledRejection，
 * 进而 degradeToSafeModeAndExit 关闭整个 TUI（用户丢失会话与草稿）。
 * isRecoverableRejection（src/tui/util/crash-classify.ts:13-24）只兜 6 类
 * 瞬时错误，服务端 5xx 与业务错误文案不在其中。
 */

export function settled(
  promise: Promise<unknown>,
  /** 日志 scope，用于定位来源 */
  scope: string,
  /** 拒绝时的回调；默认走 stderr，避免静默 */
  onError: (error: unknown, scope: string) => void = (error, s) => {
    console.error(`[${s}] 后台调用失败:`, error)
  },
): Promise<void> {
  return promise.catch((error: unknown) => {
    try {
      onError(error, scope)
    } catch {
      // 回调自身抛错不应让调用方再次变成未捕获拒绝
    }
  })
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/tui/util/fire-and-forget.test.ts`
Expected: PASS，3 pass / 0 fail

- [ ] **Step 5: 替换 15 处无 catch 调用**

对下列每一处，把 `void <promise>` 改为 `settled(<promise>, "<scope>")`。scope 用该文件既有的 scope 命名（若文件内已有 `logError("x.y"` 就用同一个前缀）：

| 文件 | 行 | scope 建议 |
|---|---|---|
| `src/tui/routes/session/permission.tsx` | 184 / 196 / 434 / 442 | `tui.session.permission` |
| `src/tui/routes/session/question.tsx` | 50 / 58 / 74 | `tui.session.question` |
| `src/tui/component/prompt/index.tsx` | 455 / 1129 / 1151 | `tui.prompt` |
| `src/tui/routes/session/index.tsx` | 647 / 692 / 731 / 737 / 1156 | `tui.session` |
| `src/tui/routes/session/dialog-message.tsx` | 33 | `tui.session.dialog` |
| `src/tui/component/dialog-context-info.tsx` | 120 | `tui.dialog` |
| `src/tui/component/dialog-session-rename.tsx` | 22 | `tui.dialog` |
| `src/tui/app.tsx` | 1085 / 1105 | `tui.app.fork` |

每处加 import：

```ts
import { settled } from "../../util/fire-and-forget"  // 路径按所在目录调整
```

改写形态（以 `app.tsx:1085` 为例，其余同理——**逐个打开真实代码确认改写点，不要照抄行号**）：

```ts
// 改前：void sdk.client.session.fork(...).then(...)
// 改后：
settled(sdk.client.session.fork(...).then(...), "tui.app.fork")
```

- [ ] **Step 6: 跑类型检查与相关测试**

Run: `bunx tsc --noEmit`
Expected: 0 error

Run: `bun test src/tui/util/fire-and-forget.test.ts`
Expected: PASS

- [ ] **Step 7: 提交**

```bash
git add src/tui/util/fire-and-forget.ts src/tui/util/fire-and-forget.test.ts src/tui/routes src/tui/component src/tui/app.tsx
git commit -m "fix(tui): 收口 15 处无 catch 的 fire-and-forget，避免后台失败击穿整个 TUI"
```

---

### Task 3: Windows 退出信号收口（Ctrl+Break / 外部终止）

**为什么:** A-3。Ctrl+C 已被 guard 转为字符走正常路径，但 Ctrl+Break 与外部终止绕过 `destroyRenderer` → 终端残留 ANSI 乱码。这是谷总可感知的「退出后终端花屏」。

**Files:**
- Modify: `src/tui/app.tsx`（在 `process.on("uncaughtException")` 注册处 `:494-495` 附近**同款模式**加 `SIGBREAK`；Bun/Node 在 Windows 上对 SIGBREAK 的派发行为需先核实）
- Test: `src/tui/util/exit-hooks.test.ts`

- [ ] **Step 1: 核实信号可用性（决定实现分支，不可跳过）**

Run（在仓库根，PowerShell）:

```powershell
bun -e "process.on('SIGBREAK',()=>{console.log('SIGBREAK');process.exit(0)});console.log('listener installed')"
```

然后在另一个 PowerShell 窗口对该进程按 Ctrl+Break。若打印 `SIGBREAK` → 走 Step 3 的分支 A；若直接退出且无打印 → Bun 未派发 SIGBREAK，改走分支 B（见 Step 3）。

**记录结论后再继续。** 不要假设。

- [ ] **Step 2: 写失败测试**

`src/tui/util/exit-hooks.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { shouldDeferToSafeExit } from "./exit-hooks"

describe("shouldDeferToSafeExit", () => {
  it("defers for console-close style abrupt terminations", () => {
    expect(shouldDeferToSafeExit("SIGBREAK")).toBe(true)
  })

  it("defers for external kill on windows", () => {
    expect(shouldDeferToSafeExit("SIGKILL", "win32")).toBe(true)
  })

  it("does not defer for a normal SIGINT handled by keybind", () => {
    expect(shouldDeferToSafeExit("SIGINT")).toBe(false)
  })

  it("does not defer for SIGKILL on posix (cannot be caught anyway)", () => {
    expect(shouldDeferToSafeExit("SIGKILL", "linux")).toBe(false)
  })
})
```

- [ ] **Step 3: 写实现**

`src/tui/util/exit-hooks.ts`：

```ts
/**
 * 终止信号分流：区分「可拦截的突发终止」与「正常 Ctrl+C」。
 *
 * 背景（2026-10-05 排查）：Ctrl+C 已被 win32InstallCtrlCGuard
 * （src/tui/terminal-win32.ts:173）清 ENABLE_PROCESSED_INPUT 转为字符
 * 0x03，走 app.exit 正常路径；但 Ctrl+Break / 外部 taskkill / 关窗
 * 会让进程直接死亡，绕过 destroyRenderer（src/tui/util/renderer.ts:3-7），
 * 终端残留 ANSI 乱码。SIGKILL 在 POSIX 上不可拦截，故只在 win32 上视为需兜底。
 */

export function shouldDeferToSafeExit(signal: string, platform: string = process.platform): boolean {
  if (signal === "SIGINT") return false
  if (signal === "SIGBREAK") return true
  if (signal === "SIGKILL") return platform === "win32"
  return false
}
```

然后在 `src/tui/app.tsx` 的 `process.on("uncaughtException")` 注册处（`:494-495`）旁，**仅当 Step 1 确认 Bun 派发 SIGBREAK 时**加：

```ts
process.on("SIGBREAK", () => {
  degradeToSafeModeAndExit(new Error("收到 SIGBREAK（Ctrl+Break）"))
})
```

并在该 Effect 作用域的释放处（与 `:500-501` 同款）解绑。**若 Step 1 证明 Bun 不派发 SIGBREAK，则本步改为在 `src/tui/util/renderer.ts:3-7` 的 `destroyRenderer` 外再包一层进程 `exit` 钩子**，并在计划执行记录里注明 SIGBREAK 不可拦截这一事实。

- [ ] **Step 4: 跑测试**

Run: `bun test src/tui/util/exit-hooks.test.ts`
Expected: PASS，4 pass / 0 fail

- [ ] **Step 5: 提交**

```bash
git add src/tui/util/exit-hooks.ts src/tui/util/exit-hooks.test.ts src/tui/app.tsx
git commit -m "fix(tui): 收口 Ctrl+Break 等突发终止信号，退出前恢复终端"
```

---

### Task 4: Windows 终端尺寸轮询补丁

**为什么:** B-1。这是「Windows 拖拽终端不重排」的唯一根因，仓库侧无解，只能打补丁。

**Files:**
- Create: `scripts/apply-opentui-win32-resize-patch.cjs`
- Modify: `package.json`（postinstall 加入该 patch，`:16`）
- Modify: `scripts/verify-opentui-patches.cjs`（加第 4 个 marker 校验）

- [ ] **Step 1: 确认锚点代码**

Run:

```powershell
Select-String -Path "node_modules/@opentui/core/chunk-node-*.js" -Pattern 'sigwinchHandler = \(\(\) =>' | ForEach-Object { "$($_.Filename):$($_.LineNumber)" }
```

Expected: 若 Task 0 已升级（0.5.14），命中 `chunk-node-wp7ct2m6.js:7296`；未升级（0.5.6）则命中 `chunk-node-ks0581vk.js:7133`。**以实际输出为准**，本文档内所有 `chunk-node-ks0581vk.js:xxxx` 行号均按 0.5.6 标注。

- [ ] **Step 2: 写补丁脚本**

`scripts/apply-opentui-win32-resize-patch.cjs`，沿用既有补丁的 FROM/TO + marker + 幂等结构（参照 `scripts/apply-opentui-orphan-patch.cjs:12-42`）：

```js
// 应用 @opentui/core win32 终端尺寸轮询 patch（bun install 后自动运行）
// 背景：opentui 0.5.6 的终端尺寸变化只有 POSIX 信号源
// （process.on("SIGWINCH", ...)，chunk-node-ks0581vk.js:7358），handler 读
// this.stdout.columns / rows（:7133-7137），去抖 100ms（:7323）。全库无
// stdout.on("resize")，也无 win32 WM_SIZE / GetConsoleScreenBufferInfo 轮询。
// 结果：Windows 下拖拽终端窗口 / 最大化不会触发重排，布局错乱且句柄估算失准。
// 修复：在非 win32 平台增加一个低频尺寸轮询（复用 handleResize 去抖路径）。
// 用法：bun install 后执行；幂等，已应用则跳过。
const fs = require("fs");
const path = require("path");

const coreDir = path.join(__dirname, "..", "node_modules", "@opentui", "core");
const MARKER = "gyc-win32-resize-poll";

// chunk 文件名随版本变化（实测 0.5.6 为 chunk-node-2h23nsbj.js / chunk-node-ks0581vk.js，
// 0.5.14 为 chunk-node-80p7e6t6.js / chunk-node-wp7ct2m6.js），必须动态发现，
// 不能硬编码——否则升级后补丁会作用在错误的文件上，且因 marker 检查而静默跳过。
const target = fs
  .readdirSync(coreDir)
  .filter((f) => /^chunk-node-.*\.js$/.test(f))
  .map((f) => path.join(coreDir, f))
  .find((f) => fs.readFileSync(f, "utf8").includes("sigwinchHandler = (() => {"));

const FROM = [
  "  sigwinchHandler = (() => {",
  "    return () => {",
].join("\\n");

const TO = [
  "  " + MARKER + " = process.platform === \\\"win32\\\" && _usesProcessStdout ? setInterval(() => {",
  "    const c = this.stdout && this.stdout.columns;",
  "    const r = this.stdout && this.stdout.rows;",
  "    if (!c || !r) return;",
  "    if (c === this.width && r === this.height) return;",
  "    this.sigwinchHandler();",
  "  }, 500) : null;",
  "  sigwinchHandler = (() => {",
  "    return () => {",
].join("\\n");

if (!fs.existsSync(target)) {
  console.log("[gyc-patch] 未找到 @opentui/core，跳过");
  process.exit(0);
}

const src = fs.readFileSync(target, "utf8");
if (src.includes(MARKER)) {
  console.log("[gyc-patch] win32 尺寸轮询 patch 已生效，跳过");
  process.exit(0);
}
if (!src.includes(FROM)) {
  console.error("[gyc-patch] 未匹配到原版代码，patch 失败（版本可能升级）");
  process.exit(1);
}

fs.writeFileSync(target, src.replace(FROM, TO));
console.log("[gyc-patch] @opentui/core win32 尺寸轮询 patch 已应用");
```

**FROM 必须按 Step 1 读到的真实文本填写**，不得照抄上面的两行占位。若 opentui 版本变化导致不匹配，补丁会 `exit(1)` 并打印明确原因——这是预期行为，不要绕过。

- [ ] **Step 3: 补类字段声明与销毁清理（两处小改，仍在同一脚本内完成）**

在 TO 里已加的轮询字段必须**有声明**。在目标文件中找到该类的字段声明区（形如 `  sigwinchHandler = () => {}` 附近的类字段列表），加入一行：

```
  gycWin32ResizePoll = null;
```

并在销毁路径（原 `process.removeListener("SIGWINCH", this.sigwinchHandler);` 那一行附近，`chunk-node-ks0581vk.js:9600`）之前加入：

```
    if (this.gycWin32ResizePoll) { clearInterval(this.gycWin32ResizePoll); this.gycWin32ResizePoll = null; }
```

这两处也用同样的 FROM/TO 幂等替换实现。**不清理 interval 会让 renderer 销毁后仍每 500ms 读一次终端尺寸**——这正是本轮要修的泄漏类型，不能引入新的。

- [ ] **Step 4: 手工验证补丁**

Run:

```powershell
node scripts/apply-opentui-win32-resize-patch.cjs
```

Expected: `[gyc-patch] @opentui/core win32 尺寸轮询 patch 已应用`

再跑一次：

```powershell
node scripts/apply-opentui-win32-resize-patch.cjs
```

Expected: `[gyc-patch] win32 尺寸轮询 patch 已生效，跳过`（幂等）

- [ ] **Step 5: 接入 postinstall 与校验器**

`package.json:16` 的 postinstall 现为三个 patch 各带 `|| true`。加入第四个（保持同样风格）：

```json
"postinstall": "node scripts/apply-opentui-patch.cjs || true; node scripts/apply-opentui-ffi-patch.cjs || true; node scripts/apply-opentui-orphan-patch.cjs || true; node scripts/apply-opentui-win32-resize-patch.cjs || true; node scripts/install-hooks.mjs; node scripts/verify-opentui-patches.cjs"
```

`scripts/verify-opentui-patches.cjs` 增加第 4 条 marker 校验（读取 `chunk-node-ks0581vk.js` 检查含 `gyc-win32-resize-poll`），沿用该文件既有的条目结构，**恒 exit 0**。

- [ ] **Step 6: 实机验证 Windows resize 生效（关键，不可省略）**

Run: `bun run dev`

在 TUI 运行中拖拽终端窗口 / 最大化 / 改变缓冲区大小。预期：布局随窗口重排（此前不会重排）。若仍不重排，说明 `this.width`/`this.height` 与 `stdout.columns/rows` 的比较基准不一致，回到 Step 3 核对字段名。

- [ ] **Step 7: 提交**

```bash
git add scripts/apply-opentui-win32-resize-patch.cjs scripts/verify-opentui-patches.cjs package.json
git commit -m "fix(tui): 补丁补齐 Windows 终端尺寸轮询，修复拖拽窗口不重排"
```

---

### Task 5: 帧时与句柄估算降档（收尾 P2-2）

**为什么:** C-1/C-4。这是谷总「CPU 持续高占用」的主嫌疑：非 plain 终端恒 60fps，长会话不降档；且每次流式 delta 都全量重扫估算句柄。

**Files:**
- Create: `src/tui/util/render-budget.ts`
- Test: `src/tui/util/render-budget.test.ts`
- Modify: `src/tui/fallback/capability.ts`（`sessionTargetFps` 接入会话规模）
- Modify: `src/tui/util/handle-budget.ts`（估算节流，`:47-87`）

- [ ] **Step 1: 写失败测试**

`src/tui/util/render-budget.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { resolveFrameBudget } from "./render-budget"

describe("resolveFrameBudget", () => {
  it("does not downshift on a small session", () => {
    expect(resolveFrameBudget({ sessionMessages: 10, plainTerminal: false })).toEqual({
      streaming: 60,
      idle: 30,
    })
  })

  it("downshifts streaming fps for a long session", () => {
    expect(resolveFrameBudget({ sessionMessages: 600, plainTerminal: false })).toEqual({
      streaming: 30,
      idle: 20,
    })
  })

  it("downshifts harder past the very long threshold", () => {
    expect(resolveFrameBudget({ sessionMessages: 1500, plainTerminal: false })).toEqual({
      streaming: 15,
      idle: 10,
    })
  })

  it("keeps plain terminals at the floor regardless of session size", () => {
    expect(resolveFrameBudget({ sessionMessages: 5, plainTerminal: true })).toEqual({
      streaming: 10,
      idle: 5,
    })
    expect(resolveFrameBudget({ sessionMessages: 1500, plainTerminal: true })).toEqual({
      streaming: 10,
      idle: 5,
    })
  })
})
```

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/tui/util/render-budget.test.ts`
Expected: FAIL —— `Cannot find module './render-budget'`

- [ ] **Step 3: 写实现**

`src/tui/util/render-budget.ts`：

```ts
/**
 * 按会话规模解析帧预算（收尾 2026-10-02 计划的 P2-2）。
 *
 * 背景（2026-10-05 排查）：fallback/capability.ts 的 sessionTargetFps
 * 不接会话规模，非 plain 终端恒 60fps 流式 / 30fps 空闲；长会话里每帧
 * 都要 diff 全量消息数组，CPU 持续空转。降档只影响刷新率，不改变内容正确性。
 */

export interface FrameBudgetInput {
  sessionMessages: number
  plainTerminal: boolean
}

export interface FrameBudget {
  streaming: number
  idle: number
}

/** 长会话阈值：超过即降一档 */
const LONG_SESSION = 400
/** 超长会话阈值：超过即降到最低档 */
const VERY_LONG_SESSION = 1200

const PLAIN_FLOOR: FrameBudget = { streaming: 10, idle: 5 }

export function resolveFrameBudget(input: FrameBudgetInput): FrameBudget {
  if (input.plainTerminal) return { ...PLAIN_FLOOR }
  if (input.sessionMessages >= VERY_LONG_SESSION) return { streaming: 15, idle: 10 }
  if (input.sessionMessages >= LONG_SESSION) return { streaming: 30, idle: 20 }
  return { streaming: 60, idle: 30 }
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/tui/util/render-budget.test.ts`
Expected: PASS，4 pass / 0 fail

- [ ] **Step 5: 接到 `sessionTargetFps`**

打开 `src/tui/fallback/capability.ts`，找到 `sessionTargetFps`。让它的调用方传入会话消息数与 `plainTerminal`，内部改用 `resolveFrameBudget`。**先读该函数真实签名再改**，不要凭记忆改。

Run: `bun test src/tui/fallback/capability.test.ts`
Expected: PASS（若既有断言依赖旧的恒定值，按新行为更新断言，并在提交信息里说明）

- [ ] **Step 6: 句柄估算节流（C-4）**

`src/tui/component/limited-content.tsx:58` 的 `createMemo(() => estimateContentHandles(limited().text, props.cols))` 在每 delta 重跑两遍全文扫描（`src/tui/util/handle-budget.ts:47-87`）。改为：**文本长度未跨越阈值时复用上次估算**。

在 `src/tui/util/handle-budget.ts` 增一个带缓存的包装：

```ts
/**
 * 带缓存的句柄估算：文本长度变化不足一个阈值档位时复用上次结果，
 * 避免流式期每个 delta 都两遍扫全文。
 */
export function createHandleEstimateCache() {
  let lastLen = -1
  let lastCols = -1
  let lastValue = 0
  return (text: string, cols: number): number => {
    // 阈值取 512 字符：小于它的增长不会改变折行估算的量级
    if (Math.abs(text.length - lastLen) < 512 && cols === lastCols) return lastValue
    lastLen = text.length
    lastCols = cols
    lastValue = estimateContentHandles(text, cols)
    return lastValue
  }
}
```

在 `limited-content.tsx` 侧把 memo 改用它（缓存实例放组件外 `use module-level` 或组件内 `createMemo` 外一次创建，**不要在 memo 内部新建缓存**，否则缓存无效）。

测试：给 `render-budget.test.ts` 同目录加 `handle-budget-cache.test.ts`，断言「文本增长 100 字符返回同一值（引用相等）、增长 600 字符后重算、cols 变化后重算」。

- [ ] **Step 7: 类型检查与全量测试**

Run: `bunx tsc --noEmit`
Expected: 0 error

Run: `bun run test`
Expected: 全绿，0 fail

- [ ] **Step 8: 提交**

```bash
git add src/tui/util/render-budget.ts src/tui/util/render-budget.test.ts src/tui/util/handle-budget.ts src/tui/fallback/capability.ts src/tui/component/limited-content.tsx
git commit -m "perf(tui): 帧预算按会话规模降档，并对句柄估算加缓存"
```

---

### Task 6: 每键/每翻译正则缓存

**为什么:** C-6/C-7。按键与 i18n 翻译是高频路径，每次调用重新编译正则。

**Files:**
- Create: `src/tui/util/regex-cache.ts`
- Test: `src/tui/util/regex-cache.test.ts`
- Modify: `src/tui/keymap.tsx`（`:119-126`）
- Modify: `src/tui/fallback/i18n.ts`（`:67`）

- [ ] **Step 1: 写失败测试**

`src/tui/util/regex-cache.test.ts`：

```ts
import { describe, expect, it } from "bun:test"
import { cachedRegex } from "./regex-cache"

describe("cachedRegex", () => {
  it("returns the same RegExp instance for the same pattern and flags", () => {
    expect(cachedRegex("^a+$", "g")).toBe(cachedRegex("^a+$", "g"))
  })

  it("returns different instances for different flags", () => {
    expect(cachedRegex("^a+$", "g")).not.toBe(cachedRegex("^a+$", "i"))
  })

  it("resets lastIndex before use so /g is not stateful across calls", () => {
    const re = cachedRegex("\\d", "g")
    expect(re.test("a1")).toBe(true)
    re.lastIndex = 0
    expect(cachedRegex("\\d", "g").test("a1")).toBe(true)
  })

  it("bounds the cache size and never exceeds the 256-entry cap", () => {
    for (let i = 0; i < 400; i++) cachedRegex(`p${i}`, "")
    expect(cachedRegex.cacheSize()).toBeLessThanOrEqual(256)
  })
})
```

最后一条断言对应实现中的 `MAX_ENTRIES = 256`；超出上限时 `store.clear()` 全量清空，因此断言上界而非精确值。

- [ ] **Step 2: 跑测试确认失败**

Run: `bun test src/tui/util/regex-cache.test.ts`
Expected: FAIL —— `Cannot find module './regex-cache'`

- [ ] **Step 3: 写实现**

`src/tui/util/regex-cache.ts`：

```ts
/**
 * 正则编译缓存：按键别名展开、i18n 插值等高频路径每次调用都 new RegExp，
 * 在流式期与长按场景累积成可观开销（keymap.tsx:119-126、i18n.ts:67）。
 * 上限 256 条，超出后清空重建——这些 pattern 集合是静态的小集合，
 * 全量清空不会造成抖动。
 */

const MAX_ENTRIES = 256
const store = new Map<string, RegExp>()

export interface CachedRegex {
  (pattern: string, flags?: string): RegExp
  cacheSize(): number
}

export const cachedRegex = ((pattern: string, flags = ""): RegExp => {
  const key = `${flags} ${pattern}`
  const hit = store.get(key)
  if (hit) {
    // /g /y 的 lastIndex 是有状态的，跨调用必须复位
    hit.lastIndex = 0
    return hit
  }
  const compiled = new RegExp(pattern, flags)
  store.set(key, compiled)
  if (store.size > MAX_ENTRIES) store.clear()
  return compiled
}) as CachedRegex

cachedRegex.cacheSize = () => store.size
```

- [ ] **Step 4: 跑测试确认通过**

Run: `bun test src/tui/util/regex-cache.test.ts`
Expected: PASS

- [ ] **Step 5: 替换两处热点**

`src/tui/keymap.tsx:119-126` 的 `expandKeyAliases`：把 `reduce` 内构造的 `new RegExp(...)` 换成 `cachedRegex(pattern, flags)`。**先读真实代码确认 pattern 是字面量还是动态拼接**——若含动态部分，缓存命中率会失效，此时改为把动态部分转义后仍走缓存，并在提交信息里说明命中率影响。

`src/tui/fallback/i18n.ts:67` 的带参插值同理。

Run: `bun test src/tui/util/regex-cache.test.ts src/tui/fallback/i18n.test.ts`
Expected: PASS

- [ ] **Step 6: 提交**

```bash
git add src/tui/util/regex-cache.ts src/tui/util/regex-cache.test.ts src/tui/keymap.tsx src/tui/fallback/i18n.ts
git commit -m "perf(tui): 按键别名与 i18n 插值复用编译后的正则"
```

---

### Task 7: win32 UTF-8 守护降频 + 空 catch 补日志

**为什么:** C-5/E-4。200ms × 5Hz FFI 常驻；且 `:110` 与 app.tsx 多处日志失败全静默。

**Files:**
- Modify: `src/tui/terminal-win32.ts`（`:104-113` 间隔与空 catch）
- Modify: `src/tui/app.tsx`（`:302,470,606-745` 的 `.catch(() => {})`）

- [ ] **Step 1: 确认现状**

Run:

```powershell
Select-String -Path "src\tui\terminal-win32.ts" -Pattern "setInterval|utf8Guard" | ForEach-Object { "$($_.LineNumber): $($_.Line.Trim())" }
```

Expected: 定位 `:104` 附近的 `setInterval`（200ms）与引用计数逻辑（`:124` 归零清理）。

- [ ] **Step 2: 降频到 2000ms**

把守卫间隔从 200ms 改为 2000ms。理由：UTF-8 代码页被外部程序改回是低频事件（用户手动切代码页），2 秒响应足够；5Hz FFI 在 TUI 运行期是纯空转。

**保持引用计数与 unref 逻辑不变**，只改间隔常量。若间隔是字面量，改字面量；若是常量，改常量并在行内注释写明「2000ms：代码页被外部改回属低频事件，5Hz FFI 空转」。

- [ ] **Step 3: 空 catch 补日志**

`src/tui/terminal-win32.ts:110` 的空 catch 改为：

```ts
} catch (error) {
  logError("tui.terminal.win32", error, { stage: "utf8-guard" })
}
```

若该文件未 import `logError`，从 `../../core/observability/log-error` 引入（**签名已核实：`logError(scope: string, error: unknown, fields?: Record<string, unknown>): void`，`src/core/observability/log-error.ts:50`**）。

同样处理 `src/tui/app.tsx:302,470,606-745` 中 `void appendFile(...).catch(() => {})` —— 改为记录 scope `tui.app.crashlog`。**注意 `src/tui/app.tsx:17` 整文件被 `check-bug-patterns.mjs` 豁免，这正是它有空 catch 的原因**（见 Task 8）。

- [ ] **Step 4: 类型检查与测试**

Run: `bunx tsc --noEmit`
Expected: 0 error

Run: `bun run test`
Expected: 全绿

- [ ] **Step 5: 提交**

```bash
git add src/tui/terminal-win32.ts src/tui/app.tsx
git commit -m "perf(tui): UTF-8 守护降频至 2s 并补齐被静默的日志写入失败"
```

---

### Task 8: 静态防线补强（check-bug-patterns + 渲染错误监听）

**为什么:** D-4 + B-3。让同类问题下次被 pre-commit 直接拦住，而不是靠人读代码。`src/tui/app.tsx:17` 整文件豁免是空 catch 得以长期存在的制度原因。

**Files:**
- Modify: `scripts/check-bug-patterns.mjs`（新增两条规则，收紧 app.tsx 豁免）
- Modify: `src/tui/app.tsx`（渲染错误计数接入 Task 1 的 monitor）

- [ ] **Step 1: 为新规则写失败用例**

该脚本自带自检用例（`scripts/` 下应有其 `.test.*` 或 `.mjs` 自测入口，**先读实际文件确认结构**）。为两条新规则各加一个应被拦的样例：

```js
// 应被拦：fire-and-forget 无 catch
const p = void somePromise()
// 应被拦：空 catch 回调
promise.catch(() => {})
```

- [ ] **Step 2: 跑自检确认失败**

Run: 按 `scripts/check-bug-patterns.mjs` 既有的自检入口命令执行
Expected: 新样例未被拦（FAIL）

- [ ] **Step 3: 实现两条规则**

在 `scripts/check-bug-patterns.mjs` 新增：

- **规则 C**：`catch(() => {})` 与 `catch(() => void 0)` 形态的空回调（区别于已有的规则 A `catch {}`）
- **规则 D**：`void <promise>` 形态且同行/次行无 `.catch(` 的 fire-and-forget

同时**收紧 `src/tui/app.tsx` 的豁免**：从整文件豁免改为「按行豁免 + 已知既有空 catch 白名单」，让新增的空 catch 仍被拦。白名单从当前实际空 catch 位置生成，**只放行已存在的，不放行新出现的**。

- [ ] **Step 4: 跑自检确认通过**

Run: 同 Step 2
Expected: PASS

- [ ] **Step 5: 渲染错误计数接入（B-3 的可观测部分）—— 订阅入口已坐实**

`CliRenderEvents` 是**公开枚举**，`RENDER_ERROR = "render:error"` 与 `HANDLER_ERROR = "handler:error"` 均为其成员（已直读 `node_modules/@opentui/core/renderer.d.ts`，0.5.6 与 0.5.14 完全一致）。B-3 确认上游会 `emit("render:error")` 但仓库侧无人监听，因此可以直接订阅，无需再探查 API。

在 renderer 创建作用域（`src/tui/app.tsx:323-367`）内订阅，把错误计入 Task 1 的 monitor：

```ts
renderer.on(CliRenderEvents.RENDER_ERROR, (payload: { error: unknown }) => {
  renderHealth.noteError()
  logError("tui.render", payload.error, { stage: "render" })
})
```

同时建议一并订阅 `HANDLER_ERROR`（事件处理器抛错，同样静默）与 `FRAME`（若 payload 含耗时，可替代轮询采样）。

**两点必须核实后再写，不要照抄：**
1. `renderer.on` 的确切签名与 `CliRenderEvents` 的导入路径 —— 从 `@opentui/core` 导入，先在 `renderer.d.ts` 里确认导出名
2. `RENDER_ERROR` 的 payload 结构 —— 上面按 `{ error }` 写，需在 d.ts 的事件 map 类型里核对；字段名不符时按实际改

订阅后**确认解绑**：在同 Effect 作用域的释放处（与 `process.on` 解绑同款，参见 `app.tsx:500-501`）移除监听，否则 renderer 销毁后监听残留。

- [ ] **Step 6: 提交**

```bash
git add scripts/check-bug-patterns.mjs src/tui/app.tsx
git commit -m "chore(tui): 静态防线新增空回调与无 catch 的 fire-and-forget 规则"
```

---

### Task 9: 文档校正与收尾

**为什么:** F-1。文档说 reserve/release 未接线，会导致后续排查重复劳动（本次已发生）。

**Files:**
- Modify: `docs/AGENTS-REFERENCES.md:45`
- Modify: `docs/compose/plans/2026-10-02-opentui-stability-long-session.md:103`
- Modify: `scripts/manual_content_7.py`（若涉及对外可见功能面）

- [ ] **Step 1: 校正 reserve/release 表述**

`docs/AGENTS-REFERENCES.md:45` 与 `2026-10-02-...md:103` 中「reserve/release 未接线 / `used()` 恒 0」的表述改为：

> `globalHandleBudget.reserve/release` 已接线（`src/tui/component/limited-content.tsx`，提交 `08c1b53`）：挂载时按份 reserve、文本变化与卸载时 release。旧文档称未接线，已过时。

- [ ] **Step 2: 在前序计划里标注已收口项**

`2026-10-02-...md:103` 的「限制 3：renderBudget 未按会话规模降档（P2-2 未做）」补一行：本轮 Task 5 已收口。

- [ ] **Step 3: 检查是否触及对外可见功能面**

本轮改动只涉及渲染器内部性能与错误处理，**不涉及命令、选项、配置项、权限、快捷键**，故不需重生成操作手册。若执行中发现改到了 `src/cli/cmd/`、`src/gyccode/config/`、`src/tui/config/`、`src/gyccode/permission/`、`src/gyccode/tool/`，则必须先同步 `scripts/manual_content_*.py` 再跑 `python scripts/gen_manual_docx.py`。

- [ ] **Step 4: 全量验证**

Run: `bunx tsc --noEmit`
Expected: 0 error

Run: `bun run test`
Expected: 全绿，0 fail

- [ ] **Step 5: 提交**

```bash
git add docs/AGENTS-REFERENCES.md docs/compose/plans/2026-10-02-opentui-stability-long-session.md
git commit -m "docs(tui): 校正句柄预算接线状态与 P2-2 收口记录"
```

---

## 三、执行顺序与依赖

```
Task 0 (升级 0.5.14) ──> 全部后续任务（补丁链适配是前置）
Task 1 (度量)  ─┬─> Task 5 (降档，读 monitor)
                └─> Task 8 (渲染错误订阅，读 monitor)
Task 2 (收口)  ── 独立，可并行
Task 3 (退出)  ── 独立
Task 4 (resize 补丁) ── 需实机验证；chunk 文件名随版本变，必须动态发现
Task 6 (正则缓存) ── 独立
Task 7 (降频+日志) ── 独立
Task 9 (文档)   ── 依赖 Task 5 结果
```

建议顺序：**Task 0 → 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9**。Task 0 先行是因为升级会改变 chunk 文件名与 `getStats()` 实现，不先升则 Task 1/4 要写两遍。

---

## 四、本计划的已知限制

1. **B-2 无法在本轮解决** —— opentui 0.5.6 不暴露已用句柄数（`getRenderStats` 不含该字段），因此 `handle-pressure` 只能基于估算，估算与真实占用可能偏差。彻底解决需上游加 API 或升级版本。
2. **B-3 的错误计数可能拿不到** —— `render:error` 无人监听且订阅 API 未确认公开（Task 8 Step 5 会先核实）。拿不到则降级为「帧时异常」间接推断。
3. **Ctrl+Break 未必可拦截** —— 取决于 Bun 在 Windows 上是否派发 SIGBREAK（Task 3 Step 5 实测决定）。不可拦截时只能做到「关窗前尽量复位 + 留下可观测痕迹」。
4. **Windows resize 补丁依赖 chunk 文件名** —— opentui 升级后 chunk 文件名/内容会变，补丁会 `exit(1)` 并明确报「未匹配到原版代码」。这是刻意设计：宁可安装期显式失败，也不要静默拿到未打补丁的渲染器。
5. **Task 5 的降档阈值是经验值** —— 400 / 1200 条来自历史崩溃点附近（`0b2e7fd` 等），未在真实终端做过 2 小时长跑对比。前序计划「限制 4：未做真实终端 2 小时长跑内存曲线对比」至今仍未完成，**建议在 Task 5 之后安排一次 2 小时长跑验证阈值合理性**。
6. **未覆盖** —— C-3（行级虚拟化）与 C-2（markdown 增量解析）改动面大、风险高，本轮**有意不做**；C-2 是否真全量重解析取决于 `@opentui/solid` reconciler 内部行为，**本轮未核实**（下沉 `node_modules` 的探索在 token 预算内未完成）。若 Task 1 的帧时数据显示 C-2 仍是主热点，再单独立项。

---

## 五、排查到但本轮明确不覆盖的问题

以下 6 项在排查中被确认存在，但**不在本轮 9 个任务内**。逐条给出不做的理由，避免被当成「已修」或「不存在」：

| 编号 | 问题 | 不覆盖的理由 |
|---|---|---|
| A-5 | `src/cli/tui/worker.ts:64-69` 非堆 OOM 的 `uncaughtException` 只记日志不退出，与 `:47` 的 `unhandledRejection` 分支策略不一致 | 属 worker 生命周期策略分歧，需先决定「worker 带病存活是否可接受」，是产品决策不是缺陷修复。留待单独立项 |
| C-8 | `<spinner interval={80}>` 每实例 12.5fps 定时器（`src/tui/component/spinner.tsx:19`） | 并发实例数**未核实**；改前需先在 Task 1 的度量下确认定时器数量是否构成瓶颈，否则是凭猜测优化 |
| D-1 | `logError` 在 TUI 主进程只走 stderr，不进 `gyccode.log`（sink 只在 worker 侧注册，`src/gyccode/effect/app-runtime.ts:180`） | 修它需要决定「TUI 主进程是否该直接写全局日志文件」，涉及日志轮转（`src/core/observability/logging.ts:20`）与多进程写竞争，风险高于收益。本轮只在 Task 2/7 补齐了该补的调用点，**未动 sink 架构** |
| E-1 | `process.once("SIGCONT")` 注册后无解绑（`src/tui/app.tsx:1449`） | `enabled: platform !== "win32"`，谷总本机（Windows）永不触发。改它对本机零收益，等有 POSIX 使用者再处理 |
| E-2 | `src/tui/fallback/safe-mode.ts:49` `fallbackClaimed` 一次性护栏不可复位 | 复位意味着允许同一进程二次降级，需确认渲染器重建路径安全。已核实主链路单进程只创建一次 renderer（`src/tui/app.tsx:327`），但 fallback 分支的重建未核实，贸然复位可能引入重复创建 |
| E-3 | `src/tui/fallback/terminal.ts:303-308` FPS 节流的 `setTimeout` 无 `unref()`/cancel | 同上，fallback 渲染器在本机不启用（走 opentui 主链路）。仅在 fallback 成为默认路径时才有实际收益 |

**这份清单本身是排查产出**：E-1/E-2/E-3 全部集中在 `src/tui/fallback/`，说明该目录的清理纪律弱于主链路。若将来把 fallback 提升为默认渲染器，这三项需优先处理。