/**
 * serve-marketplace.mjs — 本地托管 gyc 插件市场（静态站点）
 *
 * 用法：bun scripts/serve-marketplace.mjs [端口]
 * 默认端口 8790。启动后：
 *   GET /index.json      → 市场索引
 *   GET /pkg/<name>-<v>.tgz → 插件包下载
 *
 * 客户端本地测试：GYCCODE_PLUGIN_REGISTRY=http://localhost:8790/index.json gyc plugin search xxx
 */
import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { existsSync } from "node:fs"
import { extname, join, normalize, resolve } from "node:path"

const ROOT = resolve(import.meta.dirname, "..", "marketplace")
const MODELS_ROOT = resolve(import.meta.dirname, "..", "models-mirror")
const PORT = Number(process.argv[2] ?? 8790)

const MIME = {
  ".json": "application/json",
  ".tgz": "application/gzip",
  ".md": "text/markdown; charset=utf-8",
  ".html": "text/html; charset=utf-8",
}

createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`)
    // /models/* 指向模型镜像，其余指向插件市场
    const base = url.pathname.startsWith("/models") ? MODELS_ROOT : ROOT
    // 防目录穿越：只允许根目录内的相对路径
    const rel = normalize(url.pathname).replace(/^[/\\]+/, "").replace(/^models[/\\]/, "")
    const file = resolve(base, rel)
    if (!file.startsWith(base) || !existsSync(file)) {
      res.writeHead(404, { "content-type": "text/plain" })
      res.end("not found")
      return
    }
    const body = await readFile(file)
    res.writeHead(200, { "content-type": MIME[extname(file)] ?? "application/octet-stream" })
    res.end(body)
  } catch (error) {
    res.writeHead(500, { "content-type": "text/plain" })
    res.end(String(error))
  }
}).listen(PORT, () => {
  console.log(`gyc 插件市场已启动：http://localhost:${PORT}`)
  console.log(`  索引：http://localhost:${PORT}/index.json`)
  console.log(`  模型镜像：http://localhost:${PORT}/models/api.json`)
  console.log(`  停止：Ctrl+C`)
})
