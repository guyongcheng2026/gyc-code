# [S1] pivot 部分压缩设计

日期: 2026-08-11
状态: 已批准（用户确认设计）

## [S2] 问题

gyc 的压缩目前只能全量压缩（`select()` 把 tail_turns 预算内的最近消息保留为 tail，之前全部压成 summary）。用户无法围绕某条 pivot 消息做部分压缩（例如"保留 pivot 之后的所有消息，只压缩 pivot 之前"）。对标 Claude Code 的 `partialCompactConversation`（pivot 方向 from/up_to）。

## [S3] 范围

- 仅支持 `up_to` 方向：压缩 pivot 之前、保留 pivot 之后（`tail_start_id = pivot.id`）。
- `from` 方向（保留 pivot 之前、压缩 pivot 之后）与 gyc 现有 `filterCompacted` 模型冲突（tail 必须是从 `tail_start_id` 到 compaction 之间的段，`tail_start_id` 之前全丢弃），本次不实现。
- 暴露方式：`select()` 核心 + HTTP API（`summarize` 端点）。TUI 接入为后续迭代。

## [S4] 实现

在 `compaction.ts` 顶部导出纯函数 `pivotTail(messages, pivotMessageID)`:

输入: 消息列表 + pivot 消息 id。
逻辑: 定位 pivotIndex；pivot 不存在或 `index <= 0` 时返回 `undefined`（head 为空或包含全部，无法部分压缩）。
输出: `{ head: messages.slice(0, pivotIndex), tail_start_id: pivot 消息 id }`。

`select()` 增加可选 `pivot?: MessageID` 参数；pivot 存在时优先用 `pivotTail`，无效（undefined）时回退现有 tail_turns 逻辑。

## [S5] 数据流

1. HTTP `POST /session/{id}/summarize` 的 payload 增加可选 `pivot: { messageID }`。
2. `summarize` handler 传入 `compactSvc.create({ ..., pivot })`。
3. `create` 在 compaction part 上写入 `pivot_message_id`（持久化）。
4. `process` 从 compaction part 读取 `pivot_message_id` 传给 `select()`。
5. `select()` 返回 `{ head, tail_start_id }`，head 被压缩为 summary，pivot 及其之后的消息作为 tail 保留（`filterCompacted` 按 `tail_start_id` 重排，现有机制无需改动）。

## [S6] Schema 变更

`src/schema/v1/session.ts` 的 `CompactionPart` 增加可选字段 `pivot_message_id: Schema.optional(MessageID)`（与 `tail_start_id` 并列）。旧的 part 无此字段，读取出 undefined，兼容。

## [S7] 边界

- pivot 消息不存在、位于开头（index 0）、或已被先前压缩隐藏时，`pivotTail` 返回 undefined，`select()` 回退标准 tail_turns 逻辑（不报错中断）。
- pivot 之前消息过多时，`process` 现有溢出保护仍生效（summary 生成失败则 error 消息，与现有行为一致）。

## [S8] 测试

- `pivotTail` 单测：
  - pivot 有效时 head/tail_start_id 正确划分
  - pivot 不存在 / index 0 时返回 undefined
- 现有 compaction 相关测试不回归（356 pass 持续通过）。
