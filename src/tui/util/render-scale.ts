/**
 * 会话规模 → 渲染规模档位。
 *
 * 帧率按会话规模降档（见 fallback/capability.ts 的 scaleDownFps），但降档口径是
 * 「超阈值部分每达到阈值的一倍再降一档」，即按 floor(scale / LARGE_SESSION_THRESHOLD)
 * 取档。因此把规模量化到阈值的整数倍**不改变**取档结果，却能让下游依赖在
 * 整档区间内保持稳定——否则每新增一条消息都会让下游 effect 重跑。
 *
 * 独立成纯函数是为了能脱离 TUI 组件做单测。
 */

/**
 * @param messageCount 当前会话消息条数
 * @param nodeFactor 单条消息折算的节点数（一条消息常含正文/思维/工具输出多个节点）
 * @param threshold 取档粒度（LARGE_SESSION_THRESHOLD）
 * @returns 量化后的规模值（阈值的整数倍）
 */
export function renderScaleFor(
  messageCount: number,
  nodeFactor: number,
  threshold: number,
): number {
  if (!Number.isFinite(messageCount) || messageCount <= 0) return 0
  if (!Number.isFinite(nodeFactor) || nodeFactor <= 0) return 0
  if (!Number.isFinite(threshold) || threshold <= 0) return 0
  return Math.floor((messageCount * nodeFactor) / threshold) * threshold
}
