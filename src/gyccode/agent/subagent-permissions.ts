import { PermissionV1 } from "@gyccode/core/v1/permission"
import type { Agent } from "./agent"

/**
 * 判断规则集是否具备某类权限：按匹配顺序取最后一条匹配规则
 * （显式同名规则或通配 * 规则），非 deny 即视为具备。
 * 通配 allow（如 general 的默认 "*": "allow"）同样算数，
 * 避免误判为无权限而注入全量 deny 导致子代理空转。
 */
function permits(ruleset: PermissionV1.Ruleset, permission: string): boolean {
  const rule = ruleset.findLast((item) => item.permission === permission || item.permission === "*")
  return rule !== undefined && rule.action !== "deny"
}

/**
 * Build the `permission` ruleset for a subagent's session when it's spawned
 * via the task tool. Combines:
 *
 * 1. The parent session's deny rules and external_directory rules.
 *    Parent agent restrictions only govern that agent; the subagent's own
 *    permissions determine its capabilities.
 * 2. Default `todowrite` and `task` denies if the subagent's own ruleset
 *    doesn't already permit them.
 */
export function deriveSubagentSessionPermission(input: {
  parentSessionPermission: PermissionV1.Ruleset
  subagent: Agent.Info
}): PermissionV1.Ruleset {
  const canTask = permits(input.subagent.permission, "task")
  const canTodo = permits(input.subagent.permission, "todowrite")
  return [
    ...input.parentSessionPermission.filter(
      (rule) => rule.permission === "external_directory" || rule.action === "deny",
    ),
    ...(canTodo ? [] : [{ permission: "todowrite" as const, pattern: "*" as const, action: "deny" as const }]),
    ...(canTask ? [] : [{ permission: "task" as const, pattern: "*" as const, action: "deny" as const }]),
  ]
}