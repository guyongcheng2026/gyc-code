import { useCallback, useEffect, useState } from "react"

const KEY = "gyc-web-theme"

// 三态主题（对齐 DSH ThemeRuntime）：light / dark / system（跟随 prefers-color-scheme 并实时监听变化）。
export type ThemePref = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

function systemTheme(): ResolvedTheme {
  return typeof matchMedia !== "undefined" && matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light"
}

function applyTheme(theme: ResolvedTheme) {
  document.documentElement.dataset.theme = theme
}

function readSaved(): ThemePref {
  try {
    const saved = typeof localStorage !== "undefined" ? localStorage.getItem(KEY) : null
    return saved === "dark" || saved === "light" || saved === "system" ? saved : "light"
  } catch {
    return "light"
  }
}

function persist(theme: ThemePref) {
  try {
    localStorage.setItem(KEY, theme)
  } catch {
    // 隐私模式/无存储时忽略
  }
}

export function useTheme() {
  const [pref, setPref] = useState<ThemePref>(readSaved)
  const [theme, setTheme] = useState<ResolvedTheme>(() => (readSaved() === "dark" ? "dark" : systemTheme()))

  // 应用解析后的主题；system 模式下监听系统配色变化
  useEffect(() => {
    const resolved = pref === "system" ? systemTheme() : pref
    setTheme(resolved)
    applyTheme(resolved)
    if (pref !== "system") return
    const mq = matchMedia("(prefers-color-scheme: dark)")
    const onChange = () => {
      const next = systemTheme()
      setTheme(next)
      applyTheme(next)
    }
    mq.addEventListener("change", onChange)
    return () => mq.removeEventListener("change", onChange)
  }, [pref])

  const cycle = useCallback(() => {
    setPref((prev) => {
      const next = prev === "light" ? "dark" : prev === "dark" ? "system" : "light"
      persist(next)
      return next
    })
  }, [])

  return { pref, theme, setPref, cycle }
}
