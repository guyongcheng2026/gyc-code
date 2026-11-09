注：因本机 git 故障，本次仅基于当前文件内容审查，未含100天变更历史维度

# 问题1：resolveColor 对残缺 dark/light Variant 无防护，畸形主题在指定模式下抛 TypeError 击穿主题解析 2级
## 问题1分析:
`src/tui/theme/index.ts:287-319` 的 `resolveColor` 对 `ColorValue` 的分派为：RGBA → string → number → 兜底 `return resolveColor(c[mode], chain)`（318 行）。最后这条分支假定 `c` 一定是 `{ dark, light }` 双键 Variant；若主题 JSON 里某 token 只写了单模式（如 `"warning": { "dark": "#ff0000" }`），在 `mode === "light"` 下 `c[mode]` 为 `undefined`，递归进入后 `undefined` 不命中前三条分支，再次执行 `c[mode]` 即读取 `undefined["light"]`，抛 `TypeError: Cannot read properties of undefined`。

校验函数 `isTheme`（228-244 行）只对 `REQUIRED_THEME_TOKENS` 四个 token（text/background/primary/markdownText，226 行）做 Variant 双键完整性检查，**其余 60+ 个颜色 token 的 Variant 不校验**；而 `setCustomThemes`/`addTheme`/`upsertTheme`（251-285 行）都以 `isTheme` 为唯一准入门槛——用户手工编辑的自定义主题文件（customThemes 来源）缺一个 `light` 键即可通过准入，并在 `resolveTheme` 求值时崩溃。304-307 行对「token 缺失」有回退到内置主题的兜底，但对「Variant 半缺」这一形态没有覆盖，属兜底盲区。

### 问题1修复后的代码：
```diff
     if (typeof c === "number") {
       return ansiToRgba(c)
     }
 -    return resolveColor(c[mode], chain)
 +    // Variant 可能只写了单模式（isTheme 仅校验 4 个必需 token），
 +    // 缺当前模式的键时不能把 undefined 再递归下去读属性：
 +    // 先回退到另一模式，两侧都缺则回退到同 311 行的对比色兜底。
 +    const variantValue = c[mode] ?? c[mode === "dark" ? "light" : "dark"]
 +    if (variantValue === undefined) {
 +      return mode === "light" ? RGBA.fromInts(0, 0, 0) : RGBA.fromInts(255, 255, 255)
 +    }
 +    return resolveColor(variantValue, chain)
    }
 ```
 > 说明：回退口径与同函数既有的两处兜底保持一致——304-307 行（缺 token 回退内置主题）与 311 行（最终回退当前模式对比色），避免半缺 Variant 直接以 TypeError 击穿主题装配；同时该形态绕过了 `isTheme`（226 行仅校验 4 个必需 token）的准入盲区，运行期兜底是最后一道防线。

---
# 问题2：generateSystem 用非空断言取终端调色板，palette 缺失时 RGBA.fromHex(undefined) 崩溃 3级
## 问题2分析:
`src/tui/theme/index.ts:416-417`：

```ts
const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
```

当终端既未上报 `defaultBackground/defaultForeground`、又缺失对应下标的 palette 项时，`palette[0]!` 断言掩盖了 `undefined`，`RGBA.fromHex(undefined)` 在运行期抛错。同函数对 palette 的其他消费点均有防御：421-425 行 `col(i)` 取不到值会回退 `ansiToRgba(i)`，416 行的 `?? colors.palette[0]!` 却把兜底链终点交给了断言。该路径发生在系统主题生成（`generateSystem`），崩溃点在启动主题装配链路上。属类型不安全（`!` 断言）叠加健壮性缺陷。

### 问题2修复后的代码：
```diff
 export function generateSystem(colors: TerminalColors, mode: "dark" | "light"): ThemeJson {
-  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0]!)
-  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7]!)
+  // palette 项可能缺失（与 col() 的 ansiToRgba 回退保持同一口径），
+  // 非空断言会把 undefined 递给 fromHex 造成启动期崩溃。
+  const bg = RGBA.fromHex(colors.defaultBackground ?? colors.palette[0] ?? "#000000")
+  const fg = RGBA.fromHex(colors.defaultForeground ?? colors.palette[7] ?? "#ffffff")
   const transparent = RGBA.fromValues(bg.r, bg.g, bg.b, 0)
   const isDark = mode == "dark"
```
