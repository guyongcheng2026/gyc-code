import { build } from "bun"
import solidPlugin from "./scripts/bun-solid-plugin.ts"

await build({
  entrypoints: ["./src/opencode/index.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  splitting: true,
  external: ["@opentui/core-*"],
  conditions: ["browser"],
  define: { OPENCODE_VERSION: '"0.0.1"' },
  plugins: [solidPlugin],
})
console.log("build done")