import * as monaco from "monaco-editor"
import { loader } from "@monaco-editor/react"

// @monaco-editor/loader 会自动配置 worker，无需手动 import editor.worker
loader.config({ monaco })

export { monaco }
