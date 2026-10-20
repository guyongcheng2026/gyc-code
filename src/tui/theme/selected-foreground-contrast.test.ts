import { describe, expect, it } from "bun:test"
import { RGBA } from "@opentui/core"
import { contrastRatio, DEFAULT_THEMES, resolveTheme, selectedForeground } from "./index"

// 浅色主题下「选中项文字几乎不可见（反白）」的回归闸门。
//
// 根因：selectedForeground 对不透明主题直接返回 theme.selectedListItemText，
// 而该 token 缺省时等于 theme.background——即「选中前景 = 背景色」。浅色主题的
// 选中底色是 theme.primary，于是前景与底色的对比度实测仅 1.20~2.09。
//
// 修复：意图前景与实际底色对比度不足 3:1 时，按底色亮度取黑/白中对比度更高者。

const MIN_CONTRAST = 3

describe("选中项前景与底色的对比度", () => {
  it("全部内置主题 × dark/light：选中前景对选中底色的对比度不低于 3:1", () => {
    const failures: string[] = []
    for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
      for (const mode of ["dark", "light"] as const) {
        const theme = resolveTheme(json, mode)
        const foreground = selectedForeground(theme, theme.primary)
        const ratio = contrastRatio(foreground, theme.primary)
        if (ratio < MIN_CONTRAST) {
          failures.push(`${name}/${mode}=${ratio.toFixed(2)}`)
        }
      }
    }
    expect(
      failures,
      `以下主题的选中项前景与底色对比度不足 ${MIN_CONTRAST}:1：${failures.join("、")}`,
    ).toEqual([])
  })

  it("传入不同底色会得到不同前景（会话页按自定义色取前景的用法不回归）", () => {
    const theme = resolveTheme(DEFAULT_THEMES.gyccode!, "light")
    const onPrimary = selectedForeground(theme, theme.primary)
    const onWarning = selectedForeground(theme, theme.warning)
    expect(contrastRatio(onPrimary, theme.primary)).toBeGreaterThanOrEqual(MIN_CONTRAST)
    expect(contrastRatio(onWarning, theme.warning)).toBeGreaterThanOrEqual(MIN_CONTRAST)
  })

  it("dark 模式已达标的呈现不被改动（对比度达标即原样返回意图前景）", () => {
    for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
      const theme = resolveTheme(json, "dark")
      if (theme._hasSelectedListItemText) continue
      const intended = theme.selectedListItemText
      if (contrastRatio(intended, theme.primary) < MIN_CONTRAST) continue
      const actual = selectedForeground(theme, theme.primary)
      expect(actual.r, `主题 ${name} 的 dark 呈现被改动`).toBeCloseTo(intended.r, 5)
      expect(actual.g).toBeCloseTo(intended.g, 5)
      expect(actual.b).toBeCloseTo(intended.b, 5)
    }
  })

  it("主题显式定义 selectedListItemText 时尊重主题意图", () => {
    // orng / lucent-orng 显式定义了该 token，走 _hasSelectedListItemText 分支
    let checked = 0
    for (const [name, json] of Object.entries(DEFAULT_THEMES)) {
      const theme = resolveTheme(json, "light")
      if (!theme._hasSelectedListItemText) continue
      checked += 1
      expect(selectedForeground(theme, theme.primary).r).toBeCloseTo(
        theme.selectedListItemText.r,
        5,
      )
      expect(name.length).toBeGreaterThan(0)
    }
    expect(checked).toBeGreaterThan(0)
  })

  it("透明背景主题仍按底色亮度取黑/白（原行为不变）", () => {
    const transparent = {
      ...DEFAULT_THEMES.gyccode!,
      theme: {
        ...DEFAULT_THEMES.gyccode!.theme,
        background: "transparent",
      },
    }
    const theme = resolveTheme(transparent, "light")
    expect(theme.background.a).toBe(0)
    const foreground = selectedForeground(theme, RGBA.fromHex("#ffffff"))
    // 白色底 → 取黑字
    expect(foreground.r).toBe(0)
    expect(foreground.g).toBe(0)
    expect(foreground.b).toBe(0)
  })
})
