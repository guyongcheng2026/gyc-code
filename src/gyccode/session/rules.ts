/**
 * Conditional rule files (`.claude/rules/*.md`, project `rules/`). A rule is a
 * markdown file with optional YAML frontmatter:
 *
 *   ---
 *   globs: ["src/**", "docs/*.md"] # file-path patterns the rule applies to
 *   condition:                     # optional additional conditions
 *     language: zh                 # zh | en
 *     os: win32                    # win32 | darwin | linux
 *   ---
 *
 * A rule with no frontmatter applies everywhere. Matched rules are injected
 * into the system prompt and, for a concrete file, nearby its read/edit
 * context — beyond Claude Code's system-level-only globs rules.
 */

export interface Rule {
  filepath: string
  globs?: string[]
  condition?: { language?: string; os?: string }
  body: string
}

/** Extract YAML frontmatter fields we care about. Minimal parser, no deps. */
export function parseRuleFrontmatter(
  content: string,
): { globs?: string[]; condition?: { language?: string; os?: string }; body: string } | undefined {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/)
  if (!m) return undefined
  const fm = m[1]!
  const body = content.slice(m[0].length)
  let globs: string[] | undefined
  let condition: { language?: string; os?: string } | undefined

  // globs: ["a/**", "b/**"]  |  globs: "single"
  const globsMatch = fm.match(/globs:\s*(\[[\s\S]*?\]|"[^"]*"|'[^']*')/m)
  if (globsMatch) {
    const raw = globsMatch[1]!
    if (raw.startsWith("[")) {
      globs = (raw.match(/["']([^"']+)["']/g) ?? []).map((s) => s.replace(/["']/g, ""))
    } else {
      globs = [raw.replace(/["']/g, "")]
    }
  } else {
    const listMatch = fm.match(/globs:\s*\n((?:\s*-\s*["']?[^"'\n]+["']?\n)+)/m)
    if (listMatch) {
      globs = (listMatch[1]!.match(/-\s*["']?([^"'\n]+)["']?/g) ?? []).map((s) =>
        s.replace(/^-\s*["']?|["']?$/g, ""),
      )
    }
  }

  const langMatch = fm.match(/language:\s*["']?([A-Za-z-]+)["']?/m)
  const osMatch = fm.match(/os:\s*["']?([A-Za-z0-9_-]+)["']?/m)
  if (langMatch || osMatch) {
    condition = {
      ...(langMatch ? { language: langMatch[1]!.toLowerCase() } : {}),
      ...(osMatch ? { os: osMatch[1]!.toLowerCase() } : {}),
    }
  }

  return { ...(globs ? { globs } : {}), ...(condition ? { condition } : {}), body: body.trim() }
}

/**
 * Minimal glob-to-regex (supports `**`, `*`, `?`). A `**` followed by a slash
 * matches zero or more directories, so a glob like `src/**` combined with
 * `/*.ts` hits both `src/app.ts` and `src/a/b/c.ts`.
 */
export function globToRegExp(glob: string): RegExp {
  let out = ""
  let i = 0
  while (i < glob.length) {
    const ch = glob[i]!
    if (ch === "*") {
      if (glob[i + 1] === "*") {
        i += 2
        if (glob[i] === "/") {
          out += "(?:[^/]*/)*"
          i += 1
        } else {
          out += ".*"
        }
      } else {
        out += "[^/]*"
        i += 1
      }
    } else if (ch === "?") {
      out += "[^/]"
      i += 1
    } else {
      out += ch.replace(/[.+^${}()|[\]\\]/g, "\\$&")
      i += 1
    }
  }
  return new RegExp(`^${out}$`)
}

export interface MatchInput {
  filepath: string
  language?: string
  os?: string
}

/** Rules whose globs and conditions all match the input. */
export function matchRules(rules: readonly Rule[], input: MatchInput): Rule[] {
  const lang = input.language?.toLowerCase()
  const os = input.os?.toLowerCase()
  // Globs use `/` separators; normalize Windows separators so `src/**` + `/*.ts`
  // matches a real `C:\proj\src\app.ts` path too.
  const filepath = input.filepath.replace(/\\/g, "/")
  return rules.filter((rule) => {
    if (rule.globs && rule.globs.length > 0) {
      const hit = rule.globs.some((g) => globToRegExp(g).test(filepath))
      if (!hit) return false
    }
    if (rule.condition?.language && rule.condition.language !== lang) return false
    if (rule.condition?.os && rule.condition.os !== os) return false
    return true
  })
}