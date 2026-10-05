/**
 * fire-and-forget 调用收口：给「发起后不等待」的 promise 挂上拒绝处理，
 * 避免一次后台 RPC 失败直达进程级 unhandledRejection。
 *
 * 背景（2026-10-05 排查）：src/tui 下 19 处 `void sdk.client.*` 全部无 .catch，
 * 拒绝会走到 src/tui/app.tsx 的 onUnhandledRejection，进而 degradeToSafeModeAndExit
 * 关闭整个 TUI（用户丢失会话与草稿）。isRecoverableRejection
 * （src/tui/util/crash-classify.ts:13-24）只兜 6 类瞬时错误，服务端 5xx 与业务错误文案
 * 不在其中。
 */

export function settled(
  promise: Promise<unknown>,
  /** 日志 scope，用于定位来源 */
  scope: string,
  /** 拒绝时的回调；默认走 stderr，避免静默 */
  onError: (error: unknown, scope: string) => void = (error, s) => {
    console.error(`[${s}] 后台调用失败:`, error)
  },
): Promise<void> {
  // 不直接 return promise.catch(...)：那样成功分支会把原值透传出来，
  // 与 Promise<void> 的签名承诺不符（成功时应为 undefined）。显式丢弃返回值。
  return promise.then(
    () => undefined,
    (error: unknown) => {
      try {
        onError(error, scope)
      } catch {
        // 回调自身抛错不应让调用方再次变成未捕获拒绝
      }
    },
  )
}
