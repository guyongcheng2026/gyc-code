import { Schema } from "effect"

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
