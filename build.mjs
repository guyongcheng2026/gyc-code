import { build } from "bun"
import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import solidPlugin from "./scripts/bun-solid-plugin.ts"

// 构建前重新生成 compose 技能 bundle，保证运行产物与 .bundle 目录一致。
const gen = spawnSync(process.execPath, ["scripts/gen-compose-bundle.mjs"], {
  stdio: "inherit",
  windowsHide: true,
})
if (gen.status !== 0) process.exit(gen.status ?? 1)

// bun build 不清空 outdir，先清掉旧产物避免多轮构建残留叠加（曾致 dist 虚高 54MB/985 文件）。
rmSync("./dist", { recursive: true, force: true })

await build({
  entrypoints: ["./src/gyccode/index.ts", "./src/gyccode/cli/tui/worker.ts"],
  outdir: "./dist",
  target: "bun",
  format: "esm",
  splitting: true,
  // Provider factory SDKs are externalized and resolved at runtime from
  // node_modules (installed alongside the CLI) or via Npm.add on-demand
  // install. This keeps dist slim: 25+ provider factories would otherwise each
  // be inlined with their dependency tree (~2.2MB each), bloating dist to
  // ~245MB. NOTE: `ai`, `@ai-sdk/provider`, `@ai-sdk/provider-utils` are CORE
  // runtime imports (static) and MUST stay inlined; only the *_factory* entry
  // packages are externalized.
  external: [
    "@opentui/core-*",
    "@ai-sdk/amazon-bedrock",
    "@ai-sdk/anthropic",
    "@ai-sdk/azure",
    "@ai-sdk/google",
    "@ai-sdk/google-vertex",
    "@ai-sdk/openai",
    "@ai-sdk/openai-compatible",
    "@ai-sdk/xai",
    "@ai-sdk/mistral",
    "@ai-sdk/groq",
    "@ai-sdk/deepinfra",
    "@ai-sdk/cerebras",
    "@ai-sdk/cohere",
    "@ai-sdk/gateway",
    "@ai-sdk/togetherai",
    "@ai-sdk/perplexity",
    "@ai-sdk/vercel",
    "@ai-sdk/alibaba",
    "@openrouter/ai-sdk-provider",
    "venice-ai-sdk-provider",
    "ai-gateway-provider",
    "@aws-sdk/credential-providers",
  ],
  conditions: ["browser"],
  define: { GYCCODE_VERSION: '"0.0.1"' },
  plugins: [solidPlugin],
  minify: true,
})
console.log("build done")
