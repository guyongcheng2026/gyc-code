import { useEffect, useState } from "react"
import Editor, { loader } from "@monaco-editor/react"
import { useFileContent } from "../client/useFileContent"

const LANG_BY_EXT: Record<string, string> = {
  ts: "typescript", tsx: "typescript", js: "javascript", jsx: "javascript",
  json: "json", md: "markdown", css: "css", html: "html", sh: "shell", bash: "shell",
  py: "python", rs: "rust", go: "go", java: "java", yml: "yaml", yaml: "yaml",
  sql: "sql", c: "c", h: "c", cpp: "cpp", toml: "ini", mjs: "javascript", cjs: "javascript",
}

function guessLanguage(path: string): string {
  const dot = path.lastIndexOf(".")
  if (dot < 0) return "plaintext"
  const ext = path.slice(dot + 1).toLowerCase()
  return LANG_BY_EXT[ext] ?? "plaintext"
}

export function FileViewer({ path, directory }: { path: string; directory?: string }) {
  const { content, loading, error } = useFileContent(path, directory)
  const [monacoReady, setMonacoReady] = useState(false)

  // 按需加载 monaco：首次打开文件时才下载编辑器内核（setup 会配置 loader 与 worker）。
  useEffect(() => {
    let cancelled = false
    void import("../monaco/setup")
      .then(() => loader.init())
      .then(
        () => { if (!cancelled) setMonacoReady(true) },
        () => { if (!cancelled) setMonacoReady(false) },
      )
    return () => { cancelled = true }
  }, [])

  if (loading) return <div style={{ padding: 24 }}>加载中…</div>
  if (error) return <div style={{ padding: 24, color: "var(--error)" }}>{error}</div>
  if (!content) return null

  // monaco 未就绪时回退纯文本预览
  if (!monacoReady) {
    return (
      <pre style={{ padding: 16, overflow: "auto", margin: 0, whiteSpace: "pre-wrap", fontFamily: "monospace", fontSize: 13 }}>
        {content.content}
      </pre>
    )
  }

  return (
    <Editor
      height="100%"
      defaultLanguage={guessLanguage(path)}
      value={content.content}
      theme="vs-dark"
      options={{ readOnly: true, minimap: { enabled: false }, fontSize: 13 }}
    />
  )
}

