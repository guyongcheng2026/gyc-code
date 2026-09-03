#!/usr/bin/env bun
/**
 * Skill Marketplace CLI — 技能市场命令行工具
 * 用于发布、搜索、安装、更新技能
 */

import {
  publishSkill,
  searchSkills,
  installSkill,
  listSkills,
  checkForUpdates,
  resolveDependencies,
} from "../src/gyccode/skills/marketplace-client"
import { readdir, stat } from "fs/promises"
import path from "path"

const SKILLS_ROOT = path.join(process.cwd(), "src", "gyccode", "skills")

async function getSkillDirs(): Promise<string[]> {
  const dirs: string[] = []
  try {
    const entries = await readdir(SKILLS_ROOT, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const agentJsonPath = path.join(SKILLS_ROOT, entry.name, "agent.json")
        try {
          await stat(agentJsonPath)
          dirs.push(path.join(SKILLS_ROOT, entry.name))
        } catch {
          // 非技能目录
        }
      }
    }
  } catch {
    // 忽略
  }
  return dirs
}

function printUsage(): void {
  console.log(`
Skill Marketplace — gyc-code 技能市场

Usage:
  bun scripts/marketplace.ts <command> [options]

Commands:
  list                           列出市场中所有技能
  publish [skill-id]             发布技能到市场（不指定则发布全部）
  search <query>                 搜索技能
  install <skill-id>             安装技能
  check                          检查可用更新
  deps <skill-id>                解析技能依赖

Options:
  --category <category>          按类别过滤 (development|testing|documentation|analysis|refactoring|security|performance)
  --tags <tag1,tag2>             按标签过滤
  --status <status>              按状态过滤 (active|deprecated|archived|experimental)
  --version <version>            指定版本
  --force                        强制覆盖已安装的技能
  --limit <n>                    限制结果数量 (默认 20)

Examples:
  bun scripts/marketplace.ts list
  bun scripts/marketplace.ts publish
  bun scripts/marketplace.ts publish gyc-code-review
  bun scripts/marketplace.ts search code-review
  bun scripts/marketplace.ts search --category testing
  bun scripts/marketplace.ts install gyc-code-review --force
  bun scripts/marketplace.ts check
  bun scripts/marketplace.ts deps gyc-code-review
`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage()
    return
  }

  const command = args[0]

  // 解析通用选项
  const options: Record<string, string | boolean> = {}
  for (let i = 1; i < args.length; i++) {
    if (args[i] === "--force") {
      options.force = true
    } else if (args[i].startsWith("--") && i + 1 < args.length) {
      options[args[i].slice(2)] = args[++i]
    }
  }

  switch (command) {
    case "list": {
      const skills = await listSkills()
      if (skills.length === 0) {
        console.log("📭 市场中暂无技能")
        return
      }
      console.log(`\n📚 技能市场 (${skills.length} 个技能):\n`)
      for (const skill of skills) {
        const tags = skill.tags.length > 0 ? ` [${skill.tags.join(", ")}]` : ""
        const deps = skill.dependencies.length > 0 ? ` (依赖: ${skill.dependencies.join(", ")})` : ""
        console.log(`  ${skill.id} v${skill.version}`)
        console.log(`    ${skill.name} — ${skill.description || "无描述"}`)
        console.log(`    类别: ${skill.category} | 状态: ${skill.status}${tags}${deps}`)
        console.log()
      }
      break
    }

    case "publish": {
      const skillId = args[1] && !args[1].startsWith("--") ? args[1] : undefined
      const skillDirs = await getSkillDirs()
      console.log(`🔍 发现 ${skillDirs.length} 个技能目录\n`)

      let published = 0
      for (const dir of skillDirs) {
        if (skillId && !dir.includes(skillId)) continue
        const result = await publishSkill(dir)
        const icon = result.success ? "✅" : "❌"
        console.log(`${icon} ${path.basename(dir)}: ${result.message}`)
        if (result.success) published++
      }
      console.log(`\n📊 发布完成: ${published}/${skillDirs.length}`)
      break
    }

    case "search": {
      const query = args[1] && !args[1].startsWith("--") ? args[1] : ""
      if (!query) {
        console.error("❌ 请提供搜索关键词")
        return
      }

      const searchOptions: Parameters<typeof searchSkills>[1] = {}
      if (options.category) searchOptions.category = options.category as any
      if (options.tags) searchOptions.tags = (options.tags as string).split(",")
      if (options.status) searchOptions.status = options.status as any
      if (options.limit) searchOptions.limit = parseInt(options.limit as string, 10)

      const results = await searchSkills(query, searchOptions)
      if (results.length === 0) {
        console.log(`🔍 未找到匹配 "${query}" 的技能`)
        return
      }

      console.log(`\n🔍 搜索结果 (${results.length} 个):\n`)
      for (const result of results) {
        console.log(`  ${result.skill.id} v${result.skill.version} (score: ${result.score})`)
        console.log(`    ${result.skill.name} — ${result.skill.description || "无描述"}`)
        console.log(`    匹配原因: ${result.matchReason}`)
        console.log()
      }
      break
    }

    case "install": {
      const skillId = args[1]
      if (!skillId) {
        console.error("❌ 请提供技能 ID")
        return
      }

      console.log(`📦 安装技能: ${skillId}`)
      const result = await installSkill(skillId, {
        version: options.version as string,
        force: options.force as boolean,
      })

      if (result.success) {
        console.log(`✅ 安装成功: ${result.skillId} v${result.version}`)
        console.log(`   路径: ${result.installedPath}`)
        if (result.dependenciesInstalled.length > 0) {
          console.log(`   已安装依赖: ${result.dependenciesInstalled.join(", ")}`)
        }
        if (result.errors.length > 0) {
          console.log(`   ⚠️  警告: ${result.errors.join("; ")}`)
        }
      } else {
        console.log(`❌ 安装失败:`)
        for (const err of result.errors) {
          console.log(`   - ${err}`)
        }
      }
      break
    }

    case "check": {
      const diffs = await checkForUpdates()
      if (diffs.length === 0) {
        console.log("✅ 所有技能已是最新版本")
        return
      }

      console.log(`\n🔄 可用更新 (${diffs.length} 个):\n`)
      for (const diff of diffs) {
        const arrow = diff.isUpgradable ? "⬆️  可升级" : "⬇️  可降级"
        console.log(`  ${diff.skillId}: ${diff.currentVersion} → ${diff.latestVersion} (${arrow})`)
      }
      break
    }

    case "deps": {
      const skillId = args[1]
      if (!skillId) {
        console.error("❌ 请提供技能 ID")
        return
      }

      const { ordered, missing, circular } = await resolveDependencies([skillId])

      if (ordered.length > 0) {
        console.log(`\n📋 依赖加载顺序:`)
        ordered.forEach((id, i) => console.log(`  ${i + 1}. ${id}`))
      }
      if (missing.length > 0) {
        console.log(`\n❌ 缺失依赖:`)
        missing.forEach(id => console.log(`  - ${id}`))
      }
      if (circular.length > 0) {
        console.log(`\n⚠️  循环依赖:`)
        for (const cycle of circular) {
          console.log(`  - ${cycle.join(" → ")}`)
        }
      }
      break
    }

    default:
      console.error(`❌ 未知命令: ${command}`)
      printUsage()
  }
}

main().catch(console.error)
