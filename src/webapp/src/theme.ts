// gyc web 视觉主题：gyc 品牌明暗配色（品牌橙 #D77757）+ 现代桌面编码助手布局
// 布局遵循现代编码助手桌面版（居中聊天列 + 左侧栏 + 底部圆角输入框）。默认亮色。

export type ThemeName = "light" | "dark"

type ThemeTokens = {
  brand: string
  brandShimmer: string
  text: string
  inverseText: string
  inactive: string
  subtle: string
  promptBorder: string
  success: string
  error: string
  warning: string
  permission: string
  planMode: string
  autoAccept: string
  diffAdded: string
  diffRemoved: string
  diffAddedDimmed: string
  diffRemovedDimmed: string
  diffAddedWord: string
  diffRemovedWord: string
  userMessageBackground: string
  userMessageBackgroundHover: string
  actionsBackground: string
  selectionBg: string
  bashMessageBackground: string
  appBackground: string
  panelBackground: string
  panelBackgroundHover: string
  border: string
  borderSubtle: string
  inputBackground: string
  codeBackground: string
  terminalBackground: string
}

// 亮色主题 + 应用级 token
export const lightTheme: ThemeTokens = {
  brand: "#D77757",
  brandShimmer: "#F59575",
  text: "#000000",
  inverseText: "#FFFFFF",
  inactive: "#666666",
  subtle: "#AFAFAF",
  promptBorder: "#999999",
  success: "#2C7A39",
  error: "#AB2B3F",
  warning: "#966C1E",
  permission: "#5769F7",
  planMode: "#006666",
  autoAccept: "#8700FF",
  diffAdded: "#69DB7C",
  diffRemoved: "#FFA8B4",
  diffAddedDimmed: "#C7E1CB",
  diffRemovedDimmed: "#FDD2D8",
  diffAddedWord: "#2F9D44",
  diffRemovedWord: "#D1454B",
  userMessageBackground: "#F0F0F0",
  userMessageBackgroundHover: "#FCFCFC",
  actionsBackground: "#E8ECF4",
  selectionBg: "#B4D5FF",
  bashMessageBackground: "#FAF5FA",
  appBackground: "#FFFFFF",
  panelBackground: "#F3F3F3",
  panelBackgroundHover: "#E8E8E8",
  border: "#D6D6D6",
  borderSubtle: "#E6E6E6",
  inputBackground: "#FFFFFF",
  codeBackground: "#F6F8FA",
  terminalBackground: "#FFFFFF",
}

// 深色主题 + 应用级 token
export const darkTheme: ThemeTokens = {
  brand: "#D77757",
  brandShimmer: "#EB9F7F",
  text: "#FFFFFF",
  inverseText: "#000000",
  inactive: "#999999",
  subtle: "#505050",
  promptBorder: "#888888",
  success: "#4EBA65",
  error: "#FF6B80",
  warning: "#FFC107",
  permission: "#B1B9F9",
  planMode: "#48968C",
  autoAccept: "#AF87FF",
  diffAdded: "#225C2B",
  diffRemoved: "#7A2936",
  diffAddedDimmed: "#47584A",
  diffRemovedDimmed: "#69484D",
  diffAddedWord: "#38A660",
  diffRemovedWord: "#B3596B",
  userMessageBackground: "#373737",
  userMessageBackgroundHover: "#464646",
  actionsBackground: "#2C323E",
  selectionBg: "#264F78",
  bashMessageBackground: "#413C41",
  appBackground: "#1E1E1E",
  panelBackground: "#252526",
  panelBackgroundHover: "#2A2D2E",
  border: "#3C3C3C",
  borderSubtle: "#2A2A2A",
  inputBackground: "#3C3C3C",
  codeBackground: "#1A1A1A",
  terminalBackground: "#0D1117",
}

export const themes: Record<ThemeName, ThemeTokens> = { light: lightTheme, dark: darkTheme }


