import { build } from "bun"
import { spawnSync } from "node:child_process"
import solidPlugin from "./scripts/bun-solid-plugin.ts"

// 构建前重新生成 compose 技能 bundle，保证运行产物与 .bundle 目录一致。
const gen = spawnSync(process.execPath, ["scripts/gen-compose-bundle.mjs"], {
  stdio: "inherit",
  windowsHide: true,
})
if (gen.status !== 0) process.exit(gen.status ?? 1)

await build({
  entrypoints: ["./src/gyccode/index.ts", "./src/gyccode/cli/tui/worker.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  splitting: true,
  external: ["@opentui/core-*"],
  conditions: ["browser"],
  define: { GYCCODE_VERSION: '"0.0.1"' },
  plugins: [solidPlugin],
  minify: true,
})
console.log("build done")
