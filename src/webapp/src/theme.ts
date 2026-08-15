// gyc web 视觉主题：Claude Code 深色主题配色（提取自 reference utils/theme.ts darkTheme）
// 布局遵循 Codex 桌面版（居中聊天列 + 左侧栏 + 底部圆角输入框）。
export const theme = {
  // Claude 品牌橙
  claude: "#D77757",
  claudeShimmer: "#EB9F7F",
  // 文字
  text: "#FFFFFF",
  inverseText: "#000000",
  inactive: "#999999",
  subtle: "#505050",
  promptBorder: "#888888",
  // 语义色
  success: "#4EBA65",
  error: "#FF6B80",
  warning: "#FFC107",
  permission: "#B1B9F9",
  suggestion: "#B1B9F9",
  planMode: "#48968C",
  autoAccept: "#AF87FF",
  // Diff
  diffAdded: "#225C2B",
  diffRemoved: "#7A2936",
  diffAddedDimmed: "#47584A",
  diffRemovedDimmed: "#69484D",
  diffAddedWord: "#38A660",
  diffRemovedWord: "#B3596B",
  // 背景
  userMessageBackground: "#373737",
  userMessageBackgroundHover: "#464646",
  messageActionsBackground: "#2C323E",
  selectionBg: "#264F78",
  bashMessageBackground: "#413C41",
  memoryBackground: "#374146",
  // 子代理色
  agent: {
    red: "#DC2626",
    blue: "#2563EB",
    green: "#16A34A",
    yellow: "#CA8A04",
    purple: "#9333EA",
    orange: "#EA580C",
    pink: "#DB2777",
    cyan: "#0891B2",
  },
  // 应用级（web 端）
  appBackground: "#1E1E1E",
  panelBackground: "#252526",
  panelBackgroundHover: "#2A2D2E",
  border: "#3C3C3C",
  borderSubtle: "#2A2A2A",
  inputBackground: "#3C3C3C",
  inputBackgroundHover: "#464646",
  codeBackground: "#1A1A1A",
  terminalBackground: "#0D1117",
} as const

export type ThemeTokens = typeof theme
