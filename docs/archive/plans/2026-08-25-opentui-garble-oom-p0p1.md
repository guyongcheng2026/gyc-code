# opentui 乱码 + V8 OOM 治理（P0+P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 统一 opentui 宽度口径消除中文乱码；把 V8 OOM 从原生崩溃变成可捕获、可降级、可诊断的分级治理。

**Architecture:** 乱码侧——在 TUI 入口最早时机强制 `OPENTUI_FORCE_WCWIDTH`，使原生 buffer 与 JS 侧 string-width 宽度口径一致；OOM 侧——bin/gyc 启动 Node 时注入 `--expose-gc --max-old-space-size`（按物理内存计算），app.tsx 内存守护升级为三级响应（GC→快照→优雅退出）。

**Tech Stack:** Bun 构建 / Node 运行时 dist、@opentui/core 0.5.6、bun:test。

---

### Task 1: 宽度口径统一（乱码主因修复）

**Files:**
- Create: `src/tui/util/width-method.ts`
- Modify: `src/tui/index.tsx`
- Test: `src/tui/util/width-method.test.ts`

依据：native 默认 `widthMethod="unicode"`（chunk-bun-9335djz2.js:11309），JS 侧用 Bun.stringWidth/string-width，CJK/emoji 口径不一致；opentui 提供 `OPENTUI_FORCE_WCWIDTH` 开关但项目未设置。env 在 createCliRenderer 前任意时刻设置均生效（能力探测在渲染器创建时进行）。

- [x] Step 1: 写失败测试 `width-method.test.ts`：调用 `forceWcwidth()` 后 `process.env.OPENTUI_FORCE_WCWIDTH === "1"`，且重复调用幂等
- [x] Step 2: 运行确认失败（模块不存在）
- [x] Step 3: 实现 `forceWcwidth()`：未设置时置 `"1"`
- [x] Step 4: `src/tui/index.tsx` 顶部（export 前）调用，保证先于 @opentui 渲染器创建
- [x] Step 5: 测试通过后提交

### Task 2: bin/gyc 注入 V8 堆上限与 GC 暴露

**Files:**
- Modify: `bin/gyc`

依据：dist 为 Node 目标（build.mjs 默认），V8 默认堆上限触发的是不可捕获的堆 OOM abort；显式 `--max-old-space-size` 把 OOM 变成可捕获 RangeError，配合 app.tsx uncaughtException 兜底恢复终端。

- [x] Step 1: 新增 `computeHeapFlags()`：`--expose-gc` + `--max-old-space-size=min(max(totalMemMB*0.6,1024),4096)`，尊重既有 `GYC_MAX_OLD_SPACE` 环境变量
- [x] Step 2: Bun→Node spawn 路径（`spawnBun(findNode(), ...)`）注入 flags
- [x] Step 3: Node 直跑路径：若当前进程未带 `--expose-gc`，改为 spawnSync node distEntry 并注入 flags（放弃进程内 import，换取 OOM 可治理性）
- [x] Step 4: 验证 `gyc --version` 正常启动退出

### Task 3: 内存守护三级响应 + 心跳采样 + fatal 快照

**Files:**
- Modify: `src/tui/app.tsx`（内存监控段）

分级：>40% WARN+主动 GC → >45% memory-critical+堆快照+GC → >50% 销毁渲染器优雅退出（原有）。每 10 分钟写一条 `memory-sample` 心跳供趋势分析。

- [x] Step 1: meter 回调重构为三级分支，stage2 用 `node:v8` 的 `writeHeapSnapshot` 写入 global.log（复用 heap.ts 的保留策略思想：仅保留最新 2 份 tui-memory-*.heapsnapshot）
- [x] Step 2: 心跳采样日志
- [x] Step 3: typecheck 通过

### Task 4: UTF-8 代码页读回校验强化

**Files:**
- Modify: `src/tui/terminal-win32.ts`
- Test: `src/tui/terminal-win32.test.ts`

- [x] Step 1: `win32EnableUtf8Console()` 改为返回实际生效状态（SetConsoleCP 后 GetConsoleOutputCP 读回校验）
- [x] Step 2: guard 回调统计连续失败次数并暴露 `utf8GuardMismatchCount` 供诊断
- [x] Step 3: 测试通过

### Task 5: 验证与收尾

- [x] Step 1: `bun test src/tui/util/width-method.test.ts src/tui/terminal-win32.test.ts`
- [x] Step 2: `bun run typecheck`（typecheck.mjs）通过
- [x] Step 3: 手动验收：`node bin/gyc --version`；TUI 启动观察中文无乱码
- [x] Step 4: 提交全部变更

## 明确不做（本轮）

- externalOutputMode passthrough→buffered 切换：证据不足，opentui 该选项文档缺失，盲改有回归风险；待 Task 1 验证后如仍有残留再评估。
- 长会话消息虚拟化截断（原 P1-6）：涉及 session 路由大改，风险高，单独立项。
- 自研 fallback 渲染器（P2）：另行立项。
