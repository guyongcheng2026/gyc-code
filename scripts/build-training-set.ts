#!/usr/bin/env bun
/**
 * Training Set Builder CLI — 训练集构建命令行工具
 * 从任务日志中提取成功模式，构建训练数据集
 */

import {
  buildTrainingDataset,
  exportToJsonl,
  exportToJson,
  readTaskLogs,
  computeQualityScore,
} from "../src/gyccode/memory/training-pipeline"
import path from "path"
import { homedir } from "os"
import { mkdir, writeFile } from "fs/promises"

const MEMORY_ROOT = path.join(
  process.env.GYCCODE_MEMORY_HOME || process.env.HERMES_HOME || path.join(homedir(), ".gyc"),
  "memory"
)

function printUsage(): void {
  console.log(`
Training Set Builder — gyc-code 训练数据飞轮

Usage:
  bun scripts/build-training-set.ts <command> [options]

Commands:
  build                          构建训练集 (JSONL + JSON)
  stats                          查看训练集统计
  sample [n]                     查看样本 (默认 5)
  create-sample-log              创建示例任务日志文件
  filter <category>              按类别过滤查看

Options:
  --min-quality <score>          最小质量分数 (默认 60)
  --max-samples <n>              最大样本数 (默认 10000)
  --categories <c1,c2>           类别过滤
  --output <path>                输出路径
  --log-dir <path>               任务日志目录

Categories:
  code-generation    代码生成
  review             代码审查
  debugging          调试修复
  documentation      文档生成
  refactoring        重构
  testing            测试
  other              其他

Examples:
  bun scripts/build-training-set.ts build
  bun scripts/build-training-set.ts build --min-quality 80 --categories code-generation,testing
  bun scripts/build-training-set.ts stats
  bun scripts/build-training-set.ts sample 10
  bun scripts/build-training-set.ts create-sample-log
  bun scripts/build-training-set.ts filter debugging
`)
}

function parseArgs(args: string[]): Record<string, string | boolean> {
  const options: Record<string, string | boolean> = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--min-quality" && i + 1 < args.length) {
      options.minQuality = args[++i]
    } else if (args[i] === "--max-samples" && i + 1 < args.length) {
      options.maxSamples = args[++i]
    } else if (args[i] === "--categories" && i + 1 < args.length) {
      options.categories = args[++i]
    } else if (args[i] === "--output" && i + 1 < args.length) {
      options.output = args[++i]
    } else if (args[i] === "--log-dir" && i + 1 < args.length) {
      options.logDir = args[++i]
    }
  }
  return options
}

async function createSampleLog(): Promise<void> {
  const logDir = path.join(MEMORY_ROOT, "task-logs")
  await mkdir(logDir, { recursive: true })

  const sampleEntries = [
    {
      ts: new Date(Date.now() - 3600000).toISOString(),
      category: "code-generation",
      input: "为 User 实体生成 CRUD 接口，包含 Flask 路由、SQLite 模型、JWT 认证",
      output: "from flask import Blueprint, jsonify, request\nfrom flask_jwt_extended import jwt_required\n\nuser_bp = Blueprint('users', __name__)\n\n@user_bp.route('/api/users', methods=['GET'])\n@jwt_required()\ndef get_users():\n    users = User.query.all()\n    return jsonify({'code': 200, 'msg': '成功', 'data': [u.to_dict() for u in users]})",
      success: true,
      durationMs: 3200,
      skillUsed: "gyc-code-review",
      tags: ["flask", "crud", "jwt"],
      qualityScore: 85,
    },
    {
      ts: new Date(Date.now() - 7200000).toISOString(),
      category: "review",
      input: "审查这段代码的安全性和性能问题",
      output: "发现 3 个问题：1) SQL 注入风险 2) 缺少输入验证 3) N+1 查询",
      success: true,
      durationMs: 5100,
      skillUsed: "gyc-code-review",
      tags: ["security", "performance"],
      qualityScore: 78,
    },
    {
      ts: new Date(Date.now() - 10800000).toISOString(),
      category: "debugging",
      input: "修复登录接口 401 错误",
      output: "问题是 JWT token 过期时间配置错误，已修复为 24 小时",
      success: true,
      durationMs: 8500,
      tags: ["jwt", "auth"],
      qualityScore: 72,
    },
    {
      ts: new Date(Date.now() - 14400000).toISOString(),
      category: "documentation",
      input: "为 API 接口生成 OpenAPI 文档",
      output: "# User API\n\n## GET /api/users\n获取用户列表\n\n## POST /api/users\n创建新用户",
      success: true,
      durationMs: 2100,
      tags: ["openapi", "docs"],
      qualityScore: 80,
    },
    {
      ts: new Date(Date.now() - 18000000).toISOString(),
      category: "testing",
      input: "为 UserService 生成单元测试",
      output: "import pytest\nfrom services.user import UserService\n\ndef test_create_user():\n    service = UserService()\n    user = service.create({'name': 'test', 'email': 'test@example.com'})\n    assert user.name == 'test'",
      success: true,
      durationMs: 4300,
      tags: ["pytest", "unit-test"],
      qualityScore: 88,
    },
    {
      ts: new Date(Date.now() - 21600000).toISOString(),
      category: "refactoring",
      input: "重构数据库访问层，提取 Repository 模式",
      output: "class UserRepository:\n    def __init__(self, db):\n        self.db = db\n    def find_by_id(self, id):\n        return self.db.query(User).filter_by(id=id).first()",
      success: true,
      durationMs: 12000,
      tags: ["repository", "refactor"],
      qualityScore: 82,
    },
    {
      ts: new Date(Date.now() - 25200000).toISOString(),
      category: "code-generation",
      input: "生成 Vue3 + Element Plus 的用户管理页面",
      output: "<template>\n  <el-table :data=\"users\">\n    <el-table-column prop=\"name\" label=\"姓名\" />\n    <el-table-column prop=\"email\" label=\"邮箱\" />\n  </el-table>\n</template>",
      success: true,
      durationMs: 6700,
      skillUsed: "gyc-code-review",
      tags: ["vue3", "element-plus", "frontend"],
      qualityScore: 76,
    },
  ]

  const logPath = path.join(logDir, "sample-tasks.jsonl")
  await writeFile(logPath, sampleEntries.map(e => JSON.stringify(e)).join("\n") + "\n")
  console.log(`✅ 示例日志已创建: ${logPath}`)
  console.log(`   包含 ${sampleEntries.length} 条示例任务记录`)
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)

  if (args.length === 0 || args[0] === "--help" || args[0] === "-h") {
    printUsage()
    return
  }

  const command = args[0]
  const options = parseArgs(args.slice(1))

  switch (command) {
    case "build": {
      const config: Parameters<typeof buildTrainingDataset>[0] = {}
      if (options.minQuality) config.minQualityScore = parseInt(options.minQuality as string, 10)
      if (options.maxSamples) config.maxSamples = parseInt(options.maxSamples as string, 10)
      if (options.categories) config.categories = (options.categories as string).split(",") as any
      if (options.logDir) config.taskLogDir = options.logDir as string
      if (options.output) config.outputPath = options.output as string

      console.log("🔨 正在构建训练集...\n")
      const dataset = await buildTrainingDataset(config)

      const jsonlPath = config.outputPath || path.join(MEMORY_ROOT, "training-set.jsonl")
      const jsonPath = jsonlPath.replace(/\.jsonl$/, ".json")

      await exportToJsonl(dataset, jsonlPath)
      await exportToJson(dataset, jsonPath)

      console.log("📊 构建完成:")
      console.log(`   样本数: ${dataset.stats.totalSamples}`)
      console.log(`   平均质量: ${dataset.stats.avgQualityScore}/100`)
      console.log(`   类别分布:`)
      for (const [cat, count] of Object.entries(dataset.stats.categoryDistribution)) {
        console.log(`     ${cat}: ${count}`)
      }
      console.log(`\n📁 输出文件:`)
      console.log(`   JSONL: ${jsonlPath}`)
      console.log(`   JSON:  ${jsonPath}`)
      break
    }

    case "stats": {
      const dataset = await buildTrainingDataset({ maxSamples: Number.MAX_SAFE_INTEGER })
      console.log("\n📊 训练集统计:\n")
      console.log(`  总样本数: ${dataset.stats.totalSamples}`)
      console.log(`  成功任务: ${dataset.stats.successfulTasks}`)
      console.log(`  平均质量: ${dataset.stats.avgQualityScore}/100`)
      console.log(`  平均输入长度: ${dataset.stats.avgInputLength} 字符`)
      console.log(`  平均输出长度: ${dataset.stats.avgOutputLength} 字符`)
      console.log(`\n  类别分布:`)
      for (const [cat, count] of Object.entries(dataset.stats.categoryDistribution)) {
        console.log(`    ${cat}: ${count}`)
      }
      const topTags = Object.entries(dataset.stats.tagFrequency)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
      if (topTags.length > 0) {
        console.log(`\n  热门标签:`)
        for (const [tag, count] of topTags) {
          console.log(`    ${tag}: ${count}`)
        }
      }
      break
    }

    case "sample": {
      const n = args[1] ? parseInt(args[1], 10) : 5
      const dataset = await buildTrainingDataset({ maxSamples: n })
      console.log(`\n📋 前 ${Math.min(n, dataset.samples.length)} 个样本:\n`)
      for (const sample of dataset.samples.slice(0, n)) {
        console.log(`  [${sample.category}] ${sample.id}`)
        console.log(`    输入: ${sample.input.slice(0, 80)}${sample.input.length > 80 ? "..." : ""}`)
        console.log(`    输出: ${sample.output.slice(0, 80)}${sample.output.length > 80 ? "..." : ""}`)
        console.log(`    质量: ${sample.qualityScore} | 标签: ${sample.tags.join(", ") || "无"}`)
        console.log()
      }
      break
    }

    case "create-sample-log": {
      await createSampleLog()
      break
    }

    case "filter": {
      const category = args[1]
      if (!category) {
        console.error("❌ 请提供类别名称")
        return
      }
      const dataset = await buildTrainingDataset({
        categories: [category as any],
        maxSamples: 50,
      })
      console.log(`\n🔍 类别 "${category}" 的样本 (${dataset.samples.length} 个):\n`)
      for (const sample of dataset.samples.slice(0, 20)) {
        console.log(`  ${sample.id}: ${sample.input.slice(0, 60)}...`)
        console.log(`    质量: ${sample.qualityScore} | 标签: ${sample.tags.join(", ") || "无"}`)
      }
      break
    }

    default:
      console.error(`❌ 未知命令: ${command}`)
      printUsage()
  }
}

main().catch(console.error)
