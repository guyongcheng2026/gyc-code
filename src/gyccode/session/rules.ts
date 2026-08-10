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

  // `language:`/`os:` are only honored inside an explicit `condition:` block.
  // Comment lines are stripped first so a commented `# language: en` elsewhere
  // in the frontmatter can't leak into the parsed condition.
  const fmNoComments = fm.replace(/^\s*#.*$/gm, "")
  const conditionMatch = fmNoComments.match(/^condition\s*:\s*$/m)
  let langMatch: RegExpMatchArray | null = null
  let osMatch: RegExpMatchArray | null = null
  if (conditionMatch) {
    const rest = fmNoComments.slice(conditionMatch.index! + conditionMatch[0].length)
    // The condition block ends at the next top-level (unindented) key.
    const block = rest.split(/\n(?=\S)/)[0] ?? rest
    langMatch = block.match(/language:\s*["']?([A-Za-z-]+)["']?/m)
    osMatch = block.match(/os:\s*["']?([A-Za-z0-9_-]+)["']?/m)
  }
  if (langMatch || osMatch) {
    condition = {
      ...(langMatch ? { language: normalizeLanguage(langMatch[1])! } : {}),
      ...(osMatch ? { os: osMatch[1]!.toLowerCase() } : {}),
    }
  }

  return { ...(globs ? { globs } : {}), ...(condition ? { condition } : {}), body: body.trim() }
}

/**
 * Canonicalize a language tag to its family so `zh` / `zh-CN` / `zh-Hans` /
 * `zh-TW` and `en` / `en-US` / `en-GB` all match the same rule condition.
 * Unknown tags are returned lowercased (exact-match only).
 */
function normalizeLanguage(lang: string | undefined): string | undefined {
  if (!lang) return undefined
  const l = lang.toLowerCase()
  if (l === "zh-cn" || l === "zh-hans" || l === "zh-sg" || l === "zh-tw" || l === "zh-hant") return "zh"
  if (l === "en-us" || l === "en-gb" || l === "en-au" || l === "en-ca") return "en"
  return l
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
  /**
   * Optional path relative to the project root (POSIX separators). Globs in
   * rule files follow Claude Code's convention and are relative to the project
   * root (e.g. a `src/**` glob), while the read tool hands `resolve()` an
   * absolute path. Matching against BOTH the normalized absolute path and the
   * relative path means the documented relative-glob convention actually fires
   * for real reads.
   */
  rel?: string
  language?: string
  os?: string
}

/** Rules whose globs and conditions all match the input. */
export function matchRules(rules: readonly Rule[], input: MatchInput): Rule[] {
  const lang = normalizeLanguage(input.language)
  const os = input.os?.toLowerCase()
  // Globs use `/` separators; normalize Windows separators so `src/**` + `/*.ts`
  // matches a real `C:\proj\src\app.ts` path too.
  const filepath = input.filepath.replace(/\\/g, "/")
  return rules.filter((rule) => {
    if (rule.globs && rule.globs.length > 0) {
      const hit = rule.globs.some(
        (g) => globToRegExp(g).test(filepath) || (input.rel ? globToRegExp(g).test(input.rel) : false),
      )
      if (!hit) return false
    }
    if (rule.condition?.language && normalizeLanguage(rule.condition.language) !== lang) return false
    if (rule.condition?.os && rule.condition.os !== os) return false
    return true
  })
}

/**
 * Load + parse rule files from the given directories (e.g. `.claude/rules`
 * and project `rules/`). Missing dirs yield no files; unreadable files and
 * frontmatter rules with an empty body are skipped.
 */
export async function loadRulesFromDirs(
  dirs: string[],
  readFile: (p: string) => Promise<string>,
  listMd: (dir: string) => Promise<string[]>,
): Promise<Rule[]> {
  const rules: Rule[] = []
  for (const dir of dirs) {
    const files = await listMd(dir).catch(() => [] as string[])
    for (const f of files) {
      const text = await readFile(f).catch(() => "")
      const parsed = parseRuleFrontmatter(text)
      if (parsed && parsed.body) {
        rules.push({ filepath: f, globs: parsed.globs, condition: parsed.condition, body: parsed.body })
      } else if (!parsed && text.trim()) {
        // No frontmatter: the whole non-empty text is the rule body.
        // A frontmatter-only file (empty body) is skipped entirely.
        rules.push({ filepath: f, body: text.trim() })
      }
    }
  }
  return rules
}
