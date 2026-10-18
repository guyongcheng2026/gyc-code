# 遗留清零与增强立项实施计划（2026-10-18）

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 清零当前可执行遗留（U-3 part 状态对账、TUI 模式切换闪烁、1.5x 超长会话压测），完成模型目录刷新与插件市场盘点供料，并把决策项收敛成谷总可拍板的清单。

**Architecture:** 三个代码/工具任务相互独立；模型目录刷新与市场盘点为只读+可再生文件改动；文档收尾最后执行。对账只改内存视图不回写 DB，规避与活跃会话的竞态。

**Tech Stack:** Bun 1.3.14 + TypeScript + effect 4.0.0-beta.83 + bun:test + bun:sqlite。验证链：`bun test <文件>` → `bun run typecheck` → `bun run test`（全量禁用裸 `bun test`）。

**基准事实（2026-10-18 实测）：** HEAD=origin/main=`f703bbd`；全量 2157 pass / 0 fail；冷启动 p50 约 1650ms；Fledge Alpha 已收录（fledge-alpha-free，provider opencode，api.json:269054）；marketplace/ 仅 2 插件；compaction.ts 1044 行。

## 决策清单（谷总 2026-10-18 指示：马上逐一 100% 修复，按默认执行）

- Q1 每任务完成即 git commit（post-commit 自动推送）：是
- Q2 D3 执行器路线：本轮不启动
- Q3 P2 增强项：仅产出 B5/A2 供料报告；D4 待谷总给场景
- Q4 U-1 Pixel Canary：维持未解决，待确切 ID
- Q5 U-2 TextBuffer 原生复现：本轮不做
- Q6 执行方式：本会话内逐一执行

## 探索结论（2026-10-18 四路子代理取证）

1. U-3 无对账逻辑：ToolState 四态（src/schema/session-message.ts:82-119）；Assistant.content 载体（:159-171）；加载纯解码无清理（src/core/session/history.ts:66-80，消费方全汇聚于此）；运行中转换只在 message-updater.ts:282-340。
2. TUI 闪烁四候选：local.tsx:541-550 toast 3000ms；prompt/index.tsx:1385-1391 createFadeIn 重算；prompt/index.tsx:1528-1556+1404-1426 状态条与 spinnerDef 重建；local.tsx:97 静默回退。去抖只挂 pending() 未覆盖 mode 切换。
3. 模型：api.json provider=220、模型=8157；Fledge Alpha 已在 opencode provider（fledge-alpha-free）。marketplace/ 仅 2 插件，registry 实为 GitHub Pages（plugin/marketplace.ts:25）。compaction.ts 1044 行，触发 overflow.ts:73-95。
4. 超长会话：无合成生成器；生产库 %APPDATA%\gyccode\gyccode.db（GYCCODE_DB 可重定向）；幻觉防护机制已齐。

## 任务与步骤（勾注跟踪）

### 任务 0：AGENTS.md 修订提交（前置）
- [x] 提交既有 +4/-3 修订（路径修正、禁裸 bun test、health 命令、@test 别名），mojibake 门禁通过

### 任务 1：U-3 tool part 状态对账（TDD，P0）
- [x] 失败测试 history-reconcile.test.ts（running→error 保留 input/structured/content；pending→error rawInput 入 structured；completed/error 与非 tool 不动；非 assistant 不动）
- [x] 确认失败后最小实现 reconcileInterruptedTools + load/loadForRunner/entriesForRunner 三出口接线
- [x] 单测 PASS → bun run typecheck 0 error → bun run test 全量 0 fail → commit "fix(session): 会话加载对账中断残留的 running/pending 工具状态（U-3）"

### 任务 2：TUI 模式切换闪烁——静态取证 + 可证修复（P1）
- [x] 静态核实四候选
- [x] 仅修静态可证候选（toast 去重降频、fadeIn memo、set 失败不回退），独立 commit
- [x] bun test src/tui + typecheck 通过；目视确认留待谷总（报告注明）

### 任务 3：1.5x 超长会话压测基建（P1，依赖任务 1）
- [x] scripts/gen-synthetic-session.mjs（bun:sqlite 写 GYCCODE_DB 临时库，参数化 messages/parts/part-bytes）
- [x] scripts/bench-long-session.mjs（2685 基线库 + 1.5x 库，load 5 次中位 + RSS + prompt compose 计时）
- [x] 验收：1.5x load p50 ≤ max(基线×1.8, 2000ms)、RSS<2GB、无解码错误、compaction 路径正确
- [x] 报告 docs/compose/reports/2026-10-18-1.5x-long-session-stability.md

### 任务 4：模型目录刷新 + 市场盘点供料（P2）
- [x] bun scripts/sync-models.mjs 刷新；验证 Fledge Alpha 仍在；有变化则提交 api.json
- [x] 报告 docs/compose/reports/2026-10-18-marketplace-inventory.md（B5 供料）

### 任务 5：文档与知识收尾（最后）
- [x] TODO-DESIGN.md 更新（U-3 → 已完成；TUI 闪烁结论）
- [x] node scripts/sync-manual.mjs 校验；触发则改 manual_content_*.py 并重建 docx
- [x] 计划勾注回填；bun run build 全量 dist；最终提交推送并核对 [ahead N] 与 worklog-sync.log；Obsidian 工作流笔记更新

## 依赖顺序

任务 0 →（1、2、4 逐一串行）→ 3（依赖 1）→ 5。