// CLI 终端主题 —— 默认"东京夜"（Tokyo Night）
// 色值严格对齐 TUI 主题定义：src/tui/theme/assets/tokyonight.json 的 dark 变体，
// 保证 gyc cli 与 gyc tui 会话观感一致。
// 说明：终端字体/字间距由终端模拟器决定，CLI 可控面为颜色（24-bit 真彩 ANSI）
// 与排印修饰（粗体/斜体/暗淡）及布局间距。

function fg(hex: string): string {
  const n = Number.parseInt(hex.slice(1), 16)
  return `\x1b[38;2;${(n >> 16) & 255};${(n >> 8) & 255};${n & 255}m`
}

// Tokyo Night（dark）色板，注释为 tokyonight.json 中的 defs 键名
export const TokyoNight = {
  /** primary = darkStep9 #82aaff */
  primary: fg("#82aaff"),
  /** secondary = darkPurple #c099ff */
  secondary: fg("#c099ff"),
  /** accent = darkOrange #ff966c */
  accent: fg("#ff966c"),
  /** 正文 = darkStep12 #c8d3f5 */
  text: fg("#c8d3f5"),
  /** 次要文字 = darkStep11 #828bb8 */
  textMuted: fg("#828bb8"),
  /** error = darkRed #ff757f */
  error: fg("#ff757f"),
  /** warning = darkOrange #ff966c */
  warning: fg("#ff966c"),
  /** success = darkGreen #c3e88d */
  success: fg("#c3e88d"),
  /** info = darkStep9 #82aaff */
  info: fg("#82aaff"),
  /** 高亮青 = darkCyan #86e1fc（markdown 链接文本/列表枚举） */
  cyan: fg("#86e1fc"),
  /** 强调黄 = darkYellow #ffc777（引用/斜体） */
  yellow: fg("#ffc777"),
  /** 边框 = darkStep7 #737aa2 */
  border: fg("#737aa2"),
} as const

/** 排印修饰（非颜色） */
export const Typography = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  italic: "\x1b[3m",
  underline: "\x1b[4m",
} as const

export type CliTheme = typeof TokyoNight

// 当前主题（默认东京夜；预留多主题切换扩展点）
export const theme: CliTheme = TokyoNight
