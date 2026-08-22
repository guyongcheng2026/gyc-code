import { Schema } from "effect"

export const PermissionMode = Schema.Literals(["default", "acceptEdits", "bypassPermissions", "plan"])
export type PermissionMode = typeof PermissionMode.Type

export const PermissionAction = Schema.Literals(["allow", "ask", "deny"])
export type PermissionAction = typeof PermissionAction.Type

export function resolveAction(
  dangerLevel: "safe" | "warning" | "dangerous" | "blocked",
  mode: PermissionMode,
): PermissionAction {
  if (mode === "bypassPermissions") return "allow"
  if (mode === "plan") return dangerLevel === "blocked" ? "deny" : "deny"
  if (dangerLevel === "blocked") return "deny"
  if (dangerLevel === "dangerous") return "ask"
  if (dangerLevel === "warning") return mode === "acceptEdits" ? "allow" : "ask"
  return "allow"
}
