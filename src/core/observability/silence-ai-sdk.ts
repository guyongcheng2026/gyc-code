// ai-sdk 在加载时会向 stdout 打印告警（log-warnings.ts），污染 TUI 渲染输出。
// 此开关需在 ai-sdk 首次被 import 前设置，故以模块副作用形式提供，由进程最早
// 入口 import 一次即可（幂等，重复 import 无副作用）。
// 曾散落在 session/prompt.ts、server/server.ts、cli/tui/worker.ts 三处重复设置，
// 各自携带 @ts-ignore；现下沉到单一模块，消除重复与类型断言面。
// @ts-ignore This global is needed to prevent ai-sdk from logging warnings to stdout https://github.com/vercel/ai/blob/2dc67e0ef538307f21368db32d5a12345d98831b/packages/ai/src/logger/log-warnings.ts#L85
globalThis.AI_SDK_LOG_WARNINGS = false
