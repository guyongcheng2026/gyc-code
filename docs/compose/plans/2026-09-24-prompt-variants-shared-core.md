# 指令变体公共段抽取（T3#8 阶段 2）立项书

> **状态**: 🟯 待排期（2026-09-24 立项）——阶段 1（default/anthropic 单文件精简）已完成（f9ab04c），本阶段为架构性去重，**动刀前需谷总排期确认**（涉及全部变体 system 字节重排）。

## 目标

消除 `src/gyccode/session/prompt/` 变体间的维护性重复——实测 `default ↔ trinity` 精确同行重叠 **81%**（41 行 / 6,879 字符近乎双份拷贝），anthropic↔default 18%、↔trinity 15%。改一处忘同步另一处即产生行为漂移（同类问题在工具 desc 阶段已踩过一次）。

## 方案（两选一，实施前定稿）

- **方案 A（推荐）**：抽 `_core.txt` 公共核心（Accuracy/Tone/Doing tasks/Tool usage/Code refs 骨架），`provider()` 分发改为 `[variantHead, CORE, variantTail]` 拼接（`system.ts` 改约 20 行）；变体文件只留身份句与模型特化段。
- **方案 B**：仅对齐 default↔trinity 内容（trinity 差异段人工审出后删除重复），不建拼装机制——12 变体重复依旧，收益减半。

## 风险

- **中**：全部变体 system 字节序重排 → 存量会话一次 CH 前缀折断（一次性，与 T1 改动同类）；段序变化可能改变模型段间注意力权重——需 A/B。
- 拼装顺序错误会把模型特化段错位（gemini/beast/gpt 已按各自风格独立维护 16K/11.8K/9.9K——**阶段 2 默认只动 default/trinity 两文件**，其余 10 个变体保持独立，控制爆炸半径）。

## 验收

1. 各变体字节级 snapshot diff 报告（公共段合并前后逐行对照，无意外语义行变化）；
2. `bunx tsc --noEmit` 0 错误 + 全量 `bun run test` 绿；
3. 3 任务 A/B 目检（编码/审查/问答各一轮，输出风格无回归）；
4. default/trinity 重复率 81% → 0（lint 化：linescan 或脚本断言）。

## 工作量

方案 A 约 1-2 天（含 snapshot 工具与回归）；方案 B 约 0.5 天。
