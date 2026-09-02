import { createHighlighterCore, type HighlighterCore } from "shiki/core"
import { createJavaScriptRegexEngine } from "shiki/engine/javascript"
import type { LanguageInput } from "shiki/types"

/**
 * shiki 懒加载高亮器（对齐 DSH「已注册语法使用 shiki」约定）：
 * - JS regex 引擎（免 wasm，浏览器原生）
 * - 首个代码块才初始化 core；语言按需注册（vite 静态动态 import，逐语言 code-split）
 * - 结果缓存（lang:theme:code → html）：流式重析时同内容块不重复高亮
 */

// 常用语言白名单：覆盖编码助手场景 99% 的围栏代码块
const LANG_LOADERS: Record<string, () => Promise<LanguageInput>> = {
  typescript: () => import("shiki/langs/typescript.mjs"),
  tsx: () => import("shiki/langs/tsx.mjs"),
  javascript: () => import("shiki/langs/javascript.mjs"),
  jsx: () => import("shiki/langs/jsx.mjs"),
  json: () => import("shiki/langs/json.mjs"),
  jsonc: () => import("shiki/langs/jsonc.mjs"),
  yaml: () => import("shiki/langs/yaml.mjs"),
  toml: () => import("shiki/langs/toml.mjs"),
  css: () => import("shiki/langs/css.mjs"),
  html: () => import("shiki/langs/html.mjs"),
  xml: () => import("shiki/langs/xml.mjs"),
  markdown: () => import("shiki/langs/markdown.mjs"),
  python: () => import("shiki/langs/python.mjs"),
  bash: () => import("shiki/langs/bash.mjs"),
  shell: () => import("shiki/langs/shellscript.mjs"),
  powershell: () => import("shiki/langs/powershell.mjs"),
  sql: () => import("shiki/langs/sql.mjs"),
  diff: () => import("shiki/langs/diff.mjs"),
  rust: () => import("shiki/langs/rust.mjs"),
  go: () => import("shiki/langs/go.mjs"),
  java: () => import("shiki/langs/java.mjs"),
  c: () => import("shiki/langs/c.mjs"),
  cpp: () => import("shiki/langs/cpp.mjs"),
  csharp: () => import("shiki/langs/csharp.mjs"),
}

const ALIASES: Record<string, string> = {
  ts: "typescript",
  js: "javascript",
  mjs: "javascript",
  cjs: "javascript",
  py: "python",
  sh: "bash",
  zsh: "bash",
  ps1: "powershell",
  pwsh: "powershell",
  yml: "yaml",
  md: "markdown",
  "c++": "cpp",
  golang: "go",
  text: "",
  txt: "",
  plaintext: "",
}

let corePromise: Promise<HighlighterCore> | undefined
const registered = new Set<string>()
const cache = new Map<string, string>()

function currentTheme(): "github-light" | "github-dark" {
  return document.documentElement.dataset.theme === "dark" ? "github-dark" : "github-light"
}

export function supportedLang(raw: string | undefined): string | null {
  const lang = (raw ?? "").toLowerCase().trim()
  if (!lang) return null
  const resolved = ALIASES[lang] ?? lang
  return LANG_LOADERS[resolved] ? resolved : null
}

async function ensureCore(): Promise<HighlighterCore> {
  corePromise ??= createHighlighterCore({
    themes: [import("shiki/themes/github-light.mjs"), import("shiki/themes/github-dark.mjs")],
    langs: [],
    engine: createJavaScriptRegexEngine(),
  })
  return corePromise
}

export async function highlightCode(code: string, lang: string): Promise<string | null> {
  const id = supportedLang(lang)
  if (!id) return null
  const theme = currentTheme()
  const key = `${id}:${theme}:${code}`
  const hit = cache.get(key)
  if (hit !== undefined) return hit
  try {
    const core = await ensureCore()
    if (!registered.has(id)) {
      await core.loadLanguage(await LANG_LOADERS[id]!())
      registered.add(id)
    }
    const html = core.codeToHtml(code, { lang: id, theme })
    if (cache.size > 300) {
      const firstKey = cache.keys().next().value
      if (firstKey !== undefined) cache.delete(firstKey)
    }
    cache.set(key, html)
    return html
  } catch {
    return null // 高亮失败降级为纯文本
  }
}
