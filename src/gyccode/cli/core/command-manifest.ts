// 自动生成，勿手动编辑
// 生成时间: 2026-08-29T04:42:32.893Z

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

export const commandManifest: CommandManifest = {
  "version": "1.0",
  "generatedAt": "2026-08-29T04:42:32.893Z",
  "commands": [
    {
      "name": "add-dir",
      "description": "添加工作目录",
      "category": "workspace",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "advisor",
      "description": "顾问建议",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "agents",
      "description": "Agent 列表",
      "category": "agent",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "branch",
      "description": "分支当前会话并切换",
      "category": "cli-only",
      "executor": "builtin"
    },
    {
      "name": "bughunter",
      "description": "Bug 猎手",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "commit",
      "description": "提交变更",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    {
      "name": "compact",
      "aliases": [
        "summary"
      ],
      "description": "压缩当前会话上下文",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    {
      "name": "config",
      "description": "配置查看/编辑",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "connect",
      "description": "连接服务商",
      "category": "plugin",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "console",
      "description": "切换控制台",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "copy_path",
      "description": "复制工作树路径",
      "category": "workspace",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "cost",
      "description": "显示 token 用量与成本",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    {
      "name": "cycle",
      "description": "循环切换变体",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false,
      "aliases": []
    },
    {
      "name": "cycle_favorite",
      "description": "循环切换收藏",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "cycle_favorite_reverse",
      "description": "反序循环切换收藏",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "cycle_recent",
      "description": "循环切换模型",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "cycle_recent_reverse",
      "description": "反序循环切换模型",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "cycle.reverse",
      "description": "反序循环切换代理",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "debug",
      "description": "调试信息",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "doctor",
      "description": "环境体检",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "editor",
      "description": "外部编辑器编写消息",
      "category": "cli-only",
      "executor": "builtin"
    },
    {
      "name": "env",
      "description": "显示环境信息",
      "category": "system",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": false
    },
    {
      "name": "export",
      "description": "导出会话记录",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "feedback",
      "description": "反馈提交",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "summary"
      ],
      "requiresSession": true
    },
    {
      "name": "fork",
      "description": "分叉会话",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "heap_snapshot",
      "description": "写入堆快照",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "help",
      "aliases": [
        "quit",
        "q"
      ],
      "description": "显示帮助",
      "category": "system",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": false
    },
    {
      "name": "hooks",
      "description": "钩子管理",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    {
      "name": "insights",
      "description": "改进洞察",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "keybindings",
      "description": "键绑定列表",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "list",
      "description": "切换模型变体",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false,
      "aliases": []
    },
    {
      "name": "login",
      "description": "登录",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    {
      "name": "logout",
      "description": "登出",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    {
      "name": "mcps",
      "description": "MCP 服务器管理",
      "category": "plugin",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "memory",
      "description": "记忆管理",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    {
      "name": "mode.lock",
      "description": "帮助",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "model",
      "description": "查看/切换模型",
      "category": "model",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    {
      "name": "new",
      "description": "新建会话",
      "category": "session",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "output-style",
      "description": "输出风格选择",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "permissions",
      "description": "显示当前会话权限规则",
      "category": "session",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "plan",
      "description": "计划模式",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "redo",
      "description": "恢复撤回",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "release_notes",
      "description": "更新日志",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "release-notes",
      "aliases": [
        "changelog"
      ],
      "description": "更新日志",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    {
      "name": "rename",
      "description": "重命名会话",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "renderer",
      "description": "选择渲染器（opentui / fallback）",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "renderer.select",
      "description": "选择渲染器（opentui / fallback）",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "rewind",
      "description": "回退到历史某点",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "security-review",
      "description": "安全审查",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "share",
      "description": "分享会话",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "status",
      "description": "显示版本/模型/会话/目录信息",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "subagents",
      "description": "查看最近子代理状态",
      "category": "cli-only",
      "executor": "builtin"
    },
    {
      "name": "switch",
      "description": "切换主题",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "themes",
      "description": "主题切换",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "thinking",
      "description": "思考块显示开关",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    {
      "name": "timeline",
      "description": "跳转到消息",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "timestamps",
      "description": "时间戳显示开关",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "title.toggle",
      "description": "环境诊断",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    {
      "name": "ultraplan",
      "description": "超级计划",
      "category": "system",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "undo",
      "description": "撤回上一轮",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "unshare",
      "description": "取消分享",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "upgrade",
      "description": "升级引导",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "changelog"
      ],
      "requiresSession": true
    },
    {
      "name": "usage",
      "description": "用量统计",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    {
      "name": "variants",
      "description": "切换模型变体",
      "category": "model",
      "tuiOnly": true,
      "executor": "builtin"
    },
    {
      "name": "vim",
      "description": "Vim 键绑定开关",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": []
    },
    {
      "name": "workspaces",
      "description": "工作区列表",
      "category": "workspace",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    {
      "name": "y",
      "description": "显示命令面板",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    }
  ],
  "byName": {
    "add-dir": {
      "name": "add-dir",
      "description": "添加工作目录",
      "category": "workspace",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "advisor": {
      "name": "advisor",
      "description": "顾问建议",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "agents": {
      "name": "agents",
      "description": "Agent 列表",
      "category": "agent",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "branch": {
      "name": "branch",
      "description": "分支当前会话并切换",
      "category": "cli-only",
      "executor": "builtin"
    },
    "bughunter": {
      "name": "bughunter",
      "description": "Bug 猎手",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "commit": {
      "name": "commit",
      "description": "提交变更",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    "compact": {
      "name": "compact",
      "aliases": [
        "summary"
      ],
      "description": "压缩当前会话上下文",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    "config": {
      "name": "config",
      "description": "配置查看/编辑",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "connect": {
      "name": "connect",
      "description": "连接服务商",
      "category": "plugin",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "console": {
      "name": "console",
      "description": "切换控制台",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "copy_path": {
      "name": "copy_path",
      "description": "复制工作树路径",
      "category": "workspace",
      "executor": "builtin",
      "tuiOnly": false
    },
    "cost": {
      "name": "cost",
      "description": "显示 token 用量与成本",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    "cycle": {
      "name": "cycle",
      "description": "循环切换变体",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false,
      "aliases": []
    },
    "cycle_favorite": {
      "name": "cycle_favorite",
      "description": "循环切换收藏",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    "cycle_favorite_reverse": {
      "name": "cycle_favorite_reverse",
      "description": "反序循环切换收藏",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    "cycle_recent": {
      "name": "cycle_recent",
      "description": "循环切换模型",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    "cycle_recent_reverse": {
      "name": "cycle_recent_reverse",
      "description": "反序循环切换模型",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    "cycle.reverse": {
      "name": "cycle.reverse",
      "description": "反序循环切换代理",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false
    },
    "debug": {
      "name": "debug",
      "description": "调试信息",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "doctor": {
      "name": "doctor",
      "description": "环境体检",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "editor": {
      "name": "editor",
      "description": "外部编辑器编写消息",
      "category": "cli-only",
      "executor": "builtin"
    },
    "env": {
      "name": "env",
      "description": "显示环境信息",
      "category": "system",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": false
    },
    "export": {
      "name": "export",
      "description": "导出会话记录",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "feedback": {
      "name": "feedback",
      "description": "反馈提交",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "summary"
      ],
      "requiresSession": true
    },
    "fork": {
      "name": "fork",
      "description": "分叉会话",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "heap_snapshot": {
      "name": "heap_snapshot",
      "description": "写入堆快照",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "help": {
      "name": "help",
      "aliases": [
        "quit",
        "q"
      ],
      "description": "显示帮助",
      "category": "system",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": false
    },
    "hooks": {
      "name": "hooks",
      "description": "钩子管理",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    "insights": {
      "name": "insights",
      "description": "改进洞察",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "keybindings": {
      "name": "keybindings",
      "description": "键绑定列表",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "list": {
      "name": "list",
      "description": "切换模型变体",
      "category": "agent",
      "executor": "builtin",
      "tuiOnly": false,
      "aliases": []
    },
    "login": {
      "name": "login",
      "description": "登录",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    "logout": {
      "name": "logout",
      "description": "登出",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    "mcps": {
      "name": "mcps",
      "description": "MCP 服务器管理",
      "category": "plugin",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "memory": {
      "name": "memory",
      "description": "记忆管理",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "mem"
      ],
      "requiresSession": true
    },
    "mode.lock": {
      "name": "mode.lock",
      "description": "帮助",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "model": {
      "name": "model",
      "description": "查看/切换模型",
      "category": "model",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    "new": {
      "name": "new",
      "description": "新建会话",
      "category": "session",
      "executor": "builtin",
      "tuiOnly": false
    },
    "output-style": {
      "name": "output-style",
      "description": "输出风格选择",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "permissions": {
      "name": "permissions",
      "description": "显示当前会话权限规则",
      "category": "session",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "plan": {
      "name": "plan",
      "description": "计划模式",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "redo": {
      "name": "redo",
      "description": "恢复撤回",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "release_notes": {
      "name": "release_notes",
      "description": "更新日志",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "release-notes": {
      "name": "release-notes",
      "aliases": [
        "changelog"
      ],
      "description": "更新日志",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    "rename": {
      "name": "rename",
      "description": "重命名会话",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "renderer": {
      "name": "renderer",
      "description": "选择渲染器（opentui / fallback）",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "renderer.select": {
      "name": "renderer.select",
      "description": "选择渲染器（opentui / fallback）",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "rewind": {
      "name": "rewind",
      "description": "回退到历史某点",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "security-review": {
      "name": "security-review",
      "description": "安全审查",
      "category": "debug",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "share": {
      "name": "share",
      "description": "分享会话",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "status": {
      "name": "status",
      "description": "显示版本/模型/会话/目录信息",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "subagents": {
      "name": "subagents",
      "description": "查看最近子代理状态",
      "category": "cli-only",
      "executor": "builtin"
    },
    "switch": {
      "name": "switch",
      "description": "切换主题",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "themes": {
      "name": "themes",
      "description": "主题切换",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "thinking": {
      "name": "thinking",
      "description": "思考块显示开关",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin",
      "requiresSession": true
    },
    "timeline": {
      "name": "timeline",
      "description": "跳转到消息",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "timestamps": {
      "name": "timestamps",
      "description": "时间戳显示开关",
      "category": "config",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "title.toggle": {
      "name": "title.toggle",
      "description": "环境诊断",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    },
    "ultraplan": {
      "name": "ultraplan",
      "description": "超级计划",
      "category": "system",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "undo": {
      "name": "undo",
      "description": "撤回上一轮",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "unshare": {
      "name": "unshare",
      "description": "取消分享",
      "category": "session",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "upgrade": {
      "name": "upgrade",
      "description": "升级引导",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "changelog"
      ],
      "requiresSession": true
    },
    "usage": {
      "name": "usage",
      "description": "用量统计",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": [
        "perms"
      ],
      "requiresSession": true
    },
    "variants": {
      "name": "variants",
      "description": "切换模型变体",
      "category": "model",
      "tuiOnly": true,
      "executor": "builtin"
    },
    "vim": {
      "name": "vim",
      "description": "Vim 键绑定开关",
      "category": "config",
      "executor": "builtin",
      "tuiOnly": true,
      "aliases": []
    },
    "workspaces": {
      "name": "workspaces",
      "description": "工作区列表",
      "category": "workspace",
      "tuiOnly": true,
      "executor": "builtin",
      "aliases": [],
      "requiresSession": true
    },
    "y": {
      "name": "y",
      "description": "显示命令面板",
      "category": "system",
      "executor": "builtin",
      "tuiOnly": false
    }
  },
  "byAlias": {
    "mem": "memory",
    "summary": "feedback",
    "perms": "usage",
    "quit": "help",
    "q": "help",
    "changelog": "upgrade"
  },
  "byCategory": {
    "system": [
      "console",
      "env",
      "heap_snapshot",
      "help",
      "login",
      "logout",
      "mode.lock",
      "release_notes",
      "renderer.select",
      "status",
      "switch",
      "title.toggle",
      "ultraplan",
      "y"
    ],
    "session": [
      "compact",
      "cost",
      "export",
      "fork",
      "new",
      "permissions",
      "plan",
      "redo",
      "rename",
      "rewind",
      "share",
      "timeline",
      "undo",
      "unshare"
    ],
    "agent": [
      "agents",
      "cycle",
      "cycle_favorite",
      "cycle_favorite_reverse",
      "cycle_recent",
      "cycle_recent_reverse",
      "cycle.reverse",
      "list"
    ],
    "model": [
      "model",
      "variants"
    ],
    "workspace": [
      "add-dir",
      "copy_path",
      "workspaces"
    ],
    "plugin": [
      "connect",
      "mcps"
    ],
    "debug": [
      "advisor",
      "bughunter",
      "debug",
      "doctor",
      "insights",
      "security-review"
    ],
    "config": [
      "commit",
      "config",
      "feedback",
      "hooks",
      "keybindings",
      "memory",
      "output-style",
      "release-notes",
      "renderer",
      "themes",
      "thinking",
      "timestamps",
      "upgrade",
      "usage",
      "vim"
    ],
    "cli-only": [
      "branch",
      "editor",
      "subagents"
    ]
  }
}
