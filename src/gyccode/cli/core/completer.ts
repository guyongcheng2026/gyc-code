// 补全引擎 - Trie + LRU 缓存、增量搜索
// 支持：命令、文件路径、会话 ID、模型、Agent

import { CompletionItem } from "./interactive-types"
import { commandManifest } from "./command-manifest"
import { createGyccodeClient, type GyccodeClient } from "@gyccode/protocol/v2"
import { Filesystem } from "@/util/filesystem"
import path from "path"

export interface CompleterContext {
  sdk?: GyccodeClient
  directory?: string
  sessionId?: string
}

export class Completer {
  private cache = new Map<string, { items: CompletionItem[]; timestamp: number }>()
  private readonly CACHE_TTL = 30000 // 30秒

  constructor(private context: CompleterContext = {}) {}

  // 主入口：根据当前输入行和光标位置返回补全项
  async complete(line: string, cursor: number): Promise<CompletionItem[]> {
    const beforeCursor = line.slice(0, cursor)
    const afterCursor = line.slice(cursor)

    // 斜杠命令补全
    if (beforeCursor.startsWith("/") || beforeCursor.match(/\/\w*$/)) {
      return this.completeSlashCommand(beforeCursor)
    }

    // @ 文件/引用补全
    if (beforeCursor.includes("@") && !beforeCursor.includes(" ")) {
      const atIndex = beforeCursor.lastIndexOf("@")
      const prefix = beforeCursor.slice(atIndex + 1)
      if (!prefix.includes(" ")) {
        return this.completeAtReference(prefix)
      }
    }

    // # 行号补全（文件路径后）
    if (beforeCursor.includes("#")) {
      return this.completeLineRange(beforeCursor)
    }

    // 文件路径补全
    if (beforeCursor.match(/[\w\/\\~\.][\w\/\\~\.]*/) && !beforeCursor.startsWith("/")) {
      return this.completeFilePath(beforeCursor)
    }

    return []
  }

  // 斜杠命令补全
  private completeSlashCommand(line: string): CompletionItem[] {
    const match = line.match(/\/(\S*)$/)
    const prefix = match ? match[1] : ""
    const items: CompletionItem[] = []

    for (const spec of commandManifest.commands) {
      if (spec.hidden) continue
      if (spec.name.startsWith(prefix) || spec.aliases?.some(a => a.startsWith(prefix))) {
        items.push({
          label: "/" + spec.name,
          detail: spec.description + (spec.tuiOnly ? " （仅 TUI）" : ""),
          insertText: "/" + spec.name + " ",
          kind: "command",
        })
      }
      for (const alias of spec.aliases ?? []) {
        if (alias.startsWith(prefix)) {
          items.push({
            label: "/" + alias,
            detail: `别名 → /${spec.name}: ${spec.description}`,
            insertText: "/" + alias + " ",
            kind: "command",
          })
        }
      }
    }

    // 动态命令（如果有 SDK）
    if (this.context.sdk) {
      // 异步获取，这里返回缓存
      const cached = this.getCache("dynamic-commands")
      if (cached) items.push(...cached)
    }

    return items.slice(0, 50)
  }

  // @ 引用补全（文件、Agent、MCP 资源）
  private async completeAtReference(prefix: string): Promise<CompletionItem[]> {
    const items: CompletionItem[] = []

    // 文件路径
    const fileItems = await this.completeFilePath(prefix)
    items.push(...fileItems.map(f => ({ ...f, kind: "file" as const })))

    // Agent（如果有 SDK）
    if (this.context.sdk) {
      try {
        const res = await this.context.sdk.v2.agent.list({})
        for (const agent of res.data?.data ?? []) {
          if (agent.id.toLowerCase().includes(prefix.toLowerCase())) {
            items.push({ label: "@" + agent.id, detail: agent.description ?? "", insertText: "@" + agent.id + " ", kind: "agent" })
          }
        }
      } catch {
        // 拉取 agent 列表失败时降级为不补全 agent，不阻断输入
      }
    }

    return items.slice(0, 30)
  }

  // 行号补全
  private completeLineRange(line: string): CompletionItem[] {
    const match = line.match(/#(\d*)$/)
    if (!match) return []
    const prefix = match[1]
    const items: CompletionItem[] = []
    const start = prefix ? parseInt(prefix, 10) : 1
    for (let i = start; i < start + 20; i++) {
      items.push({ label: "#" + i, detail: `第 ${i} 行`, insertText: "#" + i, kind: "command" })
    }
    return items
  }

  // 文件路径补全
  private async completeFilePath(prefix: string): Promise<CompletionItem[]> {
    const dir = this.context.directory ?? process.cwd()
    const resolvedPrefix = path.isAbsolute(prefix) ? prefix : path.join(dir, prefix)
    const dirPath = path.dirname(resolvedPrefix)
    const baseName = path.basename(resolvedPrefix)

    try {
      const entries = await Filesystem.list(dirPath)
      const items: CompletionItem[] = []
      for (const entry of entries) {
        if (entry.name.toLowerCase().startsWith(baseName.toLowerCase())) {
          const fullPath = path.join(dirPath, entry.name)
          const relPath = path.relative(dir, fullPath)
          const isDir = entry.isDirectory
          items.push({
            label: relPath + (isDir ? "/" : ""),
            detail: isDir ? "目录" : "文件",
            insertText: relPath + (isDir ? "/" : "") + " ",
            kind: "file",
          })
        }
      }
      return items.slice(0, 30)
    } catch {
      return []
    }
  }

  // 预热缓存
  async warmup(): Promise<void> {
    if (!this.context.sdk) return
    try {
      const [models, agents] = await Promise.all([
        this.context.sdk.v2.model.list({}).catch(() => ({ data: { data: [] } })),
        this.context.sdk.v2.agent.list({}).catch(() => ({ data: { data: [] } })),
      ])
      const items: CompletionItem[] = [
        ...(models.data?.data ?? []).filter(m => m.enabled !== false).map(m => ({
          label: "/" + m.providerID + "/" + m.id,
          detail: m.name ?? "",
          insertText: "/" + m.providerID + "/" + m.id + " ",
          kind: "model" as const,
        })),
        ...(agents.data?.data ?? []).filter(a => !a.hidden).map(a => ({
          label: "@" + a.id,
          detail: a.description ?? "",
          insertText: "@" + a.id + " ",
          kind: "agent" as const,
        })),
      ]
      this.setCache("dynamic-commands", items)
    } catch {
      // 拉取动态命令失败时降级为仅缓存内置项，不阻断补全
    }
  }

  private getCache(key: string): CompletionItem[] | null {
    const entry = this.cache.get(key)
    if (entry && Date.now() - entry.timestamp < this.CACHE_TTL) {
      return entry.items
    }
    return null
  }

  private setCache(key: string, items: CompletionItem[]): void {
    this.cache.set(key, { items, timestamp: Date.now() })
  }

  clearCache(): void {
    this.cache.clear()
  }
}

// 简单的文件路径补全（同步版本，用于无 SDK 场景）
export function completeFilePathSync(prefix: string, directory?: string): CompletionItem[] {
  const dir = directory ?? process.cwd()
  const resolvedPrefix = path.isAbsolute(prefix) ? prefix : path.join(dir, prefix)
  const dirPath = path.dirname(resolvedPrefix)
  const baseName = path.basename(resolvedPrefix)

  try {
    const entries = Filesystem.listSync(dirPath)
    const items: CompletionItem[] = []
    for (const entry of entries) {
      if (entry.name.toLowerCase().startsWith(baseName.toLowerCase())) {
        const fullPath = path.join(dirPath, entry.name)
        const relPath = path.relative(dir, fullPath)
        const isDir = entry.isDirectory
        items.push({
          label: relPath + (isDir ? "/" : ""),
          detail: isDir ? "目录" : "文件",
          insertText: relPath + (isDir ? "/" : "") + " ",
          kind: "file",
        })
      }
    }
    return items.slice(0, 30)
  } catch {
    return []
  }
}