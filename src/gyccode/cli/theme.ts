// CLI 终端主题 —— pi agent 兼容 token 体系，默认"东京夜"（Tokyo Night）
//
// 对齐口径（参考 pi agent @earendil-works/pi-coding-agent theme.ts）：
//   - token 命名与语义对齐 pi（accent/muted/dim/text/toolTitle/toolOutput/md*/toolDiff* 等）
//   - fg() 只重置前景色（ESC[39m），bg() 只重置背景色（ESC[49m），不吞掉排印修饰
//   - 真彩（COLORTERM）与 256 色终端自适应；NO_COLOR 或非 TTY 输出自动退化为纯文本
//
// 色值溯源：全部取自 gyc tui 主题 src/tui/theme/assets/tokyonight.json（dark 变体），
// 与 gyc tui 会话观感完全一致；未在 tokyonight.json 中出现的 token 一律不臆造。
// 说明：终端字体/字间距由终端模拟器决定，CLI 可控面为颜色、排印修饰（粗体/斜体/
// 下划线/删除线）与布局间距。

type ColorMode = "truecolor" | "256color" | "none"

function detectColorMode(): ColorMode {
  if (process.env.NO_COLOR !== undefined) return "none"
  const tty = process.stdout.isTTY || process.stderr.isTTY
  if (!tty) return "none"
  const colorterm = process.env.COLORTERM
  if (colorterm === "truecolor" || colorterm === "24bit") return "truecolor"
  return "256color"
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const n = Number.parseInt(hex.slice(1), 16)
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 }
}

// 6x6x6 色立方与灰阶 ramp（对齐 pi 的 rgbTo256 最近色算法）
const CUBE_VALUES = [0, 95, 135, 175, 215, 255]
const GRAY_VALUES = Array.from({ length: 24 }, (_, i) => 8 + i * 10)

function findClosestIndex(value: number, table: number[]): number {
  let minDist = Number.POSITIVE_INFINITY
  let minIdx = 0
  for (let i = 0; i < table.length; i++) {
    const dist = Math.abs(value - table[i])
    if (dist < minDist) {
      minDist = dist
      minIdx = i
    }
  }
  return minIdx
}

function colorDistance(r1: number, g1: number, b1: number, r2: number, g2: number, b2: number): number {
  const dr = r1 - r2
  const dg = g1 - g2
  const db = b1 - b2
  return dr * dr * 0.299 + dg * dg * 0.587 + db * db * 0.114
}

function rgbTo256(r: number, g: number, b: number): number {
  const rIdx = findClosestIndex(r, CUBE_VALUES)
  const gIdx = findClosestIndex(g, CUBE_VALUES)
  const bIdx = findClosestIndex(b, CUBE_VALUES)
  const cubeR = CUBE_VALUES[rIdx]
  const cubeG = CUBE_VALUES[gIdx]
  const cubeB = CUBE_VALUES[bIdx]
  const cubeDist = colorDistance(r, g, b, cubeR, cubeG, cubeB)
  const gray = Math.round(0.299 * r + 0.587 * g + 0.114 * b)
  const grayIdx = findClosestIndex(gray, GRAY_VALUES)
  const grayValue = GRAY_VALUES[grayIdx]
  const grayDist = colorDistance(r, g, b, grayValue, grayValue, grayValue)
  const spread = Math.max(r, g, b) - Math.min(r, g, b)
  // 近中性色且灰阶更近才用灰阶，保留彩色色调优先走色立方
  if (spread < 10 && grayDist < cubeDist) {
    return 232 + grayIdx
  }
  return 16 + 36 * rIdx + 6 * gIdx + bIdx
}

function fgAnsi(hex: string, mode: ColorMode): string {
  if (mode === "none") return ""
  const { r, g, b } = hexToRgb(hex)
  if (mode === "truecolor") return `\x1b[38;2;${r};${g};${b}m`
  return `\x1b[38;5;${rgbTo256(r, g, b)}m`
}

function bgAnsi(hex: string, mode: ColorMode): string {
  if (mode === "none") return ""
  const { r, g, b } = hexToRgb(hex)
  if (mode === "truecolor") return `\x1b[48;2;${r};${g};${b}m`
  return `\x1b[48;5;${rgbTo256(r, g, b)}m`
}

// ============================================================================
// "东京夜" token 色板 —— 键名对齐 pi，值全部可溯源到 tokyonight.json
// ============================================================================

/** tokyonight.json dark 变体色值（defs 键名见注释） */
const T = {
  darkStep5: "#3b4261",
  darkStep6: "#545c7e",
  darkStep7: "#737aa2",
  darkStep9: "#82aaff",
  darkStep11: "#828bb8",
  darkStep12: "#c8d3f5",
  darkRed: "#ff757f",
  darkOrange: "#ff966c",
  darkYellow: "#ffc777",
  darkGreen: "#c3e88d",
  darkCyan: "#86e1fc",
  darkPurple: "#c099ff",
  // 源自 tokyonight.json 的 diff 系列（theme.diffAdded/diffRemoved/diffContext 等）
  diffAdded: "#4fd6be",
  diffRemoved: "#c53b53",
  diffAddedBg: "#20303b",
  diffRemovedBg: "#37222c",
  darkStep2: "#1e2030",
  darkStep3: "#222436",
} as const

/** pi 兼容前景 token（dark 变体） */
const FG_TOKENS = {
  /** 强调 = darkOrange */
  accent: T.darkOrange,
  border: T.darkStep7,
  borderAccent: T.darkCyan,
  borderMuted: T.darkStep5,
  success: T.darkGreen,
  error: T.darkRed,
  warning: T.darkYellow,
  /** 次要文字 = darkStep11 */
  muted: T.darkStep11,
  /** 深一度弱化 = darkStep6 */
  dim: T.darkStep6,
  text: T.darkStep12,
  /** 思考/推理文本 = darkStep11 */
  thinkingText: T.darkStep11,
  toolTitle: T.darkStep12,
  /** 工具输出文本 = darkStep11 */
  toolOutput: T.darkStep11,
  // Markdown（对齐 tui markdown* 系列）
  mdHeading: T.darkPurple,
  mdLink: T.darkStep9,
  mdLinkUrl: T.darkStep6,
  mdCode: T.darkGreen,
  mdCodeBlock: T.darkStep12,
  mdCodeBlockBorder: T.darkStep7,
  mdQuote: T.darkYellow,
  mdQuoteBorder: T.darkStep6,
  mdHr: T.darkStep11,
  mdListBullet: T.darkStep9,
  // Diff
  toolDiffAdded: T.diffAdded,
  toolDiffRemoved: T.diffRemoved,
  toolDiffContext: T.darkStep11,
  // 语法高亮（对齐 tui syntax* 系列）
  syntaxComment: T.darkStep11,
  syntaxKeyword: T.darkPurple,
  syntaxFunction: T.darkStep9,
  syntaxVariable: T.darkRed,
  syntaxString: T.darkGreen,
  syntaxNumber: T.darkOrange,
  syntaxType: T.darkYellow,
  syntaxOperator: T.darkCyan,
  syntaxPunctuation: T.darkStep12,
} as const

/** pi 兼容背景 token（dark 变体） */
const BG_TOKENS = {
  /** 用户消息底 = darkStep3 */
  userMessageBg: T.darkStep3,
  /** 工具进行中底 = darkStep2 */
  toolPendingBg: T.darkStep2,
  /** 工具成功底 = diffAddedBg */
  toolSuccessBg: T.diffAddedBg,
  /** 工具失败底 = diffRemovedBg */
  toolErrorBg: T.diffRemovedBg,
} as const

export type ThemeToken = keyof typeof FG_TOKENS
export type ThemeBgToken = keyof typeof BG_TOKENS

// ============================================================================
// 主题实例：启动时一次性预算全部 ANSI 序列，热路径仅 Map 查找
// ============================================================================

const FG_RESET = "\x1b[39m"
const BG_RESET = "\x1b[49m"

export class CliTheme {
  private readonly fgMap = new Map<string, string>()
  private readonly bgMap = new Map<string, string>()
  readonly mode: ColorMode

  constructor(mode: ColorMode = detectColorMode()) {
    this.mode = mode
    for (const [token, hex] of Object.entries(FG_TOKENS)) {
      this.fgMap.set(token, fgAnsi(hex, mode))
    }
    for (const [token, hex] of Object.entries(BG_TOKENS)) {
      this.bgMap.set(token, bgAnsi(hex, mode))
    }
  }

  /** 用主题前景色包裹文本（只重置前景，保留粗体等修饰；无色模式原样返回） */
  fg(token: ThemeToken, text: string): string {
    const ansi = this.fgMap.get(token)
    return ansi ? ansi + text + FG_RESET : text
  }

  /** 用主题背景色包裹文本（只重置背景；无色模式原样返回） */
  bg(token: ThemeBgToken, text: string): string {
    const ansi = this.bgMap.get(token)
    return ansi ? ansi + text + BG_RESET : text
  }

  /** 取原始前景 ANSI 序列（用于组合常量，避免重复包裹） */
  getFgAnsi(token: ThemeToken): string {
    return this.fgMap.get(token) ?? ""
  }

  /** 取原始背景 ANSI 序列 */
  getBgAnsi(token: ThemeBgToken): string {
    return this.bgMap.get(token) ?? ""
  }

  bold(text: string): string {
    return this.mode === "none" ? text : `\x1b[1m${text}\x1b[22m`
  }

  italic(text: string): string {
    return this.mode === "none" ? text : `\x1b[3m${text}\x1b[23m`
  }

  underline(text: string): string {
    return this.mode === "none" ? text : `\x1b[4m${text}\x1b[24m`
  }

  strikethrough(text: string): string {
    return this.mode === "none" ? text : `\x1b[9m${text}\x1b[29m`
  }
}

/** 全局主题单例（默认"东京夜"；预留多主题切换扩展点） */
export const theme = new CliTheme()

// ============================================================================
// 向后兼容导出：既有 CLI 代码依赖 TokyoNight/Typography 语义键
// ============================================================================

/** 兼容语义键 → 东京夜 token（值已按色彩模式预算为 ANSI 序列） */
export const TokyoNight = {
  /** primary = darkStep9 */
  primary: theme.getFgAnsi("mdLink"),
  /** secondary = darkPurple */
  secondary: theme.getFgAnsi("mdHeading"),
  /** accent = darkOrange */
  accent: theme.getFgAnsi("accent"),
  /** 正文 = darkStep12 */
  text: theme.getFgAnsi("text"),
  /** 次要文字 = darkStep11 */
  textMuted: theme.getFgAnsi("muted"),
  error: theme.getFgAnsi("error"),
  warning: theme.getFgAnsi("warning"),
  success: theme.getFgAnsi("success"),
  info: theme.getFgAnsi("mdLink"),
  /** 高亮青 = darkCyan */
  cyan: theme.getFgAnsi("borderAccent"),
  /** 强调黄 = darkYellow */
  yellow: theme.getFgAnsi("mdQuote"),
  border: theme.getFgAnsi("border"),
} as const

/** 排印修饰（非颜色）；无色模式全量为空串，保证输出零转义序列 */
export const Typography: Record<string, string> =
  detectColorMode() === "none"
    ? { reset: "", bold: "", boldOff: "", dim: "", dimOff: "", italic: "", italicOff: "", underline: "", underlineOff: "", strikethrough: "", strikethroughOff: "" }
    : {
        reset: "\x1b[0m",
        bold: "\x1b[1m",
        boldOff: "\x1b[22m",
        dim: "\x1b[2m",
        dimOff: "\x1b[22m",
        italic: "\x1b[3m",
        italicOff: "\x1b[23m",
        underline: "\x1b[4m",
        underlineOff: "\x1b[24m",
        strikethrough: "\x1b[9m",
        strikethroughOff: "\x1b[29m",
      }

export type CliTheme = typeof TokyoNight

/** 兼容导出：当前主题（东京夜） */
export const currentTheme = theme
