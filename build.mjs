import { build } from "bun"
import { spawnSync } from "node:child_process"
import { rmSync } from "node:fs"
import solidPlugin from "./scripts/bun-solid-plugin.ts"

// 目标运行时策略（双运行时并存）：
// - 默认（GYC_RUNTIME 未设）：双构建 —— node 目标 → dist/（Node 跑非 TUI 命令，
//   低内存快启动）；bun 目标 → dist-bun/（Bun 跑 TUI，OpenTUI 原生渲染仅支持
//   Bun 的 bun:ffi，Node 无 node:ffi 模块）。
// - 设 GYC_RUNTIME=bun：只构建 Bun 目标 → dist/（回退到纯 Bun 运行）。
const runtime = process.env.GYC_RUNTIME ?? "node"

// 构建前重新生成 compose 技能 bundle，保证运行产物与 .bundle 目录一致。
const gen = spawnSync(process.execPath, ["scripts/gen-compose-bundle.mjs"], {
  stdio: "inherit",
  windowsHide: true,
})
if (gen.status !== 0) process.exit(gen.status ?? 1)

// 构建 webapp 并生成内嵌 Web UI 清单（serveUIEffect 托管）。GYCCODE_SKIP_WEBAPP=1 可跳过。
if (process.env.GYCCODE_SKIP_WEBAPP !== "1") {
  const web = spawnSync(process.execPath, ["scripts/build-webapp.mjs"], {
    stdio: "inherit",
    windowsHide: true,
  })
  if (web.status !== 0) process.exit(web.status ?? 1)
}

const SHARED = {
  entrypoints: ["./src/gyccode/index.ts", "./src/gyccode/cli/tui/worker.ts"],
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
    "koffi",
    "@koromix/koffi-*",
    "jsonc-parser",
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
  define: { GYCCODE_VERSION: '"0.0.1"' },
  plugins: [solidPlugin],
  minify: true,
}

// bun build 不清空 outdir，先清掉旧产物避免多轮构建残留叠加（曾致 dist 虚高 54MB/985 文件）。
async function buildOnce(targetRuntime, outdir) {
  rmSync(outdir, { recursive: true, force: true })
  await build({
    ...SHARED,
    outdir,
    target: targetRuntime === "node" ? "node" : "bun",
    // bun 目标附加 "bun" 条件：@opentui/* 等包在 Bun 下解析 bun 版产物
    // （与 dev 命令 --conditions=browser 的行为一致，bun 条件是 Bun 默认附加）。
    conditions: targetRuntime === "node" ? ["node", "browser"] : ["browser", "bun"],
  })
  // 写运行时标记，供 bin/gyc 按运行时选择产物（node 目标由 Node 直跑，bun 目标由 Bun 进程内加载）。
  await Bun.write(process.cwd() + `/${outdir}/RUNTIME`, targetRuntime)
  console.log(`build done: ${outdir} (${targetRuntime})`)
}

if (runtime === "node") {
  await buildOnce("node", "./dist")
  await buildOnce("bun", "./dist-bun")
} else {
  await buildOnce("bun", "./dist")
}
