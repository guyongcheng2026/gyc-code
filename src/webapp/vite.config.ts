import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  build: { outDir: "dist", target: "esnext" },
  server: { port: 8789, strictPort: true },
  // monaco-editor 无 main 字段，Vite 无法解析入口；仅将裸导入精确指到 ESM API 入口，
  // 子路径（如 editor.worker）不受影响。
  resolve: {
    alias: [{ find: /^monaco-editor$/, replacement: "monaco-editor/esm/vs/editor/editor.api" }],
  },
})
