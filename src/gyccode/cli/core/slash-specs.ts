// 斜杠命令规格表（与 gyc TUI 的命令面板/斜杠补全保持完全一致）。
// 来源：src/tui/app.tsx appCommands + src/tui/routes/session/index.tsx sessionCommandList。
// tuiOnly: 界面对话框类命令，CLI 下选中时提示改用 `gyc tui`。
//
// 本文件是 scripts/generate-command-manifest.ts 的 CLI 命令提取源；
// command-manifest.ts（菜单/补全消费）由该脚本生成。
// （2026-08-31 自 cli/cmd/default.ts 上收——该文件的 DefaultCommand 死代码已删除。）
export type SlashSpec = {
  name: string
  aliases?: string[]
  desc: string
  tuiOnly?: boolean
}

export const SLASH_SPECS: SlashSpec[] = [
  // 系统全局（appCommands）
  { name: "help", desc: "显示帮助" },
  { name: "exit", aliases: ["quit", "q"], desc: "退出" },
  { name: "sessions", aliases: ["resume", "continue"], desc: "会话列表，选择继续" },
  { name: "new", aliases: ["clear"], desc: "开启全新会话" },
  { name: "models", aliases: ["mo"], desc: "查看/切换模型" },
  { name: "variants", desc: "查看/切换模型变体", tuiOnly: true },
  { name: "model", desc: "查看/切换模型" },
  { name: "variant", desc: "查看/切换模型变体" },
  { name: "agent", desc: "查看/切换 agent" },
  { name: "agents", desc: "agent 列表", tuiOnly: true },
  { name: "workspaces", desc: "工作区列表", tuiOnly: true },
  { name: "mcps", desc: "MCP 服务器管理", tuiOnly: true },
  { name: "connect", desc: "连接服务商", tuiOnly: true },
  { name: "status", desc: "显示版本/模型/会话/目录信息" },
  { name: "debug", desc: "调试信息", tuiOnly: true },
  { name: "themes", desc: "主题切换", tuiOnly: true },
  { name: "doctor", desc: "环境体检", tuiOnly: true },
  { name: "config", desc: "配置查看/编辑", tuiOnly: true },
  { name: "usage", desc: "用量统计", tuiOnly: true },
  { name: "permissions", aliases: ["perms"], desc: "显示当前会话权限规则" },
  { name: "vim", desc: "Vim 键绑定开关", tuiOnly: true },
  { name: "login", desc: "登录", tuiOnly: true },
  { name: "logout", desc: "登出", tuiOnly: true },
  { name: "hooks", desc: "钩子管理", tuiOnly: true },
  { name: "commit", desc: "提交变更", tuiOnly: true },
  { name: "memory", aliases: ["mem"], desc: "记忆管理", tuiOnly: true },
  { name: "upgrade", desc: "升级引导", tuiOnly: true },
  { name: "release-notes", aliases: ["changelog"], desc: "更新日志", tuiOnly: true },
  { name: "feedback", desc: "反馈提交", tuiOnly: true },
  // 会话级（sessionCommandList）
  { name: "compact", aliases: ["summary"], desc: "压缩当前会话上下文" },
  { name: "share", desc: "分享会话", tuiOnly: true },
  { name: "unshare", desc: "取消分享", tuiOnly: true },
  { name: "rename", desc: "重命名会话", tuiOnly: true },
  { name: "timeline", desc: "跳转到消息", tuiOnly: true },
  { name: "fork", desc: "分叉会话", tuiOnly: true },
  { name: "undo", desc: "撤回上一轮", tuiOnly: true },
  { name: "redo", desc: "恢复撤回", tuiOnly: true },
  { name: "rewind", desc: "回退到历史某点", tuiOnly: true },
  { name: "plan", desc: "计划模式", tuiOnly: true },
  { name: "cost", desc: "显示 token 用量与成本" },
  { name: "context", desc: "显示上下文消息统计" },
  { name: "timestamps", desc: "时间戳显示开关", tuiOnly: true },
  { name: "thinking", desc: "思考块显示开关" },
  { name: "copy", desc: "复制最近助手回复" },
  { name: "export", desc: "导出会话记录", tuiOnly: true },
  { name: "env", desc: "显示环境信息" },
  { name: "add-dir", desc: "添加工作目录", tuiOnly: true },
  { name: "output-style", desc: "输出风格选择", tuiOnly: true },
  { name: "keybindings", desc: "键绑定列表", tuiOnly: true },
  { name: "security-review", desc: "安全审查", tuiOnly: true },
  { name: "ultraplan", desc: "超级计划", tuiOnly: true },
  { name: "bughunter", desc: "Bug 猎手", tuiOnly: true },
  { name: "insights", desc: "改进洞察", tuiOnly: true },
  { name: "advisor", desc: "顾问建议", tuiOnly: true },
  // CLI 扩展（TUI 无对应面板，保留为 CLI 专属）
  { name: "branch", desc: "分支当前会话并切换" },
  { name: "editor", desc: "外部编辑器编写消息" },
  { name: "subagents", desc: "查看最近子代理状态" },
]
