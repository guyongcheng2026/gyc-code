import { Schema } from "@gyccode/schema"

export class SecurityClassification extends Schema.Class<SecurityClassification>("SecurityClassification")({
  level: Schema.Literal("safe", "warning", "dangerous", "blocked"),
  patterns: Schema.Array(Schema.String),
  reason: Schema.String,
}) {}

export const DANGEROUS_PATTERNS = {
  commandSubstitution: /\$\(.*\)|`.*`/,
  processSubstitution: /<\(.*\)|>\(.*\)/,
  evalExec: /\beval\b|\bexec\b/,
  curlPipeBash: /curl.*\|.*(?:ba)?sh/,
  wgetPipeBash: /wget.*\|.*(?:ba)?sh/,
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

export function classifyCommand(command: string): SecurityClassification {
  const matched: string[] = []
  for (const [name, pattern] of Object.entries(DANGEROUS_PATTERNS)) {
    if (pattern.test(command)) {
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
