# S2 灰度切换实施计划（默认 fallback，opentui 转后备）

日期：2026-08-26 · 阶段：S2（第 4 周）· 回滚点：R3（GYC_TUI_BACKEND 一键切回）

前置：S1 已通过真机验收（会话引擎接线、流式回复、光标闪烁、resize 无闪帧）。

## 一、语义变更（唯一核心改动）

`GYC_TUI_BACKEND` 三态语义保持，**默认值反转**：

| 值 | S0/S1 行为 | S2 行为 |
|----|-----------|---------|
| 未设置 | auto（opentui 优先，失败降级） | **fallback（自研渲染器）** |
| `fallback` | 显式自研 | 显式自研（不变） |
| `auto` | opentui 优先，失败降级 | opentui 优先，失败降级（显式切回手段之一） |
| `opentui` | 纯 opentui，禁降级 | 纯 opentui，禁降级（不变） |

R3 保险丝：`$env:GYC_TUI_BACKEND="auto"` 或 `"opentui"` 一键切回 opentui 形态。

## 二、任务清单

- [x] safe-mode.ts：backendChoice 默认值 auto → fallback（S2 灰度声明注释）
- [x] app.tsx：分流条件从 isExplicitFallback() 改为 backendChoice() === "fallback"（默认也走自研）；启动日志区分 source=explicit|default
- [x] safe-mode.test.ts：三态测试更新（未设置 → fallback）；切回路径用例
- [x] G5 日志：backend-selected 事件（renderer/backend/source 三字段）
- [x] 验收：全量测试 + scoped tsc + lint
- [x] 提交（R3 锚点）

## 三、范围边界（明确不做）

- 不删除 opentui 依赖与补丁链（那是 S3）
- 不改崩溃降级通道（auto 模式下 DemoApp 安全模式照旧）
- 不改 bin/gyc 启动参数

## 四、验收记录（2026-08-26）

- fallback 全量：78 pass / 0 fail（三态语义用例更新：默认 fallback、auto/opentui 切回）
- scoped tsc：0 错误；lint：0 错误
- R3 回滚：`$env:GYC_TUI_BACKEND="auto"`（opentui 优先）或 `git revert <S2-commit>`（默认回 auto）
