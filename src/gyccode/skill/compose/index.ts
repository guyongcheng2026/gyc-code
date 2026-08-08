import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import matter from "gray-matter"
import { Global } from "@gyccode/core/global"
import { FSUtil } from "@gyccode/core/fs-util"
import { COMPOSE_BUNDLE } from "./bundle.gen"

// Compose skill bundle - the built-in compose:* skills that power the
// Compose mode workflow (Plan->TDD->Execute->Review->Debug->Verify->Merge).
//
// The bundle is compiled into bundle.gen.ts at build time and extracted to the
// global data directory on first run so the `skill` tool can read each skill's
// real files (SKILL.md + companion scripts).

export const ComposeBundleVersion = "1"

export function composeRoot(): string {
  return path.join(Global.Path.data, "compose", ComposeBundleVersion)
}

export interface ComposeSkillMeta {
  name: string
  description: string
  location: string
  content: string
}

function parseSkillBody(content: string) {
  try {
    const parsed = matter(content)
    const name = parsed.data?.name
    const description = parsed.data?.description
    if (typeof name !== "string" || typeof description !== "string") return undefined
    return { name, description, content: parsed.content }
  } catch {
    return undefined
  }
}

/** Extract the composed skill bundle to disk once (guarded by a marker file). */
export const extractComposeSkills = Effect.fn("Skill.compose.extract")(function* (
  fsys: FSUtil.Interface,
  enable: boolean,
) {
  if (!enable) return
  const root = composeRoot()
  const marker = path.join(root, ".extracted")

  if (yield* fsys.existsSafe(marker)) return

  for (const [skillName, files] of Object.entries(COMPOSE_BUNDLE)) {
    const skillDir = path.join(root, "skills", skillName)
    for (const [relPath, content] of Object.entries(files)) {
      yield* fsys.writeWithDirs(path.join(skillDir, relPath), content)
    }
  }
  yield* fsys.writeWithDirs(marker, ComposeBundleVersion)
})

/** `<compose_skills>` block listing compose-only skills, for prompt injection. */
export function composeSkillsBlock(): string {
  const root = composeRoot()
  const entries: string[] = []
  for (const [skillName, files] of Object.entries(COMPOSE_BUNDLE)) {
    const skillMd = files["SKILL.md"]
    if (!skillMd) continue
    const parsed = parseSkillBody(skillMd)
    if (!parsed) continue
    const location = pathToFileURL(path.join(root, "skills", skillName, "SKILL.md")).href
    entries.push(
      `  <skill>`,
      `    <name>${parsed.name}</name>`,
      `    <description>${parsed.description}</description>`,
      `    <location>${location}</location>`,
      `  </skill>`,
    )
  }
  if (entries.length === 0) return ""
  return ["<compose_skills>", ...entries, "</compose_skills>"].join("\n")
}

export * as ComposeSkill from "."