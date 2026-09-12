import type { Argv } from "yargs"
import { UI } from "../ui"
import * as prompts from "@clack/prompts"
import { Installation } from "../../installation"
import { Global } from "@gyccode/core/global"
import fs from "fs/promises"
import path from "path"
import os from "os"
import { Filesystem } from "@/util/filesystem"
import { Process } from "@/util/process"
import { withHomeTilde } from "@/util/path-display"

interface UninstallArgs {
  keepConfig: boolean
  keepData: boolean
  dryRun: boolean
  force: boolean
}

interface RemovalTargets {
  directories: Array<{ path: string; label: string; keep: boolean }>
  shellConfig: string | null
  binary: string | null
}

export const UninstallCommand = {
  command: "uninstall",
  describe: "卸载 gyc 并删除所有相关文件",
  builder: (yargs: Argv) =>
    yargs
      .option("keep-config", {
        alias: "c",
        type: "boolean",
        describe: "保留配置文件",
        default: false,
      })
      .option("keep-data", {
        alias: "d",
        type: "boolean",
        describe: "保留会话数据和快照",
        default: false,
      })
      .option("dry-run", {
        type: "boolean",
        describe: "仅显示将要删除的内容，而不实际删除",
        default: false,
      })
      .option("force", {
        alias: "f",
        type: "boolean",
        describe: "跳过确认提示",
        default: false,
      }),

  handler: async (args: UninstallArgs) => {
    UI.empty()
    UI.println(UI.logo("  "))
    UI.empty()
    prompts.intro("卸载 GycCode")

    const method = await Installation.method()
    prompts.log.info(`安装方式：${method}`)

    const targets = await collectRemovalTargets(args, method)

    await showRemovalSummary(targets, method)

    if (!args.force && !args.dryRun) {
      const confirm = await prompts.confirm({
        message: "确定要卸载吗？",
        initialValue: false,
      })
      if (!confirm || prompts.isCancel(confirm)) {
        prompts.outro("已取消")
        return
      }
    }

    if (args.dryRun) {
      prompts.log.warn("演练模式 — 未做任何改动")
      prompts.outro("完成")
      return
    }

    await executeUninstall(method, targets)

    prompts.outro("完成")
  },
}

async function collectRemovalTargets(args: UninstallArgs, method: Installation.Method): Promise<RemovalTargets> {
  const directories: RemovalTargets["directories"] = [
    { path: Global.Path.data, label: "数据", keep: args.keepData },
    { path: Global.Path.cache, label: "缓存", keep: false },
    { path: Global.Path.config, label: "配置", keep: args.keepConfig },
    { path: Global.Path.state, label: "状态", keep: false },
  ]

  const shellConfig = method === "curl" ? await getShellConfigFile() : null
  const binary = method === "curl" ? process.execPath : null

  return { directories, shellConfig, binary }
}

async function showRemovalSummary(targets: RemovalTargets, method: Installation.Method) {
  prompts.log.message("以下内容将被删除：")

  for (const dir of targets.directories) {
    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    const size = await getDirectorySize(dir.path)
    const sizeStr = formatSize(size)
    const status = dir.keep ? UI.Style.TEXT_DIM + "（保留）" : ""
    const prefix = dir.keep ? "○" : "✓"

    prompts.log.info(`  ${prefix} ${dir.label}: ${withHomeTilde(dir.path)} ${UI.Style.TEXT_DIM}(${sizeStr})${status}`)
  }

  if (targets.binary) {
    prompts.log.info(`  ✓ 二进制文件： ${withHomeTilde(targets.binary)}`)
  }

  if (targets.shellConfig) {
    prompts.log.info(`  ✓ Shell PATH 位于 ${withHomeTilde(targets.shellConfig)}`)
  }

  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string> = {
      npm: "npm uninstall -g gyccode-ai",
      pnpm: "pnpm uninstall -g gyccode-ai",
      bun: "bun remove -g gyccode-ai",
      yarn: "yarn global remove gyccode-ai",
      brew: "brew uninstall gyccode",
      choco: "choco uninstall gyccode",
      scoop: "scoop uninstall gyccode",
    }
    prompts.log.info(`  ✓ 软件包： ${cmds[method] || method}`)
  }
}

async function executeUninstall(method: Installation.Method, targets: RemovalTargets) {
  const spinner = prompts.spinner()
  const errors: string[] = []

  for (const dir of targets.directories) {
    if (dir.keep) {
      prompts.log.step(`跳过 ${dir.label}（--keep-${dir.label.toLowerCase()}）`)
      continue
    }

    const exists = await fs
      .access(dir.path)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    spinner.start(`正在移除 ${dir.label}…`)
    const err = await fs.rm(dir.path, { recursive: true, force: true }).catch((e) => e)
    if (err) {
      spinner.stop(`移除 ${dir.label} 失败`)
      errors.push(`${dir.label}: ${err.message}`)
      continue
    }
    spinner.stop(`已移除 ${dir.label}`)
  }

  if (targets.shellConfig) {
    spinner.start("正在清理 shell 配置...")
    const err = await cleanShellConfig(targets.shellConfig).catch((e) => e)
    if (err) {
      spinner.stop("清理 shell 配置失败")
      errors.push(`Shell 配置：${err.message}`)
    } else {
      spinner.stop("已清理 shell 配置")
    }
  }

  if (method !== "curl" && method !== "unknown") {
    const cmds: Record<string, string[]> = {
      npm: ["npm", "uninstall", "-g", "gyccode-ai"],
      pnpm: ["pnpm", "uninstall", "-g", "gyccode-ai"],
      bun: ["bun", "remove", "-g", "gyccode-ai"],
      yarn: ["yarn", "global", "remove", "gyccode-ai"],
      brew: ["brew", "uninstall", "gyccode"],
      choco: ["choco", "uninstall", "gyccode"],
      scoop: ["scoop", "uninstall", "gyccode"],
    }

    const cmd = cmds[method]
    if (cmd) {
      spinner.start(`正在运行 ${cmd.join(" ")}…`)
      const result = await Process.run(method === "choco" ? ["choco", "uninstall", "gyccode", "-y", "-r"] : cmd, {
        nothrow: true,
      })
      if (result.code !== 0) {
        spinner.stop()
        const text = `${result.stdout.toString("utf8")}\n${result.stderr.toString("utf8")}`
        if (method === "choco" && text.includes("not running from an elevated command shell")) {
          prompts.log.warn(`你可能需要在管理员命令行中运行 '${cmd.join(" ")}'`)
        } else {
          prompts.log.warn(`你可能需要手动运行：${cmd.join(" ")}`)
        }
      } else {
        spinner.stop("已移除软件包")
      }
    }
  }

  if (method === "curl" && targets.binary) {
    UI.empty()
    prompts.log.message("要完成二进制文件的移除，请运行：")
    prompts.log.info(`  rm "${targets.binary}"`)

    const binDir = path.dirname(targets.binary)
    if (binDir.includes(".gyccode")) {
      prompts.log.info(`  rmdir "${binDir}" 2>/dev/null`)
    }
  }

  if (errors.length > 0) {
    UI.empty()
    prompts.log.warn("部分操作失败：")
    for (const err of errors) {
      prompts.log.error(`  ${err}`)
    }
  }

  UI.empty()
  prompts.log.success("感谢使用 GycCode！")
}

async function getShellConfigFile(): Promise<string | null> {
  const shell = path.basename(process.env.SHELL || "bash")
  const home = os.homedir()
  const xdgConfig = process.env.XDG_CONFIG_HOME || path.join(home, ".config")

  const configFiles: Record<string, string[]> = {
    fish: [path.join(xdgConfig, "fish", "config.fish")],
    zsh: [
      path.join(home, ".zshrc"),
      path.join(home, ".zshenv"),
      path.join(xdgConfig, "zsh", ".zshrc"),
      path.join(xdgConfig, "zsh", ".zshenv"),
    ],
    bash: [
      path.join(home, ".bashrc"),
      path.join(home, ".bash_profile"),
      path.join(home, ".profile"),
      path.join(xdgConfig, "bash", ".bashrc"),
      path.join(xdgConfig, "bash", ".bash_profile"),
    ],
    ash: [path.join(home, ".ashrc"), path.join(home, ".profile")],
    sh: [path.join(home, ".profile")],
  }

  const candidates = configFiles[shell] || configFiles.bash

  for (const file of candidates) {
    const exists = await fs
      .access(file)
      .then(() => true)
      .catch(() => false)
    if (!exists) continue

    const content = await Filesystem.readText(file).catch(() => "")
    if (content.includes("# gyccode") || content.includes(".gyccode/bin")) {
      return file
    }
  }

  return null
}

async function cleanShellConfig(file: string) {
  const content = await Filesystem.readText(file)
  const lines = content.split("\n")

  const filtered: string[] = []
  let skip = false

  for (const line of lines) {
    const trimmed = line.trim()

    if (trimmed === "# gyccode") {
      skip = true
      continue
    }

    if (skip) {
      skip = false
      if (trimmed.includes(".gyccode/bin") || trimmed.includes("fish_add_path")) {
        continue
      }
    }

    if (
      (trimmed.startsWith("export PATH=") && trimmed.includes(".gyccode/bin")) ||
      (trimmed.startsWith("fish_add_path") && trimmed.includes(".gyccode"))
    ) {
      continue
    }

    filtered.push(line)
  }

  while (filtered.length > 0 && filtered[filtered.length - 1].trim() === "") {
    filtered.pop()
  }

  const output = filtered.join("\n") + "\n"
  await Filesystem.write(file, output)
}

async function getDirectorySize(dir: string): Promise<number> {
  let total = 0

  const walk = async (current: string) => {
    const entries = await fs.readdir(current, { withFileTypes: true }).catch(() => [])

    for (const entry of entries) {
      const full = path.join(current, entry.name)
      if (entry.isDirectory()) {
        await walk(full)
        continue
      }
      if (entry.isFile()) {
        const stat = await fs.stat(full).catch(() => null)
        if (stat) total += stat.size
      }
    }
  }

  await walk(dir)
  return total
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
}
