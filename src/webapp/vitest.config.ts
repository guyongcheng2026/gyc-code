import { defineConfig } from "vitest/config"
import react from "@vitejs/plugin-react"
import { fileURLToPath } from "node:url"

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: false,
    setupFiles: [fileURLToPath(new URL("./vitest.setup.ts", import.meta.url))],
  },
  resolve: {
    alias: [{ find: /^monaco-editor$/, replacement: "monaco-editor/esm/vs/editor/editor.api" }],
  },
})
