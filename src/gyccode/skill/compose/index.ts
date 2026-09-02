import path from "path"
import { pathToFileURL } from "url"
import { Effect } from "effect"
import matter from "gray-matter"
import { Global } from "@gyccode/core/global"
import { Hash } from "@gyccode/core/util/hash"
import { FSUtil } from "@gyccode/core/fs-util"
import { InstallationVersion } from "@gyccode/core/installation/version"
import { InstallationLocal } from "@gyccode/core/installation/version"
import { ConfigMarkdown } from "@/config/markdown"

type ComposeBundle = Record<string, Record<string, string>>

/** Safe bundle loader with fallback for macro/import failures. */
function safeLoadComposeBundle(): ComposeBundle {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require("./bundle.gen")
    return (mod.COMPOSE_BUNDLE ?? mod.default?.COMPOSE_BUNDLE ?? {}) as ComposeBundle
  } catch (cause) {
    console.warn("[compose] Failed to load COMPOSE_BUNDLE, falling back to empty bundle:", cause)
    return {}
  }
}

const COMPOSE_BUNDLE = safeLoadComposeBundle()

// Compose skill bundle - the built-in compose:* skills that power the
// Compose mode workflow (Plan->TDD->Execute->Review->Debug->Verify->Merge).
//
// The bundle is compiled into bundle.gen.ts at build time and extracted to the
// global data directory on first run so the `skill` tool can read each skill's
// real files (SKILL.md + companion scripts).
//
// 提取目录按安装版本号版本化：升级后自动重新提取最新技能；
// marker 记录 bundle 内容指纹：bundle 有改动（含本地开发修改）才重新提取，
// 未变更的启动零磁盘写入。

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

  // 内容指纹：bundle 变化（含版本升级、本地开发改动）才重新解压。
  // 此前 local 渠道每次启动都全量重写全部文件，白耗磁盘 IO 并拖慢每次启动。
  // 本地开发模式（InstallationLocal）下强制重提取，方便快速迭代。
  if (InstallationLocal) {
    const existing = yield* fsys.existsSafe(marker)
    if (existing) yield* fsys.remove(marker)
  }
  let fingerprint = InstallationVersion
  for (const [skillName, files] of Object.entries(COMPOSE_BUNDLE)) {
    fingerprint += `\0${skillName}`
    for (const [relPath, content] of Object.entries(files)) {
      fingerprint += `\0${relPath}\0${Hash.fast(content)}`
    }
  }
  if (yield* fsys.existsSafe(marker)) {
    const existing = yield* fsys.readFileStringSafe(marker).pipe(Effect.orElseSucceed(() => undefined))
    if (existing === fingerprint) return
  }

  for (const [skillName, files] of Object.entries(COMPOSE_BUNDLE)) {
    const skillDir = path.join(root, "skills", skillName)
    for (const [relPath, content] of Object.entries(files)) {
      yield* fsys.writeWithDirs(path.join(skillDir, relPath), content)
    }
  }
  yield* fsys.writeWithDirs(marker, fingerprint)
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
