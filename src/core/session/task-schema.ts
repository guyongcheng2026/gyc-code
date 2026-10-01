/**
 * 任务投影（2026-09-30 每任务真实成本 P0 / C-01）。
 *
 * 一条 task = 一个用户轮次：收到用户消息时开，该轮 assistant 结束（或下一条
 * 用户消息到来）时结算。成本、token 直接来自既有投影口径（`SessionTable`
 * 同源），因此 `gyc task list` 的汇总与 `gyc stats` 对得上。
 */
export const TaskStatus = ["running", "success", "failed"] as const
export type TaskStatus = (typeof TaskStatus)[number]