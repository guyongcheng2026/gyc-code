// 斜杠命令菜单系统 - 虚拟列表、模糊搜索、键盘导航
// 复用 TUI autocomplete 的核心逻辑（fuzzysort 配置）

import fuzzysort from "fuzzysort"
import { MenuEntry, SlashCommandSpec } from "./interactive-types"
import { commandManifest } from "./command-manifest"
import { TokyoNight, Typography } from "../theme"

const MENU_HEIGHT = 10
const DIM = TokyoNight.textMuted
const BOLD = Typography.bold
const RESET = Typography.reset + TokyoNight.text
const CYAN = TokyoNight.primary

export interface SlashMenuOptions {
  onSelect: (entry: MenuEntry) => void
  onCancel: () => void
  onFilterChange?: (query: string) => void
  dynamicCommands?: Map<string, { name: string; description?: string; source?: string }>
  sessionId?: string
}

export class SlashMenu {
  private entries: MenuEntry[] = []
  private filtered: MenuEntry[] = []
  private selected = 0
  private offset = 0
  private query = ""
  private hidden = false
  private dynamicCommands: Map<string, { name: string; description?: string; source?: string }>
  private sessionId?: string

  constructor(private options: SlashMenuOptions) {
    this.dynamicCommands = options.dynamicCommands ?? new Map()
    this.sessionId = options.sessionId
    this.rebuildEntries()
  }

  private rebuildEntries(): void {
    const entries: MenuEntry[] = []
    const seen = new Set<string>()

    // 静态命令（来自清单）
    for (const spec of commandManifest.commands) {
      if (seen.has(spec.name)) continue
      seen.add(spec.name)
      entries.push({
        label: "/" + spec.name,
        fill: "/" + spec.name,
        description: spec.tuiOnly ? spec.description + "（仅 TUI）" : spec.description,
        aliases: (spec.aliases ?? []).map(a => "/" + a).join(" "),
        tuiOnly: spec.tuiOnly ?? false,
        dynamic: false,
      })
    }

    // 动态命令（服务端）
    for (const [name, info] of this.dynamicCommands) {
      if (seen.has(name)) continue
      seen.add(name)
      if (info.source === "skill") continue
      entries.push({
        label: "/" + name + (info.source === "mcp" ? ":mcp" : ""),
        fill: "/" + name,
        description: info.description ?? "",
        aliases: "",
        tuiOnly: false,
        dynamic: true,
      })
    }

    entries.sort((a, b) => a.label.localeCompare(b.label))
    this.entries = entries
    this.filtered = entries
  }

  updateDynamicCommands(commands: Map<string, { name: string; description?: string; source?: string }>): void {
    this.dynamicCommands = commands
    this.rebuildEntries()
    if (!this.hidden) this.filter(this.query)
  }

  setSessionId(id: string): void {
    this.sessionId = id
  }

  filter(query: string): void {
    this.query = query
    if (!query) {
      this.filtered = this.entries
    } else {
      // fuzzysort 配置对齐 TUI (prompt/autocomplete.tsx)
      this.filtered = fuzzysort
        .go(query, this.entries, {
          keys: [
            (obj) => obj.label.trimEnd(),
            "description",
            "aliases",
          ],
          threshold: 0,
          limit: 50,
          scoreFn: (objResults) => {
            const displayResult = objResults[0]
            let score = objResults.score
            if (displayResult && displayResult.target.startsWith("/" + query)) {
              score *= 2 // 前缀匹配加权
            }
            return score
          },
        })
        .map((r) => r.obj)
    }
    this.selected = 0
    this.offset = 0
    this.options.onFilterChange?.(query)
  }

  getQuery(): string {
    return this.query
  }

  getSelected(): MenuEntry | undefined {
    return this.filtered[this.selected]
  }

  moveSelection(delta: number): void {
    if (this.filtered.length === 0) return
    this.selected = (this.selected + delta + this.filtered.length) % this.filtered.length
    this.ensureVisible()
  }

  setSelection(index: number): void {
    if (index >= 0 && index < this.filtered.length) {
      this.selected = index
      this.ensureVisible()
    }
  }

  private ensureVisible(): void {
    // 确保选中项在视口内
    if (this.selected < this.offset) {
      this.offset = this.selected
    } else if (this.selected >= this.offset + MENU_HEIGHT) {
      this.offset = this.selected - MENU_HEIGHT + 1
    }
  }

  getVisibleEntries(): MenuEntry[] {
    return this.filtered.slice(this.offset, this.offset + MENU_HEIGHT)
  }

  isEmpty(): boolean {
    return this.filtered.length === 0
  }

  show(): void {
    this.hidden = false
  }

  hide(): void {
    this.hidden = true
  }

  isHidden(): boolean {
    return this.hidden
  }

  executeSelected(): void {
    const entry = this.getSelected()
    if (entry) {
      this.options.onSelect(entry)
    }
  }

  cancel(): void {
    this.options.onCancel()
  }

  // 渲染菜单到 stdout
  render(stdout: NodeJS.WritableStream, inputLine: string, cursorPos: number): void {
    // 先渲染输入行
    const prefix = CYAN + "> " + RESET
    const prefixWidth = this.getDisplayWidth("> ")
    stdout.write("\r\x1b[K" + prefix + inputLine)
    const col = prefixWidth + this.getDisplayWidth(inputLine.slice(0, cursorPos)) + 1
    stdout.write("\x1b[" + col + "G")

    // 渲染菜单
    if (this.hidden || this.filtered.length === 0) {
      // 清除菜单区域
      for (let i = 0; i < MENU_HEIGHT; i++) {
        stdout.write("\n\x1b[K")
      }
      stdout.write("\x1b[" + MENU_HEIGHT + "A")
      return
    }

    const visible = this.getVisibleEntries()
    for (let i = 0; i < MENU_HEIGHT; i++) {
      stdout.write("\n\x1b[K")
      const entry = visible[i]
      if (!entry) continue
      const globalIndex = this.offset + i
      const desc = entry.description ? DIM + "  " + entry.description + RESET : ""
      if (globalIndex === this.selected) {
        stdout.write(BOLD + "› " + entry.label + RESET + desc)
      } else {
        stdout.write(DIM + "  " + entry.label + RESET + desc)
      }
    }
    stdout.write("\x1b[" + MENU_HEIGHT + "A")
  }

  private getDisplayWidth(str: string): number {
    let width = 0
    for (const char of str) {
      const code = char.charCodeAt(0)
      if (code >= 0x1100 && (code <= 0x115F || code === 0x2329 || code === 0x232A ||
        (code >= 0x2E80 && code <= 0xA4CF) ||
        (code >= 0xAC00 && code <= 0xD7A3) ||
        (code >= 0xF900 && code <= 0xFAFF) ||
        (code >= 0xFE10 && code <= 0xFE1F) ||
        (code >= 0xFE30 && code <= 0xFE6F) ||
        (code >= 0xFF00 && code <= 0xFF60) ||
        (code >= 0xFFE0 && code <= 0xFFE6))) {
        width += 2
      } else {
        width += 1
      }
    }
    return width
  }
}

// 命令面板 - Ctrl+P 打开的全量命令搜索界面
export class CommandPalette {
  private entries: MenuEntry[] = []
  private filtered: MenuEntry[] = []
  private selected = 0
  private offset = 0
  private query = ""
  private dynamicCommands: Map<string, { name: string; description?: string; source?: string }>

  constructor(
    private onExecute: (entry: MenuEntry) => void,
    private onClose: () => void,
    dynamicCommands: Map<string, { name: string; description?: string; source?: string }>
  ) {
    this.dynamicCommands = dynamicCommands
    this.rebuild()
  }

  private rebuild(): void {
    const entries: MenuEntry[] = []
    const seen = new Set<string>()
    for (const spec of commandManifest.commands) {
      if (seen.has(spec.name)) continue
      seen.add(spec.name)
      entries.push({
        label: "/" + spec.name,
        fill: "/" + spec.name,
        description: spec.description + (spec.tuiOnly ? "（仅 TUI）" : ""),
        aliases: (spec.aliases ?? []).map(a => "/" + a).join(" "),
        tuiOnly: spec.tuiOnly ?? false,
        dynamic: false,
      })
    }
    for (const [name, info] of this.dynamicCommands) {
      if (seen.has(name)) continue
      seen.add(name)
      if (info.source === "skill") continue
      entries.push({
        label: "/" + name + (info.source === "mcp" ? ":mcp" : ""),
        fill: "/" + name,
        description: info.description ?? "",
        aliases: "",
        tuiOnly: false,
        dynamic: true,
      })
    }
    entries.sort((a, b) => a.label.localeCompare(b.label))
    this.entries = entries
    this.filtered = entries
  }

  filter(query: string): void {
    this.query = query
    if (!query) {
      this.filtered = this.entries
    } else {
      this.filtered = fuzzysort
        .go(query, this.entries, {
          keys: [(obj) => obj.label.trimEnd(), "description", "aliases"],
          threshold: 0,
          limit: 50,
        })
        .map((r) => r.obj)
    }
    this.selected = 0
    this.offset = 0
  }

  move(delta: number): void {
    if (this.filtered.length === 0) return
    this.selected = (this.selected + delta + this.filtered.length) % this.filtered.length
    if (this.selected < this.offset) this.offset = this.selected
    else if (this.selected >= this.offset + MENU_HEIGHT) this.offset = this.selected - MENU_HEIGHT + 1
  }

  execute(): void {
    const entry = this.filtered[this.selected]
    if (entry) this.onExecute(entry)
  }

  close(): void {
    this.onClose()
  }

  render(stdout: NodeJS.WritableStream): void {
    const visible = this.filtered.slice(this.offset, this.offset + MENU_HEIGHT)
    stdout.write("\x1b[2J\x1b[H") // 清屏
    stdout.write(CYAN + "命令面板" + RESET + "  " + DIM + "输入搜索，↑/↓ 选择，Enter 执行，Esc 关闭" + RESET + "\n\n")
    for (let i = 0; i < MENU_HEIGHT; i++) {
      const entry = visible[i]
      if (!entry) { stdout.write("\n"); continue }
      const globalIndex = this.offset + i
      const desc = entry.description ? DIM + "  " + entry.description + RESET : ""
      if (globalIndex === this.selected) {
        stdout.write(BOLD + "› " + entry.label + RESET + desc + "\n")
      } else {
        stdout.write(DIM + "  " + entry.label + RESET + desc + "\n")
      }
    }
  }
}