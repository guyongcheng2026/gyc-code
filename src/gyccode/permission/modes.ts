import { Schema } from "effect"

export const PermissionMode = Schema.Literals([
  "default",
  "acceptEdits",
  "bypassPermissions",
  "plan",
  // A-3（对标指标 22）：等价于 Claude Code 的 `--permission-prompts none`——
  // 未命中 allow 的请求一律按拒绝处理，不弹窗、不挂 Deferred、绝无限等待。
  // 与 `bypassPermissions` 的区别是方向相反：那个放行，这个拒绝。
  "dontAsk",
])
export type PermissionMode = typeof PermissionMode.Type

export const PermissionAction = Schema.Literals(["allow", "ask", "deny"])
export type PermissionAction = typeof PermissionAction.Type

/**
 * 危险等级。与 shell 工具的 `SecurityClassification.level` 同一套取值，
 * 这样两处裁决可以直接互换，不用各自维护一张映射表。
 */
export type DangerLevel = "safe" | "warning" | "dangerous" | "blocked"

/**
 * R-1（对标指标 22 · 权限与沙箱边界 · P0）
 *
 * 把「危险等级 × 权限模式」折成一条裁决。调用方（Permission.ask / shell 工具）
 * 必须真的走它——此前这个函数定义了却全仓无人 import，四种模式对安全性
 * 毫无影响，枚举写了没接线。
 *
 * 保守约定：
 * - `bypassPermissions` 不放过 `blocked`（rm -rf /、fork bomb、mkfs、/dev/tcp）。
 *   安全相关不做「用户说绕过就全绕过」。
 * - `plan` 一律 `deny`。**本函数只应被用于写/执行类权限**（见 `writeDangerLevel`），
 *   读权限不进模式裁决，否则 plan 模式下连文件都读不了。
 */
export function resolveAction(dangerLevel: DangerLevel, mode: PermissionMode): PermissionAction {
  if (mode === "bypassPermissions") return dangerLevel === "blocked" ? "deny" : "allow"
  // A-3：dontAsk 下不做任何自动放行/询问，只有命中 allow 的请求才通过。
  // 由调用方（ask）把「非 allow 一律 deny」落实为 DeniedError。
  if (mode === "dontAsk") return dangerLevel === "blocked" ? "deny" : "ask"
  if (mode === "plan") return "deny"
  if (dangerLevel === "blocked") return "deny"
  if (dangerLevel === "dangerous") return "ask"
  if (dangerLevel === "warning") return mode === "acceptEdits" ? "allow" : "ask"
  return "allow"
}

/**
 * 受权限模式约束的权限及其危险等级。未登记的权限返回 `undefined`，即
 * **不受模式裁决**——新增工具若忘了登记，宁可沿用既有 ruleset 行为，
 * 也不能因为漏登记就被误拒。
 *
 * - `edit` / `write`：落盘写操作。定为 `warning`，使 `acceptEdits` 能自动放行。
 * - `bash`：执行任意命令。定为 `dangerous`，任何模式下都需要显式放行。
 * - `read` / `grep` / `glob` / `list` 等读类权限刻意不登记：plan 模式必须仍能
 *   只读分析，否则「先看再决定」的工作流直接不可用。
 */
const WRITE_LEVELS = new Map<string, DangerLevel>([
  ["edit", "warning"],
  ["write", "warning"],
  ["bash", "dangerous"],
])

export function writeDangerLevel(permission: string): DangerLevel | undefined {
  return WRITE_LEVELS.get(permission)
}

/**
 * TUI 的 `--auto` / `--yolo` 开关 → 统一模式映射。此前 TUI 自成一套
 * `"auto" | "normal"`，与这里的四模式各说各话；映射集中在此处，TUI 不再
 * 自成平行类型。
 */
export function fromTuiAutoFlag(auto: boolean | undefined): PermissionMode {
  return auto ? "bypassPermissions" : "default"
}