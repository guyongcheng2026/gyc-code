/**
 * 崩溃分级：区分「可恢复的瞬时错误」与「真正的程序缺陷」。
 *
 * 背景（2026-08-28 排查）：TUI 主进程曾多次因以下可恢复错误触发
 * unhandledRejection 并降级/退出（表现为「运行几分钟后退回终端」）：
 *  - 服务端限流 429（“请求过于频繁，请稍后重试”，rate-limit.ts）；
 *  - SSE 流读取超时（SSE read timed out）；
 *  - model.json 原子写竞争 EPERM rename（persistence 已兜底，此处再防御）；
 *  - 瞬时网络失败（fetch failed / ECONNREFUSED / socket hang up）。
 * 这些错误不应杀死 TUI：记日志、继续运行；真正的代码缺陷才走崩溃降级。
 */

const RECOVERABLE_PATTERNS = [
  // 用户/框架取消
  /abort(?:ed|error)?/i,
  // 限流 429
  /请求过于频繁|too many requests|rate limit(?:ed| exceeded)|ratelimit/i,
  // SSE 流超时
  /sse read timed out|providerresponsestreamerror/i,
  // 原子写竞争（Windows rename 被占用或权限瞬态）
  /EPERM: operation not permitted, rename/i,
  // 瞬时网络失败
  /fetch failed|network request failed|ECONNREFUSED|ECONNRESET|ETIMEDOUT|socket hang up|ENOTFOUND|EAI_AGAIN/i,
] as const

/** 判断一个 rejection/异常是否属于「可恢复的瞬时错误」（应记录而非崩溃）。 */
export function isRecoverableRejection(reason: unknown): boolean {
  const message = reason instanceof Error ? `${reason.name ?? ""} ${reason.message}` : String(reason)
  return RECOVERABLE_PATTERNS.some((pattern) => pattern.test(message))
}
