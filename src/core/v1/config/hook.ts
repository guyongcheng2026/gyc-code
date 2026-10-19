export * as ConfigHookV1 from "./hook"

import { Schema } from "effect"
import { PositiveInt } from "../../schema"

/**
 * 单个 Hook 的配置项。对标 Claude Code 的 settings.json `hooks` 条目：
 * - `event`：触发事件名（PreToolUse / PostToolUse / SessionStart 等）
 * - `command`：要执行的 shell 命令（hook 的 JSON 输入经 stdin 传入）
 * - `matcher`：可选正则，仅对工具名匹配的 Pre/PostToolUse 生效
 * - `timeout`：可选超时（毫秒），超过则终止 hook 进程
 *
 * event 这里用宽松的 `Schema.String` 而非枚举：hook 事件集合属于运行时
 * 语义（gyccode/hook 层维护），core 配置层只负责承载，不重复定义枚举，
 * 避免 core 与 gyccode 之间出现方向倒置的依赖。
 */
export const Hook = Schema.Struct({
  event: Schema.String,
  command: Schema.String,
  matcher: Schema.optional(Schema.String),
  timeout: Schema.optional(PositiveInt),
}).annotate({ identifier: "HookConfig" })

export const Info = Schema.mutable(Schema.Array(Hook)).annotate({ identifier: "HooksConfig" })
export type Info = Schema.Schema.Type<typeof Info>
