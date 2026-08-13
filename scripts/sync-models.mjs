/**
 * sync-models.mjs — 同步模型目录到自建镜像
 *
 * 从上游公共模型清单（models.opencode.ai/api.json，中立数据）拉取，
 * 落盘到 models-mirror/api.json，供自托管镜像站点（与插件市场同站部署）。
 *
 * 用法：bun scripts/sync-models.mjs
 * 产物：models-mirror/api.json（Record<string, Provider>，客户端 models-dev 读取格式）
 *
 * 客户端使用镜像：GYCCODE_MODELS_URL=http://localhost:8790/models gyc ...
 */
import { mkdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..")
const OUT_DIR = join(ROOT, "models-mirror")
const OUT_FILE = join(OUT_DIR, "api.json")

const SOURCE = process.env.GYCCODE_MODELS_SOURCE ?? "https://models.opencode.ai/api.json"

const res = await fetch(SOURCE, {
  headers: { "user-agent": "gyc-code/models-mirror" },
  signal: AbortSignal.timeout(30_000),
})
if (!res.ok) {
  console.error(`[失败] 拉取 ${SOURCE} 返回 ${res.status}`)
  process.exit(1)
}

const text = await res.text()
let parsed
try {
  parsed = JSON.parse(text)
} catch {
  console.error("[失败] 响应不是合法 JSON")
  process.exit(1)
}

const providers = Object.keys(parsed)
const models = Object.values(parsed).reduce((sum, p) => sum + Object.keys(p.models ?? {}).length, 0)

mkdirSync(OUT_DIR, { recursive: true })
writeFileSync(OUT_FILE, JSON.stringify(parsed, null, 2), "utf8")
console.log(`[完成] 模型镜像已生成：${OUT_FILE}`)
console.log(`       供应商 ${providers.length} 个 / 模型 ${models} 个`)
console.log(`       部署：与插件市场同站托管，客户端设 GYCCODE_MODELS_URL=http://<host>/models 指向本目录`)
