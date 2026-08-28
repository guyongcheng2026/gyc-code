export * as Wildcard from "./wildcard"

const REGEX_SPECIAL = /[.+^${}()|[\]\\]/

export function match(input: string, pattern: string): boolean {
  const normalized = input.replaceAll("\\", "/")
  const rule = toRegex(pattern)
  return rule.test(normalized)
}

function toRegex(pattern: string): RegExp {
  const p = pattern
    .replaceAll("\\", "/")
    .replace(REGEX_SPECIAL, "\\$&")
    .replace(/\?/g, "\x01")
    .replace(/\*\*/g, "\x02")
    .replace(/\*/g, "\x03")

  const tokens: string[] = []
  let i = 0
  while (i < p.length) {
    const ch = p[i]
    if (ch === "\x01") {
      tokens.push("[^/]")
      i++
    } else if (ch === "\x02") {
      const next = p[i + 1]
      const prev = p[i - 1]
      if (next === "/") {
        tokens.push("(?:.*/)?")
        i += 2
      } else if (prev === "/") {
        if (i + 2 < p.length) {
          tokens.push(".*")
        } else {
          tokens.push("(?:/.*)?(?:.*)?")
        }
        i++
      } else if (i + 2 < p.length) {
        tokens.push(".*")
        i++
      } else {
        tokens.push(".*")
        i++
      }
    } else if (ch === "\x03") {
      tokens.push("[^/]*")
      i++
    } else {
      tokens.push(ch === "/" ? "/" : ch)
      i++
    }
  }

  return new RegExp("^" + tokens.join("") + "$", process.platform === "win32" ? "si" : "s")
}
