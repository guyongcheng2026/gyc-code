import { useCallback, useEffect, useState } from "react"
import type { ThemeName } from "../theme"

const KEY = "gyc-web-theme"

function applyTheme(theme: ThemeName) {
  document.documentElement.dataset.theme = theme
}

function readSaved(): ThemeName {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null
    return saved === "dark" || saved === "light" ? saved : "light"
  } catch {
    return "light"
  }
}

function persist(theme: ThemeName) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 隐私模式/无存储时忽略
  }
}

// 主题管理：默认亮色，localStorage 持久化，通过根元素 data-theme 切换 CSS 变量。
export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>(readSaved)

  useEffect(() => {
    applyTheme(theme)
  }, [theme])

  const toggle = useCallback(() => {
    setTheme((prev) => {
      const next = prev === "light" ? "dark" : "light"
      persist(next)
      return next
    })
  }, [])

  return { theme, setTheme, toggle }
}
