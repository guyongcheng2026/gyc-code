#!/usr/bin/env bun
/**
 * Skill Archive Automation — 技能归档自动化脚本
 * 用于技能版本升级、废弃、重大重构时的自动归档
 * 保留演进历史，支持回溯和对比分析
 */

import { readFile, writeFile, mkdir, readdir, stat, cp, rm } from "fs/promises"
import path from "path"
import { homedir } from "os"
import { AgentJson, validateAgentJson } from "../src/gyccode/skills/agent-schema"

const SKILLS_ROOT = path.join(process.cwd(), "src", "gyccode", "skills")
const ARCHIVE_ROOT = path.join(process.cwd(), "skills_archived")

interface ArchiveOptions {
  skillId?: string
  reason: "version-upgrade" | "deprecated" | "major-refactor" | "manual"
  version?: string
  dryRun?: boolean
  verbose?: boolean
}

interface ArchiveResult {
  skillId: string
  archivedPath: string
  version: string
  timestamp: string
  reason: string
  filesArchived: number
  sizeBytes: number
}

function formatTimestamp(): string {
  const now = new Date()
  return now.toISOString().replace(/[:.]/g, "-").slice(0, 19)
}

async function getSkillDirs(): Promise<string[]> {
  try {
    const entries = await readdir(SKILLS_ROOT, { withFileTypes: true })
    return entries
      .filter(e => e.isDirectory())
      .map(e => path.join(SKILLS_ROOT, e.name))
  } catch {
    return []
  }
}

async function readSkillManifest(skillDir: string): Promise<AgentJson | null> {
  try {
    const manifestPath = path.join(skillDir, "agent.json")
    const content = await readFile(manifestPath, "utf-8")
    return validateAgentJson(JSON.parse(content))
  } catch {
    return null
  }
}

async function getDirSize(dir: string): Promise<number> {
  let size = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        size += await getDirSize(fullPath)
      } else {
        const stats = await stat(fullPath)
        size += stats.size
      }
    }
  } catch {
    // 忽略错误
  }
  return size
}

async function countFiles(dir: string): Promise<number> {
  let count = 0
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name)
      if (entry.isDirectory()) {
        count += await countFiles(fullPath)
      } else {
        count++
      }
    }
  } catch {
    // 忽略错误
  }
  return count
}

async function archiveSkill(
  skillDir: string,
  options: ArchiveOptions
): Promise<ArchiveResult | null> {
  const manifest = await readSkillManifest(skillDir)
  if (!manifest) {
    console.warn(`⚠️  Skipping ${skillDir}: no valid agent.json`)
    return null
  }

  if (options.skillId && manifest.id !== options.skillId) {
    return null
  }

  const skillName = path.basename(skillDir)
  const timestamp = formatTimestamp()
  const version = options.version || manifest.version
  const archiveName = `${timestamp}-${skillName}-v${version}-${options.reason}`
  const archivePath = path.join(ARCHIVE_ROOT, archiveName)

  const filesCount = await countFiles(skillDir)
  const sizeBytes = await getDirSize(skillDir)

  if (options.dryRun) {
    console.log(`🔍 [DRY RUN] Would archive: ${skillName} (${manifest.id})`)
    console.log(`   Archive path: ${archivePath}`)
    console.log(`   Files: ${filesCount}, Size: ${(sizeBytes / 1024).toFixed(1)} KB`)
    console.log(`   Reason: ${options.reason}`)
    return null
  }

  // 创建归档目录
  await mkdir(archivePath, { recursive: true })

  // 复制技能目录
  await cp(skillDir, archivePath, { recursive: true })

  // 创建归档元数据
  const metadata = {
    originalPath: skillDir,
    skillId: manifest.id,
    skillName: manifest.name,
    version: manifest.version,
    archivedVersion: version,
    archivedAt: new Date().toISOString(),
    reason: options.reason,
    filesCount,
    sizeBytes,
    originalManifest: manifest,
  }

  await writeFile(
    path.join(archivePath, "archive-meta.json"),
    JSON.stringify(metadata, null, 2)
  )

  // 创建归档说明文档
  const readme = `# Archived Skill: ${manifest.name}

**Skill ID**: ${manifest.id}  
**Original Version**: ${manifest.version}  
**Archived Version**: ${version}  
**Archived At**: ${new Date().toISOString()}  
**Reason**: ${options.reason}  
**Files Archived**: ${filesCount}  
**Size**: ${(sizeBytes / 1024).toFixed(1)} KB

## Original Manifest
\`\`\`json
${JSON.stringify(manifest, null, 2)}
\`\`\`

## Archive Contents
This archive contains the complete skill directory structure at the time of archiving.
`

  await writeFile(path.join(archivePath, "ARCHIVE_README.md"), readme)

  console.log(`✅ Archived: ${manifest.name} (${manifest.id})`)
  console.log(`   → ${archivePath}`)
  console.log(`   Files: ${filesCount}, Size: ${(sizeBytes / 1024).toFixed(1)} KB`)

  return {
    skillId: manifest.id,
    archivedPath: archivePath,
    version,
    timestamp,
    reason: options.reason,
    filesArchived: filesCount,
    sizeBytes,
  }
}

async function listArchives(): Promise<void> {
  try {
    const entries = await readdir(ARCHIVE_ROOT, { withFileTypes: true })
    const archives = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse()

    if (archives.length === 0) {
      console.log("📭 No archives found")
      return
    }

    console.log(`\n📚 Archived Skills (${archives.length}):\n`)
    for (const archive of archives) {
      const metaPath = path.join(ARCHIVE_ROOT, archive, "archive-meta.json")
      try {
        const meta = JSON.parse(await readFile(metaPath, "utf-8"))
        const date = new Date(meta.archivedAt).toLocaleString()
        console.log(`  ${archive}`)
        console.log(`    Skill: ${meta.skillName} (${meta.skillId})`)
        console.log(`    Version: ${meta.archivedVersion} (from ${meta.version})`)
        console.log(`    Date: ${date}`)
        console.log(`    Reason: ${meta.reason}`)
        console.log(`    Files: ${meta.filesCount}, Size: ${(meta.sizeBytes / 1024).toFixed(1)} KB`)
        console.log()
      } catch {
        console.log(`  ${archive} (metadata corrupted)`)
      }
    }
  } catch {
    console.log("📭 Archive directory not found")
  }
}

async function restoreSkill(archiveName: string, targetDir?: string): Promise<void> {
  const archivePath = path.join(ARCHIVE_ROOT, archiveName)
  const metaPath = path.join(archivePath, "archive-meta.json")

  try {
    const meta = JSON.parse(await readFile(metaPath, "utf-8"))
    const restorePath = targetDir || path.join(SKILLS_ROOT, meta.skillName)

    console.log(`🔄 Restoring ${meta.skillName} to ${restorePath}`)
    await cp(archivePath, restorePath, { recursive: true })
    console.log(`✅ Restored successfully`)
  } catch (error) {
    console.error(`❌ Restore failed: ${error}`)
  }
}

async function compareArchives(archive1: string, archive2: string): Promise<void> {
  const path1 = path.join(ARCHIVE_ROOT, archive1)
  const path2 = path.join(ARCHIVE_ROOT, archive2)

  try {
    const [meta1, meta2] = await Promise.all([
      readFile(path.join(path1, "archive-meta.json"), "utf-8").then(JSON.parse),
      readFile(path.join(path2, "archive-meta.json"), "utf-8").then(JSON.parse),
    ])

    console.log(`\n🔍 Comparing Archives:\n`)
    console.log(`  ${archive1} (${meta1.archivedAt})`)
    console.log(`  ${archive2} (${meta2.archivedAt})\n`)

    console.log(`  Skill: ${meta1.skillName} (${meta1.skillId})`)
    console.log(`  Version: ${meta1.archivedVersion} → ${meta2.archivedVersion}`)
    console.log(`  Reason: ${meta1.reason} → ${meta2.reason}`)
    console.log(`  Files: ${meta1.filesCount} → ${meta2.filesCount}`)
    console.log(`  Size: ${(meta1.sizeBytes / 1024).toFixed(1)} KB → ${(meta2.sizeBytes / 1024).toFixed(1)} KB`)

    // 比较文件列表
    const [files1, files2] = await Promise.all([
      getFileList(path1),
      getFileList(path2),
    ])

    const set1 = new Set(files1)
    const set2 = new Set(files2)

    const added = [...set2].filter(f => !set1.has(f))
    const removed = [...set1].filter(f => !set2.has(f))
    const common = [...set1].filter(f => set2.has(f))

    if (added.length > 0) {
      console.log(`\n  ➕ Added files (${added.length}):`)
      for (const f of added.slice(0, 10)) console.log(`    + ${f}`)
      if (added.length > 10) console.log(`    ... and ${added.length - 10} more`)
    }

    if (removed.length > 0) {
      console.log(`\n  ➖ Removed files (${removed.length}):`)
      for (const f of removed.slice(0, 10)) console.log(`    - ${f}`)
      if (removed.length > 10) console.log(`    ... and ${removed.length - 10} more`)
    }

    if (common.length > 0) {
      console.log(`\n  ➡️  Common files: ${common.length}`)
    }
  } catch (error) {
    console.error(`❌ Comparison failed: ${error}`)
  }
}

async function getFileList(dir: string, prefix = ""): Promise<string[]> {
  const files: string[] = []
  try {
    const entries = await readdir(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === "archive-meta.json" || entry.name === "ARCHIVE_README.md") continue
      const fullPath = path.join(dir, entry.name)
      const relPath = prefix + entry.name
      if (entry.isDirectory()) {
        files.push(...(await getFileList(fullPath, relPath + "/")))
      } else {
        files.push(relPath)
      }
    }
  } catch {
    // 忽略
  }
  return files
}

async function cleanupOldArchives(keepCount = 10): Promise<void> {
  try {
    const entries = await readdir(ARCHIVE_ROOT, { withFileTypes: true })
    const archives = entries
      .filter(e => e.isDirectory())
      .map(e => e.name)
      .sort()
      .reverse()

    if (archives.length <= keepCount) {
      console.log(`📦 Only ${archives.length} archives, nothing to clean up (keep: ${keepCount})`)
      return
    }

    const toDelete = archives.slice(keepCount)
    console.log(`🗑️  Cleaning up ${toDelete.length} old archives (keeping latest ${keepCount})`)

    for (const archive of toDelete) {
      const archivePath = path.join(ARCHIVE_ROOT, archive)
      await rm(archivePath, { recursive: true, force: true })
      console.log(`   Deleted: ${archive}`)
    }
  } catch (error) {
    console.error(`❌ Cleanup failed: ${error}`)
  }
}

function printUsage(): void {
  console.log(`
Skill Archive Automation

Usage:
  bun scripts/archive-skills.ts <command> [options]

Commands:
  archive [skill-id]     Archive a skill (or all skills if no ID specified)
  list                   List all archived skills
  restore <archive-name> Restore an archived skill
  compare <a1> <a2>      Compare two archives
  cleanup [keep-count]   Remove old archives (default keep: 10)

Options:
  --reason <reason>      Archive reason: version-upgrade | deprecated | major-refactor | manual
  --version <version>    Override version for archive
  --dry-run              Preview what would be archived
  --verbose              Verbose output
  --target <path>        Target directory for restore

Examples:
  bun scripts/archive-skills.ts archive gyc-code-review --reason version-upgrade --version 1.1.0
  bun scripts/archive-skills.ts archive --reason major-refactor --dry-run
  bun scripts/archive-skills.ts list
  bun scripts/archive-skills.ts restore 2026-09-02T10-30-00-code-review-v1.0.0-version-upgrade
  bun scripts/archive-skills.ts compare archive1 archive2
  bun scripts/archive-skills.ts cleanup 5
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage()
    return
  }

  const command = args[0]
  const options: ArchiveOptions = {
    reason: "manual",
    dryRun: false,
    verbose: false,
  }

  // 解析选项
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--reason" && i + 1 < args.length) {
      options.reason = args[++i] as ArchiveOptions["reason"]
    } else if (args[i] === "--version" && i + 1 < args.length) {
      options.version = args[++i]
    } else if (args[i] === "--dry-run") {
      options.dryRun = true
    } else if (args[i] === "--verbose") {
      options.verbose = true
    }
  }

  // 确保归档目录存在
  await mkdir(ARCHIVE_ROOT, { recursive: true })

  switch (command) {
    case "archive": {
      const skillId = args[1] && !args[1].startsWith("--") ? args[1] : undefined
      if (skillId) options.skillId = skillId

      const skillDirs = await getSkillDirs()
      console.log(`🔍 Found ${skillDirs.length} skill(s) to process`)

      const results: ArchiveResult[] = []
      for (const skillDir of skillDirs) {
        const result = await archiveSkill(skillDir, options)
        if (result) results.push(result)
      }

      if (results.length > 0) {
        console.log(`\n📊 Summary: ${results.length} skill(s) archived`)
        const totalFiles = results.reduce((sum, r) => sum + r.filesArchived, 0)
        const totalSize = results.reduce((sum, r) => sum + r.sizeBytes, 0)
        console.log(`   Total files: ${totalFiles}`)
        console.log(`   Total size: ${(totalSize / 1024).toFixed(1)} KB`)
      } else if (!options.dryRun) {
        console.log("ℹ️  No skills archived")
      }
      break
    }

    case "list":
      await listArchives()
      break

    case "restore": {
      const archiveName = args[1]
      if (!archiveName) {
        console.error("❌ Archive name required for restore")
        return
      }
      const targetDir = args.find((a, i) => args[i - 1] === "--target") ? args[args.indexOf("--target") + 1] : undefined
      await restoreSkill(archiveName, targetDir)
      break
    }

    case "compare": {
      const a1 = args[1]
      const a2 = args[2]
      if (!a1 || !a2) {
        console.error("❌ Two archive names required for compare")
        return
      }
      await compareArchives(a1, a2)
      break
    }

    case "cleanup": {
      const keepCount = args[1] ? parseInt(args[1], 10) : 10
      await cleanupOldArchives(keepCount)
      break
    }

    default:
      console.error(`❌ Unknown command: ${command}`)
      printUsage()
  }
}

main().catch(console.error)