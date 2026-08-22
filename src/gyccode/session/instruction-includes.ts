/**
 * `@include` reference resolution for instruction files (AGENTS.md / CLAUDE.md
 * / CONTEXT.md). Aligned with reference agent's claudemd.ts `extractIncludePaths`
 * + `processConditionedMdRules`: an instruction file may reference others with
 * `@path` / `@./path` / `@~/path` / `@/path`, which are recursively loaded so
 * shared guidance can live in one place. References are bounded to prevent
 * cycles and only text files are allowed (binaries never enter context).
 */

export const MAX_INCLUDE_DEPTH = 5

/** Text file extensions that may be pulled in via `@include`. */
export const TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  "txt", "md", "markdown", "ts", "tsx", "js", "jsx", "mjs", "cjs", "mts", "cts",
  "py", "rb", "go", "rs", "java", "kt", "kts", "scala", "c", "h", "cc", "cpp",
  "hpp", "cs", "swift", "sh", "bash", "zsh", "fish", "ps1", "sql", "graphql",
  "gql", "vue", "svelte", "php", "lua", "ex", "exs", "erl", "hrl", "hs",
  "ml", "mli", "fs", "fsx", "clj", "cljs", "edn", "toml", "yaml", "yml",
  "json", "jsonc", "ini", "cfg", "conf", "env", "gitignore", "dockerfile",
  "html", "css", "scss", "less", "xml", "tex", "r", "jl", "dart", "nim",
  "zig", "asm", "s", "proto", "cmake", "makefile", "mk", "nix", "tf", "hcl",
  "typ", "styl", "astro", "sass", "bat", "cmd", "tsv", "csv", "diff", "patch",
])

// `@path` / `@./path` / `@../path` / `@~/path` / `@/path` references.
// Excludes `@user` mentions (no dot / slash / extension) and bare words.
const INCLUDE_RE = /@((?:\.{0,2}\/|~\/|\/)?[A-Za-z0-9_./-]+\.(?:md|markdown|txt|ts|tsx|js|jsx|py|go|rs|json|yaml|yml|toml|sh|bash|ps1|sql|html|css|c|cpp|h|hpp|java|kt|rb|php|vue|svelte|scss|less|xml|tex|r|jl|dart|zig|nix|tf|hcl|typ|astro|diff|patch))/g

/** Resolve `@include` references from an instruction file's text. */
export function resolveIncludes(content: string): string[] {
  const refs: string[] = []
  for (const match of content.matchAll(INCLUDE_RE)) {
    const ref = match[1]
    if (!ref) continue
    // Exclude @mentions that happen to look like paths (require a dot in the basename).
    const base = ref.split(/[\\/]/).pop() ?? ref
    if (!base.includes(".")) continue
    // Normalize a leading "./" so @./docs/rules.md resolves like @docs/rules.md.
    refs.push(ref.startsWith("./") ? ref.slice(2) : ref)
  }
  return refs
}

