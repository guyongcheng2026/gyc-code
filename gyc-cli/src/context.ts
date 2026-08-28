// gyc cli 系统提示与上下文组装：
// - 身份与行为准则（简洁、并发工具调用、中文界面）
// - 用户上下文注入：cwd、git 状态、平台信息

import { execSync } from "node:child_process"
import * as os from "node:os"

export function getSystemPrompt(): string {
  return [
    "你是 gyc cli，一个运行在用户终端的交互式编码助手。",
    "",
    "# 行为准则",
    "- 回答使用简体中文；代码标识符、命令、路径保持原样。",
    "- 简洁优先：直接给出答案与行动，不输出冗长铺垫。",
    "- 涉及文件修改前必须先用 Read 读取目标文件。",
    "- 尽可能并行调用独立的只读工具（Read/Glob/Grep）。",
    "- 任务完成后简述做了什么、改了哪些文件。",
    "",
    "# 工具使用",
    "- Bash 在 Windows 上经 cmd /c 执行；跨平台命令注意兼容性。",
    "- Grep 用于内容搜索，Glob 用于文件名匹配，读大文件用 Read 的 offset/limit。",
  ].join("\n")
}

export function getUserContext(cwd: string): string {
  const parts = [
    `<env>\n工作目录: ${cwd}\n平台: ${os.platform()} ${os.release()}\n</env>`,
  ]
  try {
    const gitStatus = execSync("git status --short", { cwd, encoding: "utf-8", timeout: 5000 })
    parts.push(`<git_status>\n${gitStatus.trim() || "（工作区干净）"}\n</git_status>`)
  } catch {
    // 非 git 目录，跳过
  }
  return parts.join("\n\n")
}
