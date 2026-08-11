import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import matter from "gray-matter"
import { Global } from "@gyccode/core/global"
import { FSUtil } from "@gyccode/core/fs-util"
import { InstallationLocal, InstallationVersion } from "@gyccode/core/installation/version"
import { ConfigMarkdown } from "@/config/markdown"
import { COMPOSE_BUNDLE } from "./bundle.gen"

// Compose skill bundle - the built-in compose:* skills that power the
// Compose mode workflow (Plan->TDD->Execute->Review->Debug->Verify->Merge).
//
// The bundle is compiled into bundle.gen.ts at build time and extracted to the
// global data directory on first run so the `skill` tool can read each skill's
// real files (SKILL.md + companion scripts).
//
// 提取目录按安装版本号版本化：升级后自动重新提取最新技能；
// 本地开发（local channel）每次启动强制重提取，保证改动即时生效。

export function composeRoot(): string {
  return path.join(Global.Path.data, "compose", InstallationVersion)
}

export interface ComposeSkillMeta {
  name: string
  description: string
  location: string
  content: string
}

function parseSkillBody(content: string) {
  const parse = (source: string) => {
    const parsed = matter(source)
    const name = parsed.data?.name
    const description = parsed.data?.description
    if (typeof name !== "string" || typeof description !== "string") return undefined
    return { name, description, content: parsed.content }
  }
  try {
    return parse(content)
  } catch {
    // 其他编码代理允许 frontmatter 中出现未加引号的冒号；
    // 先走宽松 sanitize 再解析，避免单个损坏 SKILL.md 导致整个块缺失。
    try {
      return parse(ConfigMarkdown.fallbackSanitization(content))
    } catch {
      return undefined
    }
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

  if (!InstallationLocal && (yield* fsys.existsSafe(marker))) return

  for (const [skillName, files] of Object.entries(COMPOSE_BUNDLE)) {
    const skillDir = path.join(root, "skills", skillName)
    for (const [relPath, content] of Object.entries(files)) {
      yield* fsys.writeWithDirs(path.join(skillDir, relPath), content)
    }
  }
  yield* fsys.writeWithDirs(marker, InstallationVersion)
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
