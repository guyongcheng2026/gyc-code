import * as monaco from "monaco-editor"
import { loader } from "@monaco-editor/react"
import editorWorker from "monaco-editor/esm/vs/editor/editor.worker?worker"

// Vite 下 monaco 需要显式装配 worker；v1 只用基础 editor.worker（文本编辑/行号），
// 语言 worker（TS/JSON/CSS）按需后续接入。
self.MonacoEnvironment = {
  getWorker: () => new editorWorker(),
}

loader.config({ monaco })

export { monaco }
