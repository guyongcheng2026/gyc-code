import { Effect, Exit } from "effect"

/**
 * Magic Docs: files whose first line is `# MAGIC DOC: <title>` are auto-maintained
 * documentation. When such a file is read, it is registered; when the session
 * goes idle, a background agent refreshes the doc so it stays in sync with the
 * codebase (aligned with reference agent's MagicDocs). The doc philosophy is: write
 * WHY / architecture / entry points, not line-by-line code.
 */

export const MAGIC_DOC_HEADER = "# MAGIC DOC"

const HEADER_RE = /^#\s*MAGIC\s+DOC:\s*(.+?)\s*$/im

/** Extract the doc title from a file's content, or undefined if not a magic doc. */
export function detectMagicDocTitle(content: string): string | undefined {
  const match = content.match(HEADER_RE)
  return match?.[1]?.trim() || undefined
}

/** True when the content starts with a MAGIC DOC header. */
export function isMagicDocFile(content: string): boolean {
  return detectMagicDocTitle(content) !== undefined
}

/** Build the prompt a background agent uses to refresh a magic doc. */
export function buildMagicDocUpdatePrompt(title: string, currentContent: string): string {
  return [
    `You are maintaining the project documentation file "# MAGIC DOC: ${title}".`,
    "Keep it in sync with the current state of the codebase.",
    "",
    "Documentation philosophy:",
    "- Write WHY, architecture, entry points, and key data flows.",
    "- Do NOT reproduce line-by-line code or full file listings.",
    "- Keep it accurate and current; remove stale details, add what changed.",
    "- Do not mention that this update is automated.",
    "",
    "Current document content:",
    "```",
    currentContent.slice(0, 20_000),
    "```",
    "",
    "Reply with the full updated document (the `# MAGIC DOC: ...` header must stay).",
  ].join("\n")
}

/** In-memory registry of magic doc files seen this session (path -> title). */
const magicDocRegistry = new Map<string, string>()

/** Register a file as a magic doc when its content has a MAGIC DOC header. */
export function maybeRegisterMagicDoc(filepath: string, content: string): boolean {
  const title = detectMagicDocTitle(content)
  if (!title) return false
  magicDocRegistry.set(filepath, title)
  return true
}

/** All registered magic docs (path -> title). */
export function registeredMagicDocs(): ReadonlyMap<string, string> {
  return magicDocRegistry
}

/** Reset the registry (used by tests / session teardown). */
export function resetMagicDocRegistry(): void {
  magicDocRegistry.clear()
}

/** Injected: refresh one magic doc file and persist the new content. */
export type MagicDocUpdater = (
  filepath: string,
  title: string,
  currentContent: string,
) => Effect.Effect<string>

/**
 * Refresh every registered magic doc via the injected updater. Returns the
 * list of successfully updated file paths. Failures are logged and skipped.
 */
export function updateRegisteredMagicDocs(updater: MagicDocUpdater): Effect.Effect<string[]> {
  return Effect.gen(function* () {
    const docs = Array.from(magicDocRegistry.entries())
    if (docs.length === 0) return []
    const results: string[] = []
    for (const [filepath, title] of docs) {
      const current = yield* Effect.promise(async () => {
        try {
          const { readFile } = await import("fs/promises")
          return await readFile(filepath, "utf-8")
        } catch {
          return ""
        }
      })
      const outcome = yield* Effect.exit(updater(filepath, title, current))
      if (Exit.isSuccess(outcome)) results.push(filepath)
    }
    return results
  })
}
