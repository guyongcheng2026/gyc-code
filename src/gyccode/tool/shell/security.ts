import { Schema } from "effect"
import { resolveAction, type PermissionMode } from "@/permission/modes"

export class SecurityClassification extends Schema.Class<SecurityClassification>("SecurityClassification")({
  level: Schema.Literals(["safe", "warning", "dangerous", "blocked"]),
  patterns: Schema.Array(Schema.String),
  reason: Schema.String,
}) {}

export const DANGEROUS_PATTERNS = {
  commandSubstitution: /\$\([\s\S]*\)|`[\s\S]*`/,
  processSubstitution: /<\([\s\S]*\)|>\([\s\S]*\)/,
  evalExec: /\beval\b|\bexec\b/,
  curlPipeBash: /curl[\s\S]*\|[\s\S]*(?:ba)?sh/,
  wgetPipeBash: /wget[\s\S]*\|[\s\S]*(?:ba)?sh/,
  devTcp: /\/dev\/tcp/,
  rmRfRoot: /rm\s+-rf\s+\/(?:\s|$)/,
  chmod777: /chmod\s+777/,
  sudo: /\bsudo\b/,
  redirectAppend: />>\s*\/etc\/|>>\s*\/sys\//,
  ddIf: /\bdd\s+if=/,
  mkfs: /\bmkfs\b/,
  forkBomb: /:\(\)\s*\{/,
  exportEnv: /\bexport\s+\w+=/,
} as const

/**
 * Strip backslash escapes outside single quotes so heuristics see what the
 * shell will actually run: `e\val` -> `eval`, `c\u\r\l | b\ash` -> `curl | bash`.
 * Inside single quotes a backslash is literal (no escaping), so those spans
 * are left untouched.
 */
function deescape(command: string): string {
  let out = ""
  let inSingle = false
  for (let i = 0; i < command.length; i++) {
    const ch = command[i]
    if (ch === "'") {
      inSingle = !inSingle
      out += ch
      continue
    }
    if (ch === "\\" && !inSingle && i + 1 < command.length) {
      out += command[i + 1]
      i++
      continue
    }
    out += ch
  }
  return out
}

export function classifyCommand(command: string): SecurityClassification {
  // Match against both the raw command and its de-escaped form so shell
  // escaping cannot bypass the blocked/dangerous heuristics.
  const candidates = [command, deescape(command)]
  const matched: string[] = []
  for (const [name, pattern] of Object.entries(DANGEROUS_PATTERNS)) {
    if (candidates.some((c) => pattern.test(c))) {
      matched.push(name)
    }
  }
  if (matched.length === 0) {
    return new SecurityClassification({ level: "safe", patterns: [], reason: "No dangerous patterns detected" })
  }
  const hasBlocked = matched.some(p => ["rmRfRoot", "forkBomb", "devTcp", "mkfs"].includes(p))
  if (hasBlocked) {
    return new SecurityClassification({ level: "blocked", patterns: matched, reason: `Blocked patterns: ${matched.join(", ")}` })
  }
  const hasDangerous = matched.some(p => ["evalExec", "curlPipeBash", "wgetPipeBash", "sudo", "ddIf"].includes(p))
  if (hasDangerous) {
    return new SecurityClassification({ level: "dangerous", patterns: matched, reason: `Dangerous patterns: ${matched.join(", ")}` })
  }
  return new SecurityClassification({ level: "warning", patterns: matched, reason: `Suspicious patterns: ${matched.join(", ")}` })
}

export type ShellSafetyVerdict =
  | { readonly run: true }
  | { readonly run: false; readonly kind: "shell_blocked" | "shell_dangerous"; readonly text: string }

/**
 * R-1（对标指标 22 · 权限与沙箱边界 · P0）
 *
 * 把「命令分类」与「当前权限模式」合成一条放行裁决。此前危险命令分支完全不看
 * 权限模式，`default / acceptEdits / bypassPermissions / plan` 四种模式对 shell
 * 安全性毫无影响。
 *
 * 裁决矩阵（保守侧）：
 * - `blocked`（rm -rf /、fork bomb、mkfs、/dev/tcp）：**任何模式都不放行**，
 *   连 `bypassPermissions` 也不放——安全相关不做「用户说绕过就全绕过」，
 *   `allowDangerous` 对它无效。
 * - `dangerous`（eval、curl|bash、sudo、dd）：仅 `bypassPermissions` 直通；
 *   其余模式维持既有「必须显式 `allowDangerous`」的默认拒绝语义。
 * - `warning` / `safe`：不进本裁决，保持既有「不拦」行为。plan 模式因此仍能
 *   只读探查（ls / git status），只禁写与执行类命令。
 */
export function decideShellSafety(input: {
  classification: SecurityClassification
  mode: PermissionMode
  allowDangerous?: boolean
}): ShellSafetyVerdict {
  const { classification, mode, allowDangerous } = input
  if (classification.level !== "blocked" && classification.level !== "dangerous") return { run: true }

  const action = resolveAction(classification.level, mode)
  // plan 模式下 resolveAction 一律 deny，allowDangerous 也不放行。
  const allowed = action === "allow" || (action === "ask" && allowDangerous === true)
  if (allowed) return { run: true }

  const kind = classification.level === "blocked" ? "shell_blocked" : "shell_dangerous"
  return { run: false, kind, text: shellSafetyError({ classification, mode, kind }) }
}

/**
 * 拒绝时的模型可见回灌。此前这里是 `Effect.die`，属进程级 defect：模型看不到
 * 任何原因，既不知道命令被拒，也不知道下一轮该怎么改。格式对齐
 * `tool.ts` 里参数校验失败的 `<tool_error>` 约定。
 */
function shellSafetyError(input: {
  classification: SecurityClassification
  mode: PermissionMode
  kind: "shell_blocked" | "shell_dangerous"
}): string {
  const { classification, mode, kind } = input
  const lines = [
    `<tool_error kind="${kind}" tool="bash">`,
    kind === "shell_blocked"
      ? `命令被安全策略硬拒绝：${classification.reason}`
      : `命令被判为危险且未获显式放行：${classification.reason}`,
    `命中的模式：${classification.patterns.join(", ") || "（无）"}`,
    `当前权限模式：${mode}`,
    kind === "shell_blocked"
      ? "blocked 级命令在任何权限模式下都不会放行，请改写命令：删掉破坏性部分，只保留确实需要的部分。"
      : "若确实需要执行，请在下一次调用中显式设置 allowDangerous=true（该参数仅对 dangerous 级生效，blocked 级无效）。",
    "本轮未执行任何操作。",
    `</tool_error>`,
  ]
  return lines.join("\n")
}
