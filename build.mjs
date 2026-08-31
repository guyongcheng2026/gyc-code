import { build } from "bun"
import { spawnSync } from "node:child_process"
import { rmSync, cpSync, existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import os from "node:os"
import solidPlugin from "./scripts/bun-solid-plugin.ts"

// 目标运行时策略（统一 Node）：
// - 默认（GYC_RUNTIME 未设）：只构建 Node 目标 → dist/。TUI/--mini 也走
//   Node（OpenTUI 经 koffi 支持 Node 的 opentui.dll FFI），避免 Bun 常驻
//   内存回收不稳定（TUI 私有内存实测可达 1.6GB）。
// - 设 GYC_RUNTIME=bun：构建 Bun 目标 → dist/（回退到纯 Bun 运行）。
const runtime = process.env.GYC_RUNTIME ?? "node"

// 预处理仅父进程执行一次（子进程跳过，避免重复生成）。
if (process.env.GYCCODE_BUILD_CHILD !== "1") {
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
}

const SHARED = {
  entrypoints: ["./src/gyccode/index.ts", "./src/gyccode/cli/tui/worker.ts"],
  format: "esm",
  splitting: true,
  // 构建期 define 注入（P2-3）：版本号以 package.json 为单一事实来源（消除
  // 双源漂移），并注入构建目标运行时标记供诊断（GYC_RUNTIME 已是构建参数）。
  // 注：GYCCODE_* 行为开关不走 define——它们是用户运行时环境变量
  // （effect/runtime-flags.ts），构建期固化会破坏运行时可配置语义。
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
    // node-pty 是原生二进制（optional 依赖 @lydell/node-pty-win32-x64/conpty.node），
    // 打包进 dist 会破坏其内部 requireBinary 对原生模块的解析（PTY 500）。
    // external 化后 dist 运行时从 node_modules 解析（与 koffi 同模式）。
    "@lydell/node-pty",
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
    "@openrouter/ai-sdk-provider",
    "venice-ai-sdk-provider",
    "ai-gateway-provider",
    "@aws-sdk/credential-providers",
  ],
  define: {
    GYCCODE_VERSION: JSON.stringify(JSON.parse(readFileSync("package.json", "utf-8")).version),
    GYCCODE_BUILD_TARGET: JSON.stringify(runtime),
  },
  plugins: [solidPlugin],
  minify: true,
}

// 低内存构建模式：Bun 打包器的 splitting 分块输出阶段
// （breakOutputIntoPieces）在 4GB 机器系统 commit 紧张时（如可用 <1GB）
// 会 OOM panic（exit 3/9）。关闭 splitting 后两个入口各自内联完整产物
// （dist 体积约翻倍、动态导入仍保持惰性求值），绕开分块输出阶段，
// 构建内存峰值显著下降。
// GYCCODE_BUILD_LOW_MEM=1 手动开启；可用物理内存 <1.2GB 时自动降级。
const lowMemAuto = os.freemem() < 1.2 * 1024 * 1024 * 1024
const lowMem = process.env.GYCCODE_BUILD_LOW_MEM === "1" || lowMemAuto
if (lowMem && process.env.GYCCODE_BUILD_CHILD === "1") {
  console.log(
    `[build] 低内存模式${lowMemAuto ? `（自动触发：可用 ${Math.round(os.freemem() / 1024 / 1024)}MB < 1.2GB）` : "（GYCCODE_BUILD_LOW_MEM=1）"}：关闭 splitting，dist 体积将增大`,
  )
  SHARED.splitting = false
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
  // 复制 @opentui/core 运行时依赖的 parser.worker.js 和 assets 目录
  // OpenTUI 通过 new URL("./parser.worker.js", import.meta.url) 动态加载，
  // 不经过打包器，构建时需显式复制到 dist 根目录。
  copyOpentuiAssets(outdir)
  // 写运行时标记，供 bin/gyc 按运行时选择产物（node 目标由 Node 直跑，bun 目标由 Bun 进程内加载）。
  await Bun.write(process.cwd() + `/${outdir}/RUNTIME`, runtime)
  console.log(`build done: ${outdir} (${targetRuntime})`)
}

function copyOpentuiAssets(outdir) {
  try {
    // 查找 @opentui/core 包路径（bun 安装在 node_modules/.bun/...）
    const opentuiCorePaths = [
      join(process.cwd(), "node_modules", "@opentui", "core"),
      join(process.cwd(), "node_modules", ".bun", "@opentui+core@*", "node_modules", "@opentui", "core"),
    ]
    let srcDir = ""
    for (const p of opentuiCorePaths) {
      // 处理通配符路径
      if (p.includes("*")) {
        const base = join(process.cwd(), "node_modules", ".bun")
        if (existsSync(base)) {
          const entries = readdirSync(base)
          for (const entry of entries) {
            if (entry.startsWith("@opentui+core@")) {
              const candidate = join(base, entry, "node_modules", "@opentui", "core")
              if (existsSync(candidate)) {
                srcDir = candidate
                break
              }
            }
          }
        }
      } else if (existsSync(p)) {
        srcDir = p
        break
      }
    }
    if (!srcDir) {
      console.warn("[build] @opentui/core not found, skipping asset copy")
      return
    }
    // 复制 parser.worker.js
    const workerSrc = join(srcDir, "parser.worker.js")
    const workerDest = join(outdir, "parser.worker.js")
    if (existsSync(workerSrc)) {
      cpSync(workerSrc, workerDest, { force: true })
      console.log(`[build] copied parser.worker.js -> ${outdir}`)
    }
    // 复制 assets 目录（tree-sitter wasm 等）
    const assetsSrc = join(srcDir, "assets")
    const assetsDest = join(outdir, "assets")
    if (existsSync(assetsSrc)) {
      cpSync(assetsSrc, assetsDest, { recursive: true, force: true })
      console.log(`[build] copied assets/ -> ${outdir}`)
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.warn("[build] failed to copy opentui assets:", msg)
  }
}

async function runBuild() {
  if (runtime === "node") {
    // TUI/--mini 也走 Node 目标：OpenTUI 经 koffi 支持 Node，无需 dist-bun（Bun 目标）。
    await buildOnce("node", "./dist")
  } else {
    await buildOnce("bun", "./dist")
  }
}

if (process.env.GYCCODE_BUILD_CHILD === "1") {
  // 子进程：真正执行构建
  await runBuild()
} else {
  // 父进程：Bun 打包器 OOM panic 会直接杀死进程（exit 3/9），脚本内无法
  // catch。用子进程执行构建：正常崩溃（疑似内存不足）时自动以低内存模式
  // （关闭 splitting）重试一次，避免 4GB 机器内存紧张时构建彻底失败。
  const tryBuild = (extraEnv) =>
    spawnSync(process.execPath, ["build.mjs"], {
      stdio: "inherit",
      env: { ...process.env, GYCCODE_BUILD_CHILD: "1", ...extraEnv },
    })
  let result = tryBuild(process.env.GYCCODE_BUILD_LOW_MEM === "1" ? { GYCCODE_BUILD_LOW_MEM: "1" } : {})
  if (result.status !== 0 && process.env.GYCCODE_BUILD_LOW_MEM !== "1") {
    console.log("")
    console.log("[build] 构建失败（疑似内存不足触发 Bun 打包器 OOM panic），自动重试低内存模式（关闭 splitting）...")
    result = tryBuild({ GYCCODE_BUILD_LOW_MEM: "1" })
  }
  if (result.status !== 0) process.exit(result.status ?? 1)
}
