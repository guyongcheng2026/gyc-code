# S0 抽象层产线接入实施计划（RendererBackend + opentui 适配）

日期：2026-08-26 · 阶段：S0（第 1 周）· 回滚点：R1（合并但不切默认，产线形态不变）

## 一、目标

将 P2 冻结的 RendererBackend 抽象接入产线主链路，建立 `GYC_TUI_BACKEND` 三态分流；默认 `auto` 行为与现状完全一致（R1 原则）。

## 二、任务清单

### Task 1: safe-mode.ts 三态语义
- [x] `backendChoice(): "opentui" | "fallback" | "auto"` 解析环境变量
- [x] `shouldUseFallback()` 保持向后兼容（非 opentui 即可降级）
- [x] `isExplicitFallback()` 显式强制判定
- [x] 补三态单测

### Task 2: app.tsx 显式 fallback 分流
- [x] `GYC_TUI_BACKEND=fallback`：跳过 opentui 创建，直接进入自研安全模式界面（S0 预览形态：消息流+单行输入；完整组件桥接属 S1）
- [x] 分流事件写 gyccode.log（`event=backend-explicit-fallback`）

### Task 3: G5 可观测——renderer 归因字段
- [x] 创建失败降级：`event=renderer-create-degraded renderer=opentui backend=<choice>`
- [x] 运行中崩溃降级：`event=runtime-crash-degraded renderer=opentui backend=<choice>`
- [x] 主进程崩溃日志（writeMainCrash）补 renderer 字段

### Task 4: P5 基线——opentui stats 采集通道
- [x] `GYC_TUI_STATS=1` 时 `gatherStats` 开启（默认关闭，零行为变化）
- [x] memory-sample 心跳附带 rendererStats（fps/avgFrameMs/frames）

### Task 5: 验收
- [x] bun test src/tui/fallback 全绿
- [x] scoped tsc 零错误
- [x] 默认路径（auto）行为不变核查：分流仅在显式 fallback 生效；stats 默认关
- [x] commit（R1 锚点）

## 三、R1 回滚方式

`git revert <S0-commit>` 即恢复产线原形态。S0 不删除任何既有代码路径，默认 auto 与 GYC_TUI_BACKEND=opentui 行为与 1c5533f 基线一致（新增日志字段除外）。

## 四、验收记录

- fallback 测试：60 pass / 0 fail（新增 backendChoice 三态 2 用例，152 断言）
- app.tsx lint：ERROR 清零；剩余 2 个 HINT（open/rssMB 未用变量）为预存问题，不属本次范围
- **预存缺陷顺手修复**：基线 1c5533f 的 app.tsx 使用 `claimFallbackOnce()` 却未 import（运行时崩溃降级路径会 ReferenceError，护栏失效）——本次 import 补全，属 S0 降级通道正确性依赖
- 默认路径回归：auto 分流短路逻辑仅在 isExplicitFallback() 为真时触发；gatherStats 默认 false 与原硬编码一致
- app.tsx 6 处修改均带 S0 锚点注释，便于 revert 与审查
