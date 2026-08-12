/**
 * gyc-code 自建分享服务（替代第三方分享站）
 *
 * - 技术栈：Bun + bun:sqlite，零 npm 依赖
 * - 端口：8788（可用 GYCCODE_SHARE_PORT 覆盖）
 * - 协议：与 ShareNext 模块对齐（POST /api/share、/api/share/{id}/sync、DELETE、/s/{id} 渲染页）
 *
 * 启动：bun services/share/server.ts
 * 客户端：export GYCCODE_SHARE_URL=http://localhost:8788
 */
import { Database } from "bun:sqlite"
import { randomBytes } from "node:crypto"

const PORT = Number(process.env.GYCCODE_SHARE_PORT ?? 8788)
const BASE = `http://localhost:${PORT}`

const db = new Database("services/share/gyccode-share.db")
db.exec(`
  CREATE TABLE IF NOT EXISTS shares (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    secret TEXT NOT NULL,
    data_json TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL
  );
`)

const rand = (bytes: number) => randomBytes(bytes).toString("hex")
const shortId = () => randomBytes(5).toString("base64url")

function json(res: Response, status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

async function readBody(req: Request): Promise<Record<string, unknown>> {
  try {
    return (await req.json()) as Record<string, unknown>
  } catch {
    return {}
  }
}

function esc(value: unknown): string {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
}

// ---------- 分享 API ----------

function handleCreate(body: Record<string, unknown>): Response {
  const id = shortId()
  const secret = rand(24)
  const sessionId = String(body.sessionID ?? "")
  db.prepare("INSERT INTO shares (id, session_id, secret, data_json, created_at) VALUES (?, ?, ?, '{}', ?)").run(
    id, sessionId, secret, Date.now(),
  )
  return json(new Response(), 200, { id, url: `${BASE}/s/${id}`, secret })
}

function handleSync(id: string, body: Record<string, unknown>): Response {
  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as { secret: string } | undefined
  if (!row) return json(new Response(), 404, { error: "not_found" })
  if (String(body.secret ?? "") !== row.secret) return json(new Response(), 403, { error: "forbidden" })
  db.prepare("UPDATE shares SET data_json = ? WHERE id = ?").run(JSON.stringify(body.data ?? {}), id)
  return json(new Response(), 200, { ok: true })
}

function handleRemove(id: string, body: Record<string, unknown>): Response {
  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as { secret: string } | undefined
  if (!row) return json(new Response(), 404, { error: "not_found" })
  if (String(body.secret ?? "") !== row.secret) return json(new Response(), 403, { error: "forbidden" })
  db.prepare("DELETE FROM shares WHERE id = ?").run(id)
  return json(new Response(), 200, { ok: true })
}

function handleData(id: string): Response {
  const row = db.prepare("SELECT data_json FROM shares WHERE id = ?").get(id) as { data_json: string } | undefined
  if (!row) return json(new Response(), 404, { error: "not_found" })
  return json(new Response(), 200, JSON.parse(row.data_json))
}

// ---------- 渲染页 ----------

function renderPage(id: string): Response {
  const row = db.prepare("SELECT * FROM shares WHERE id = ?").get(id) as
    | { session_id: string; data_json: string; created_at: number }
    | undefined
  if (!row) {
    return new Response(`<!doctype html><meta charset="utf-8"><title>分享不存在</title><h1>分享不存在或已删除</h1>`, {
      status: 404,
      headers: { "content-type": "text/html; charset=utf-8" },
    })
  }

  let data: Record<string, unknown> = {}
  try {
    data = JSON.parse(row.data_json) as Record<string, unknown>
  } catch {
    data = {}
  }

  // 客户端同步格式：sync 直接存 data 数组（[{ type: "session"|"message"|..., data: ... }]）
  const rawList = Array.isArray(data)
    ? data
    : Array.isArray((data as Record<string, unknown>).data)
      ? ((data as Record<string, unknown>).data as Record<string, unknown>[])
      : []
  const messages = rawList
    .filter((item) => item.type === "message")
    .map((item) => item.data as Record<string, unknown>)
  const rows = messages
    .map((item) => {
      const role = esc(item.role ?? "unknown")
      const text = esc(item.text ?? "")
      const color = role === "user" ? "#1a7f37" : role === "assistant" ? "#1a56db" : "#6b7280"
      const label = role === "user" ? "用户" : role === "assistant" ? "助手" : role
      return `<div style="border-left:3px solid ${color};padding:8px 14px;margin:10px 0;background:#f8f9fa;border-radius:6px">
        <div style="font-size:12px;color:#6b7280;margin-bottom:4px">${label}</div>
        <pre style="white-space:pre-wrap;font-family:inherit;margin:0">${text}</pre>
      </div>`
    })
    .join("\n")

  return new Response(
    `<!doctype html>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>gyc-code 会话分享</title>
<style>body{font-family:system-ui;max-width:760px;margin:40px auto;padding:0 16px;line-height:1.7}h1{font-size:20px}pre{font-family:ui-monospace,monospace}</style>
<h1>gyc-code 会话分享</h1>
<p style="color:#6b7280;font-size:13px">会话 ${esc(row.session_id)} · 创建于 ${new Date(row.created_at).toLocaleString()}</p>
${rows || "<p style='color:#6b7280'>暂无内容</p>"}
<p style="color:#9ca3af;font-size:12px;margin-top:32px">由 gyc-code 分享服务渲染</p>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  )
}

// ---------- 路由 ----------

const server = Bun.serve({
  port: PORT,
  async fetch(req) {
    const url = new URL(req.url)
    const path = url.pathname

    if (path === "/health") return json(new Response(), 200, { ok: true })

    // 创建分享
    if (path === "/api/share" && req.method === "POST") return handleCreate(await readBody(req))

    // 数据同步 / 删除 / 读取
    const syncMatch = path.match(/^\/api\/share\/([^/]+)\/sync$/)
    if (syncMatch && req.method === "POST") return handleSync(syncMatch[1], await readBody(req))
    const deleteMatch = path.match(/^\/api\/share\/([^/]+)$/)
    if (deleteMatch && req.method === "DELETE") return handleRemove(deleteMatch[1], await readBody(req))
    const dataMatch = path.match(/^\/api\/share\/([^/]+)\/data$/)
    if (dataMatch && req.method === "GET") return handleData(dataMatch[1])

    // 渲染页
    const pageMatch = path.match(/^\/s\/([^/]+)$/)
    if (pageMatch && req.method === "GET") return renderPage(pageMatch[1])

    return json(new Response(), 404, { error: "not_found" })
  },
})

console.log(`[gyc-code 分享服务] 运行于 ${BASE}（GYCCODE_SHARE_URL 指向此地址）`)
console.log(`  创建: POST /api/share · 同步: POST /api/share/{id}/sync · 渲染: GET /s/{id}`)
console.log(`  Ctrl+C 停止`)
