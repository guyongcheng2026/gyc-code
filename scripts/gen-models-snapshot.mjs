/**
 * gen-models-snapshot.mjs — 生成内置模型快照（无网络兜底）
 *
 * 从 models-mirror/api.json 筛选主流供应商（国内+国际白名单），
 * 生成 src/core/models-dev-snapshot.ts，bundle 打包进 CLI：
 * - 无网络/网络差时 models 仍有主流模型可用（fallback 链 disk → snapshot → fetch）
 * - 网络好时 fetch 镜像更新缓存，快照仅作兜底
 *
 * 用法：bun scripts/sync-models.mjs && bun scripts/gen-models-snapshot.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const MIRROR = join(ROOT, "models-mirror", "api.json")
const OUT = join(ROOT, "src", "core", "models-dev-snapshot.ts")

// 主流供应商白名单（国内生态 + 国际通用），覆盖 95% 以上实际使用场景
const WHITELIST = [
  // 国内
  "zhipuai", "deepseek", "moonshotai", "moonshotai-cn",
  "minimax", "minimax-cn", "stepfun", "siliconflow", "modelscope", "qiniu-ai", "xiaomi",
  // 国际
  "anthropic", "openai", "google", "meta", "mistral", "cohere", "nvidia", "xai",
  "groq", "openrouter", "huggingface", "togetherai", "amazon-bedrock", "azure",
  "cloudflare-ai-gateway", "fireworks-ai", "deepinfra", "cerebras", "perplexity",
]

const mirror = JSON.parse(await import("node:fs/promises").then((m) => m.readFile(MIRROR, "utf8")))
const picked = Object.fromEntries(WHITELIST.filter((k) => mirror[k]).map((k) => [k, mirror[k]]))
const missing = WHITELIST.filter((k) => !mirror[k])
if (missing.length) console.warn(`[警告] 白名单未命中：${missing.join(", ")}`)

const models = Object.values(picked).reduce((s, p) => s + Object.keys(p.models).length, 0)
const body = `/**
 * models-dev-snapshot.ts — 内置模型快照（自动生成，勿手改）
 *
 * 来源：scripts/gen-models-snapshot.mjs（由 models-mirror/api.json 筛选主流供应商生成）
 * 作用：无网络兜底（fallback 链 disk → snapshot → fetch），网络可用时 fetch 镜像更新
 * 规模：${Object.keys(picked).length} 供应商 / ${models} 模型
 */

export const MODELS_DEV_SNAPSHOT: Record<string, unknown> = ${JSON.stringify(picked)}
`

mkdirSync(dirname(OUT), { recursive: true })
writeFileSync(OUT, body, "utf8")
console.log(`[完成] 内置快照已生成：${OUT}`)
console.log(`       供应商 ${Object.keys(picked).length} 个 / 模型 ${models} 个 / ${(body.length / 1024).toFixed(0)} KB`)
