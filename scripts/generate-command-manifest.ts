// 命令清单生成脚本
// 从 TUI (app.tsx) 和 CLI (default.ts) 提取命令规格，生成统一的 command-manifest.json
// 运行：bun scripts/generate-command-manifest.ts

import { readFileSync, writeFileSync } from "fs"
import { join } from "path"

const ROOT = join(__dirname, "..")

interface CommandSpec {
  name: string
  aliases?: string[]
  description: string
  category: "system" | "session" | "agent" | "model" | "workspace" | "plugin" | "debug" | "config" | "cli-only"
  tuiOnly?: boolean
  hidden?: boolean
  // 执行器类型：内置 / 动态(服务端) / 子命令
  executor: "builtin" | "dynamic" | "subcommand"
  // 所需上下文
  requiresSession?: boolean
  requiresProject?: boolean
}

function extractTuiCommands(): CommandSpec[] {
  const appTsx = readFileSync(join(ROOT, "src/tui/app.tsx"), "utf-8")
  const specs: CommandSpec[] = []

  // 从 appCommands + appGlobalBindingCommands 提取
  // 使用正则匹配命令定义
  const commandRegex = /name:\s*"([^"]+)"[\s\S]*?title:\s*"([^"]+)"[\s\S]*?category:\s*"([^"]+)"[\s\S]*?run:\s*\(\)\s*=>\s*\{[\s\S]*?\}/g
  let match
  while ((match = commandRegex.exec(appTsx)) !== null) {
    const [, name, title, category] = match
    specs.push({
      name: name.replace(/^(command\.palette\.|session\.|model\.|agent\.|mcp\.|variant\.|provider\.|console\.|theme\.|gyccode\.|help\.|diff\.|workspace\.|app\.|terminal\.|gyccode\.)/, ""),
      description: title,
      category: mapCategory(category),
      executor: "builtin",
      tuiOnly: false,
    })
  }

  // 补充 TUI 独有命令
  const tuiOnlyCommands = [
    { name: "variants", description: "切换模型变体", category: "model" as const },
    { name: "agents", description: "Agent 列表", category: "agent" as const },
    { name: "workspaces", description: "工作区列表", category: "workspace" as const },
    { name: "mcps", description: "MCP 服务器管理", category: "plugin" as const },
    { name: "connect", description: "连接服务商", category: "system" as const },
    { name: "debug", description: "调试信息", category: "debug" as const },
    { name: "themes", description: "主题切换", category: "config" as const },
    { name: "doctor", description: "环境体检", category: "debug" as const },
    { name: "config", description: "配置查看/编辑", category: "config" as const },
    { name: "usage", description: "用量统计", category: "config" as const },
    { name: "vim", description: "Vim 键绑定开关", category: "config" as const },
    { name: "login", description: "登录", category: "system" as const },
    { name: "logout", description: "登出", category: "system" as const },
    { name: "renderer", description: "选择渲染器（opentui / fallback）", category: "config" as const },
    { name: "hooks", description: "钩子管理", category: "config" as const },
    { name: "commit", description: "提交变更", category: "session" as const },
    { name: "memory", description: "记忆管理", category: "config" as const },
    { name: "upgrade", description: "升级引导", category: "system" as const },
    { name: "release-notes", aliases: ["changelog"], description: "更新日志", category: "system" as const },
    { name: "feedback", description: "反馈提交", category: "system" as const },
    { name: "share", description: "分享会话", category: "session" as const },
    { name: "unshare", description: "取消分享", category: "session" as const },
    { name: "rename", description: "重命名会话", category: "session" as const },
    { name: "timeline", description: "跳转到消息", category: "session" as const },
    { name: "fork", description: "分叉会话", category: "session" as const },
    { name: "undo", description: "撤回上一轮", category: "session" as const },
    { name: "redo", description: "恢复撤回", category: "session" as const },
    { name: "rewind", description: "回退到历史某点", category: "session" as const },
    { name: "plan", description: "计划模式", category: "session" as const },
    { name: "timestamps", description: "时间戳显示开关", category: "config" as const },
    { name: "export", description: "导出会话记录", category: "session" as const },
    { name: "add-dir", description: "添加工作目录", category: "workspace" as const },
    { name: "output-style", description: "输出风格选择", category: "config" as const },
    { name: "keybindings", description: "键绑定列表", category: "config" as const },
    { name: "security-review", description: "安全审查", category: "debug" as const },
    { name: "ultraplan", description: "超级计划", category: "session" as const },
    { name: "bughunter", description: "Bug 猎手", category: "debug" as const },
    { name: "insights", description: "改进洞察", category: "debug" as const },
    { name: "advisor", description: "顾问建议", category: "debug" as const },
  ]

  for (const cmd of tuiOnlyCommands) {
    specs.push({ ...cmd, tuiOnly: true, executor: "builtin" })
  }

  return specs
}

function extractCliCommands(): CommandSpec[] {
  const defaultTs = readFileSync(join(ROOT, "src/gyccode/cli/cmd/default.ts"), "utf-8")
  const specs: CommandSpec[] = []

  // 从 SLASH_SPECS 提取
  const specRegex = /\{\s*name:\s*"([^"]+)"[\s\S]*?desc:\s*"([^"]+)"[\s\S]*?tuiOnly:\s*(true|false)?/g
  let match
  while ((match = specRegex.exec(defaultTs)) !== null) {
    const [, name, desc, tuiOnly] = match
    const aliasesMatch = /aliases:\s*\[([^\]]+)\]/.exec(defaultTs.slice(match.index, match.index + 500))
    const aliases = aliasesMatch ? aliasesMatch[1].split(",").map(s => s.trim().replace(/"/g, "")) : []
    specs.push({
      name,
      aliases: aliases.length > 0 ? aliases : undefined,
      description: desc,
      category: inferCategory(name),
      tuiOnly: tuiOnly === "true",
      executor: "builtin",
      requiresSession: !["help", "exit", "quit", "q", "new", "clear", "sessions", "continue", "resume", "env"].includes(name),
    })
  }

  // CLI 专属命令
  const cliOnly = [
    { name: "branch", description: "分支当前会话并切换", category: "session" as const },
    { name: "editor", description: "外部编辑器编写消息", category: "session" as const },
    { name: "subagents", description: "查看最近子代理状态", category: "session" as const },
  ]
  for (const cmd of cliOnly) {
    specs.push({ ...cmd, category: "cli-only", executor: "builtin" })
  }

  return specs
}

function mapCategory(cat: string): CommandSpec["category"] {
  const map: Record<string, CommandSpec["category"]> = {
    "系统": "system",
    "会话": "session",
    "代理": "agent",
    "服务商": "system",
    "工作区": "workspace",
  }
  return map[cat] || "system"
}

function inferCategory(name: string): CommandSpec["category"] {
  if (["model", "models", "variant", "variants"].includes(name)) return "model"
  if (["agent", "agents"].includes(name)) return "agent"
  if (["session", "sessions", "continue", "resume", "compact", "fork", "branch", "rename", "share", "unshare", "timeline", "undo", "redo", "rewind", "plan", "cost", "context", "copy", "export", "permissions", "subagents"].includes(name)) return "session"
  if (["workspace", "workspaces", "add-dir"].includes(name)) return "workspace"
  if (["mcp", "mcps", "connect"].includes(name)) return "plugin"
  if (["debug", "doctor", "security-review", "bughunter", "insights", "advisor"].includes(name)) return "debug"
  if (["theme", "themes", "config", "usage", "vim", "hooks", "commit", "memory", "upgrade", "release-notes", "changelog", "feedback", "keybindings", "output-style", "timestamps", "thinking"].includes(name)) return "config"
  if (["help", "exit", "quit", "q", "new", "clear", "env", "status"].includes(name)) return "system"
  return "system"
}

function mergeSpecs(tui: CommandSpec[], cli: CommandSpec[]): CommandSpec[] {
  const map = new Map<string, CommandSpec>()

  for (const spec of [...tui, ...cli]) {
    const key = spec.name
    const existing = map.get(key)
    if (!existing) {
      map.set(key, spec)
    } else {
      // 合并：CLI 优先（更完整），但保留 TUI-only 标记
      map.set(key, {
        ...existing,
        ...spec,
        aliases: [...new Set([...(existing.aliases || []), ...(spec.aliases || [])])],
        tuiOnly: existing.tuiOnly || spec.tuiOnly,
      })
    }
  }

  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name))
}

function main() {
  console.log("🔍 提取 TUI 命令...")
  const tuiSpecs = extractTuiCommands()
  console.log(`   找到 ${tuiSpecs.length} 个 TUI 命令`)

  console.log("🔍 提取 CLI 命令...")
  const cliSpecs = extractCliCommands()
  console.log(`   找到 ${cliSpecs.length} 个 CLI 命令`)

  console.log("🔀 合并去重...")
  const merged = mergeSpecs(tuiSpecs, cliSpecs)
  console.log(`   合并后 ${merged.length} 个唯一命令`)

  // 生成清单
  const manifest = {
    version: "1.0",
    generatedAt: new Date().toISOString(),
    commands: merged,
    // 快速查找索引
    byName: Object.fromEntries(merged.map(c => [c.name, c])),
    byAlias: Object.fromEntries(
      merged.flatMap(c => (c.aliases || []).map(a => [a, c.name]))
    ),
    byCategory: Object.fromEntries(
      (["system", "session", "agent", "model", "workspace", "plugin", "debug", "config", "cli-only"] as const).map(cat => [
        cat,
        merged.filter(c => c.category === cat).map(c => c.name)
      ])
    ),
  }

  const outPath = join(ROOT, "src/gyccode/cli/core/command-manifest.json")
  writeFileSync(outPath, JSON.stringify(manifest, null, 2))
  console.log(`✅ 写入 ${outPath}`)

  // 同时生成 TypeScript 类型定义
  const tsDef = `// 自动生成，勿手动编辑
// 生成时间: ${manifest.generatedAt}

export interface CommandManifest {
  version: string
  generatedAt: string
  commands: CommandSpec[]
  byName: Record<string, CommandSpec>
  byAlias: Record<string, string>
  byCategory: Record<CommandCategory, string[]>
}

export type CommandCategory = "system" | "session" | "agent" | "model" | "workspace" | "plugin" | "debug" | "config" | "cli-only"

export interface CommandSpec {
  name: string
  aliases?: string[]
  description: string
  category: CommandCategory
  tuiOnly?: boolean
  hidden?: boolean
  executor: "builtin" | "dynamic" | "subcommand"
  requiresSession?: boolean
  requiresProject?: boolean
}

export const commandManifest: CommandManifest = ${JSON.stringify(manifest, null, 2)}
`

  const tsOutPath = join(ROOT, "src/gyccode/cli/core/command-manifest.ts")
  writeFileSync(tsOutPath, tsDef)
  console.log(`✅ 写入 ${tsOutPath}`)

  // 统计
  const byCat = Object.fromEntries(
    (["system", "session", "agent", "model", "workspace", "plugin", "debug", "config", "cli-only"] as const).map(cat => [
      cat,
      merged.filter(c => c.category === cat).length
    ])
  )
  console.log("\n📊 分类统计:")
  for (const [cat, count] of Object.entries(byCat)) {
    console.log(`   ${cat}: ${count}`)
  }
  const tuiOnlyCount = merged.filter(c => c.tuiOnly).length
  console.log(`   TUI-only: ${tuiOnlyCount}`)
}

main()