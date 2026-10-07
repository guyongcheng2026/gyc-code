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

/**
 * unhandledRejection 是否应当终止进程。
 *
 * 为什么不让各处直接 `if (isRecoverableRejection(...))`：TUI 主进程
 * （src/tui/app.tsx:511-521）与 worker（src/cli/tui/worker.ts:44-50）都持有
 * 生命周期敏感的资源，其中 worker 还直接托管 HTTP server
 * （src/cli/tui/worker.ts:186）。一旦因可恢复错误退出，服务端随之消失，
 * TUI 的每个 HTTP 调用都会失败，表现为「发送提示词失败」
 * （src/tui/component/prompt/index.tsx:1192）。把判定收敛成一处并配测试，
 * 防止任一侧悄悄退回「一律退出」。
 */
export function shouldExitOnUnhandledRejection(reason: unknown): boolean {
  return !isRecoverableRejection(reason)
}
