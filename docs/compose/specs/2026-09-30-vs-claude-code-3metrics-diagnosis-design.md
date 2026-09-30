# 2026-09-30 · 对标 Claude Code 三指标诊断报告（设计）

## [S1] 问题

谷总要求用三个指标对标 **Claude Code 最新版本**，并要求超越：

1. **任务成功率**（做一件事多快做对）—— 最综合，其他都是它的因素
2. **幻觉率** —— 编造代码/API 是最贵的事故
3. **每任务真实成本** —— 不是订阅价，是「完成一个 feature 花多少钱」

勘察结论（`C:\gyc-code`，HEAD `b6b4b164b6`，工作区干净）：

| 指标 | 现有测量能力 | 现有对标基线 |
|---|---|---|
| ① 任务成功率 | **无**。150 个测试全为单元测试；`benchmark.test.ts` 20 项中 17 项为文件存在性断言、3 项 `skip`（`src/gyccode/benchmark/benchmark.test.ts:49-203`） | 仅 `REALRUN-2026-08-28` 的 9/10，10 个极简任务、免费档模型，不可外推 |
| ② 幻觉率 | **无**。`build-training-set.ts` 为空壳：运行时零写入、第一步即 `filter(l => l.success)` 丢弃全部失败样本（`src/gyccode/memory/training-pipeline.ts:246`）、`failedTasks` 硬编码 0（同文件 `:313`）、7 条数据为手写 Flask/Vue 演示（`scripts/build-training-set.ts:82-156`） | **零** |
| ③ 每任务真实成本 | 原料齐、闭环缺。`session` 表已有 cost + 5 个 token 列（`src/core/database/schema.gen.ts:198-203`），`Session.getUsage` 分档计价可用（`src/gyccode/session/session.ts:333-405`）；但无 task 实体、无成功标记、无聚合报表、`model.cost` 缺失时静默计 0（`session.ts:394-397`）、与真实账单无对账 | **零**（`GAP-08-23 L97` 自述「本地无单价表」） |

两处额外风险：
- **对标快照过期 45 天**：`GAP-ANALYSIS-2026-08-16` 基准为 Claude Code **v2.1.88** 反编译源码。本机已装 **v2.1.223**。
- **稳定性历史数据无效**：`stability-log.jsonl` 94 行末段全为 `alive:false`，巡检空转。

## [S2] 本轮范围（谷总已拍板）

**只出诊断报告 + 缺口清单。不跑真实 LLM，不建评测框架，不改任何生产代码。**

- 交付物：`docs/compose/reports/2026-09-30-vs-claude-code-3metrics.md`
- 零 token 花费，全程可离线复核
- 不重扫安全/合规/品牌（谷总另有轮次，上一轮已 commit `b6b4b164b6`）

## [S3] 取证方法

| 目标 | 方法 |
|---|---|
| gyc 侧 | 沿三条链路逐行取证：`session/`（prompt 拼装、processor、compaction、cost、cache-anchor）、`tool/`（read/edit/write/grep/glob/websearch/registry/json-schema）、`provider/` + `learning/` + `scripts/` 度量脚本 |
| Claude Code 侧 | 静态重采本机 **v2.1.223**：工具清单、斜杠命令、权限/沙箱、上下文压缩、hook、任务与成本展示 |
| 硬约束 | 每条缺口必须带 gyc 侧 `file:line` + CC 侧可复现命令输出。**拿不到行号的不写进报告** |

## [S4] 报告结构

三章主线，每章固定四段：

1. **规范定义** — 该指标的正确算法应该怎么算（先立尺子定义）
2. **当前实现取证** — 现在有什么、卡在哪（附 file:line）
3. **与 v2.1.223 的差距** — 对手在该维度有什么
4. **缺口清单** — P0/P1/P2，每条带验收标准

附录 A：P0/P1/P2 总表（一页排期用）
附录 B：Claude Code v2.1.223 静态重采原始记录

## [S5] 缺口条目格式

```
[ID]  P0/P1/P2
位置：  src/gyccode/... :line
机制：  为什么这一处会让 <指标> 变差（因果链，不是「这里不好」）
修复：  具体改什么
影响：  ① 成功率 / ② 幻觉率 / ③ 每任务成本（可多选）
验收：  一条可离线执行的验证动作（不花 token）
```

ID 前缀：`S-`（成功率）/ `H-`（幻觉）/ `C-`（成本）。

## [S6] 明确不做（YAGNI）

- 不建任务集、不写评测框架、不改生产代码
- 不出「修完预计提升 X%」类估算 —— 只给可验证的机制缺口，数字等尺子建好再出
- 不重扫安全/合规/品牌
