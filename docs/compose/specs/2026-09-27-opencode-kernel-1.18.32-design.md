# 内核升级设计：vendored opencode v1.18.26 → v1.18.32

> [!NOTE]
> This document may not reflect the current implementation.
> See the final report for up-to-date state:
> [Final Report](../reports/2026-09-27-opencode-kernel-1.18.32-升级报告.md)

日期：2026-09-27
状态：设计已获谷总批准（两段评审均通过）

## 一、背景与目标

- gyc-code 的承继内核（`src/{core,tui,llm,schema,protocol,codemode}`）来自 opencode **v1.18.26**（MIT），自研层为 `src/gyccode/`。
- 上游最新稳定版为 **v1.18.32**（2026-09-21 发布，仓库现为 `anomalyco/opencode`）。
- 目标：**全量对齐** 内核至 v1.18.32，保留全部本地化成果，并验证通过（类型 + 全量测试）。

## 二、范围

**在范围内**（上游 `packages/` → gyc 内核目录）：

| 上游路径 | gyc 路径 | v1.18.26..v1.18.32 变更文件数（含测试/package.json） |
|---|---|---|
| `packages/core/src` | `src/core` | 5（+4 测试） |
| `packages/tui/src` | `src/tui` | 14（+3 测试） |
| `packages/llm` `packages/protocol` `packages/schema` `packages/codemode` | `src/{llm,protocol,schema,codemode}` | 仅 package.json |
| `packages/opencode/src` | `src/cli` / `src/gyccode`（按映射表逐文件确定） | 13（+11 测试） |
| `packages/server` `packages/effect-drizzle-sqlite` | `src/{server,effect-drizzle-sqlite}` | package.json |

**不在范围内**：`packages/{web,console,desktop,app,docs,sdks,storybook,stats,enterprise,...}` 等非内核产物。

**实测差异面**：v1.18.26..v1.18.32 全仓 220 文件；过滤到内核相关包后约 60 文件，其中源码约 40 个，其余为 package.json 与测试。

## 三、执行路线（路线 A：逐文件移植）

1. **建映射表**：上游路径 → gyc 路径。映射不上的文件单列，交谷总裁决。
2. **逐文件比对**：取上游 `v1.18.26..v1.18.32` 的 hunk，与 gyc 对应文件比对，逐 hunk 手工合入。
3. **测试同步**：上游测试文件同步移植，保持既有测试风格。
4. **依赖变更**：`package.json` 变更单独评估；**effect / drizzle 版本一律不动**；新增依赖需单独报批。

## 四、冲突裁决规则（优先级从高到低）

1. **本地化成果**：去 opencode 品牌、`GYCCODE_*` 环境开关、简体中文文案与注释、Node/Bun 双实现适配层。
2. **自研层契约**：`src/gyccode/` 既有接口契约不被破坏。
3. **上游语义**：1.18.32 的功能语义及其测试。

即：功能语义跟上游，表现形式跟本地化。

## 五、验证

1. `bunx tsc --noEmit`（排除 `src/webapp`）—— 零错误。
2. `bun run test`（全量）—— 全绿。
3. 不跑 `bun run build`（本次不涉及发布产物）。

## 六、收尾

1. 更新 `AGENTS.md` / `README.md` 中的内核基线版本号为 1.18.32。
2. 按铁律执行任务收尾 4 步：总结、归纳、学习（沉淀 docs/记忆/SKILL）、进化（可改进项落地或记待办）。

## 七、风险与回退

| 风险 | 说明 | 应对 |
|---|---|---|
| 映射错位 | 上游目录与 gyc 目录非 1:1 | 先建映射表并抽查，映射不上的文件交谷总裁决 |
| 本地化丢失 | 手工合入时覆盖品牌/中文/开关 | 每个文件合入后 grep 品牌违禁词与 `GYCCODE_` 开关做校验 |
| 依赖漂移 | 上游 package.json 版本领先 | 依赖变更单独评估，effect/drizzle 锁定不动 |
| 回归 | 内核语义变更影响自研层 | 全量测试；失败即按 hunk 回退（单文件粒度可回退） |

回退策略：变更以文件为粒度，`git checkout -- <file>` 即可单点回退；整体回退用 `git reset --hard` 到升级前 HEAD。
