# TUI 自研 fallback 渲染器 PoC（P0+P1）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 纯 JS 最小差分帧渲染器，作为 opentui 失效时的安全模式保底，并为全面替换决策沉淀实测数据。

**Architecture:** Cell 网格模型 + 行区间重绘差分引擎 + 可注入终端后端（进程/内存双实现），宽度口径与 display-width.ts 同源（string-width）。命令式更新，无 reconciler。

**Tech Stack:** TypeScript、bun:test、零原生依赖。

**定位铁律：fallback ≠ 等价替换。PoC 明确不做：布局引擎、Solid reconciler、鼠标、tree-sitter 高亮、全组件树迁移。超纲即砍。**

---

### Task 1 (P0): screen.ts — Cell 网格

**Files:** Create `src/tui/fallback/screen.ts`；Test `src/tui/fallback/screen.test.ts`

- [x] Step 1: 失败测试——writeText 中文占 2 列、行尾截断、resize 保内容、clear、snapshot
- [x] Step 2: 实现CellStyle(fg/bg/bold/dim/reverse)、Cell{ch,width,style}、writeText/fillRect/resize/clear/snapshot
- [x] Step 3: 测试通过

### Task 2 (P0): diff.ts — 差分引擎

**Files:** Create `src/tui/fallback/diff.ts`；Test `src/tui/fallback/diff.test.ts`

- [x] Step 1: 失败测试——首帧全量含 alt-screen 序列、局部变更仅重绘变化行、无变化输出空、SGR 最小化、宽字符 run 边界不撕裂
- [x] Step 2: 实现 renderFull/renderDelta（first..last 区间重绘 + style 连续段 SGR 切换）
- [x] Step 3: 测试通过

### Task 3 (P0): terminal.ts — 终端抽象

**Files:** Create `src/tui/fallback/terminal.ts`；Test `src/tui/fallback/terminal.test.ts`

- [x] Step 1: TerminalBackend 接口 + ProcessBackend（tty）/MemoryBackend（测试与无 tty 场景）
- [x] Step 2: FallbackRenderer：start(alt-screen+全量)/present(delta)/stop(恢复)、resize 全量重绘、帧合并调度
- [x] Step 3: 用 MemoryBackend 测试进出序列与增量呈现

### Task 4 (P1): input.ts — 最小按键解析

**Files:** Create `src/tui/fallback/input.ts`；Test `src/tui/fallback/input.test.ts`

- [x] Step 1: 解析方向键/PgUp/PgDn/Home/End/回车/Ctrl+C/ESC/Backspace/普通 UTF-8 文本（粘贴整段）
- [x] Step 2: 流式缓冲处理跨 chunk 序列
- [x] Step 3: 测试通过

### Task 5 (P1): demo-app.tsx + demo 入口

**Files:** Create `src/tui/fallback/demo-app.ts`；Create `scripts/tui-fallback-demo.ts`

- [x] Step 1: 安全模式界面骨架：标题条反白 + 消息流只读区（滚动）+ 单行输入 + 提示条
- [x] Step 2: 键处理：上下/PgUp/PgDn 滚动、输入编辑、回车 echo、Ctrl+C/ESC 退出
- [x] Step 3: demo 入口可运行（node/bun scripts/tui-fallback-demo.ts）

### Task 6: 验证与收尾

- [x] Step 1: bun test src/tui/fallback 全绿
- [x] Step 2: scoped tsc 改动文件零类型错误
- [x] Step 3: commit + push + 请示 P2/P3
