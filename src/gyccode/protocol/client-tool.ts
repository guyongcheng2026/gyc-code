import type { ToolDef } from "./conversation"

/** 客户端执行的工具：gyccode 侧仅下发工具定义，不提供 `execute`；
 * 执行结果由客户端通过 `tool-result` part 回传。 */
export interface ClientToolExecutor {
  readonly name: string
  /** 执行客户端工具，返回输出。失败时抛错，由上层转为 tool-error。 */
  execute: (args: unknown) => Promise<{
    readonly output: string
    readonly title?: string
    readonly metadata?: Record<string, unknown>
  }>
}

/** 客户端工具定义：标记 clientExecuted 并绑定执行器。 */
export interface ClientToolDef extends ToolDef {
  readonly clientExecuted: true
  readonly executor: ClientToolExecutor
}
