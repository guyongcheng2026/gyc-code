#!/usr/bin/env bun
// 合成超长会话生成器（U-3 压测基建，只写 --db 指定的临时库，绝不触生产库）
// 用法：
//   bun scripts/gen-synthetic-session.mjs --db <path> --session <id> \
//     --messages 4000 --parts 11600 --part-bytes-mb 19.5
// 产出的库结构与会话加载路径（SessionHistory.load）对齐：
//   - session_message 行（data 列不含 id/type，decode 时由列注入）
//   - session_context_epoch 空表（load 查询需要表存在）
import { Database } from "bun:sqlite"
import { Schema } from "effect"
import { SessionMessage } from "../src/schema/session-message"

const args = (argv) => {
  const out = {}
  for (let i = 2; i < argv.length; i++) {
    const k = argv[i]
    if (!k.startsWith("--")) continue
    const next = argv[i + 1]
    out[k.slice(2)] = next && !next.startsWith("--") ? next : true
  }
  return out
}
const a = args(process.argv)

const dbPath = a.db ?? "C:/Users/Administrator/AppData/Local/Temp/gyccode/synthetic-1.5x.db"
const sessionID = a.session ?? "ses_synthetic_1_5x"
const messages = Number(a.messages ?? 4000)
const parts = Number(a.parts ?? 11600)
const partBytes = Math.round(Number(a["part-bytes-mb"] ?? 19.5) * 1024 * 1024)

const DDL = [
  `CREATE TABLE IF NOT EXISTS session_message (
    id text PRIMARY KEY, session_id text NOT NULL, type text NOT NULL, seq integer NOT NULL,
    time_created integer NOT NULL, time_updated integer NOT NULL, data text NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS session_context_epoch (
    session_id text PRIMARY KEY, baseline text NOT NULL, snapshot text NOT NULL, baseline_seq integer NOT NULL)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS session_message_session_seq_idx ON session_message (session_id, seq)`,
  `CREATE INDEX IF NOT EXISTS session_message_session_type_seq_idx ON session_message (session_id, type, seq)`,
]

const decode = Schema.decodeUnknownSync(SessionMessage.Message)
const now = Date.now()
const pad = (n) => String(n).padStart(6, "0")

// 工具输出文本：按目标总量均摊到每个 tool part
const avgPartChars = Math.max(32, Math.floor(partBytes / Math.max(1, parts)))
const filler = ("x".repeat(96) + " 压测填充 ").repeat(Math.ceil(avgPartChars / 100)).slice(0, avgPartChars)
const toolNames = ["read", "grep", "glob", "bash", "edit"]
// running 残留比例约 0.6%（对应生产 24 条 / 4000 量级），用于在真实加载路径上检验对账
const runningEvery = Math.floor(messages / Math.max(24, Math.floor(messages * 0.006)))

const sqlite = new Database(dbPath)
sqlite.exec("PRAGMA journal_mode = WAL")
for (const ddl of DDL) sqlite.exec(ddl)

const insert = sqlite.prepare(
  `INSERT INTO session_message (id, session_id, type, seq, time_created, time_updated, data)
   VALUES (?, ?, ?, ?, ?, ?, ?)`,
)

const tx = sqlite.transaction(() => {
  let seq = 0
  let partsMade = 0
  let bytes = 0
  let runningCount = 0
  const samples = []
  for (let i = 0; i < messages && partsMade < parts; i++) {
    const t = now - (messages - i) * 1000
    // 用户消息
    {
      const id = `msg_u_${pad(seq)}`
      const data = { text: `压测用户输入 #${i}，用于构造 1.5x 超长会话。`, time: { created: t } }
      decode({ ...data, id, type: "user" })
      insert.run(id, sessionID, "user", seq++, t, t, JSON.stringify(data))
    }
    // 助手消息：5~6 个 tool part + 一段文本
    const toolCount = Math.min(6, parts - partsMade)
    const content = []
    for (let p = 0; p < toolCount; p++) {
      const isRunning = i % runningEvery === 0 && p === 0
      const name = toolNames[(i + p) % toolNames.length]
      const state = isRunning
        ? { status: "running", input: { file: `f${i}.ts` }, structured: {}, content: [] }
        : (i + p) % 11 === 0
          ? { status: "error", input: { file: `f${i}.ts` }, content: [], structured: {}, error: { type: "unknown", message: "合成错误样例" } }
          : { status: "completed", input: { file: `f${i}.ts` }, content: [{ type: "text", text: filler }], structured: {}, result: undefined }
      if (isRunning) runningCount++
      partsMade++
      bytes += filler.length
      content.push({ type: "tool", id: `part_${pad(i)}_${p}`, name, state, time: { created: t + 600 + p } })
    }
    content.push({ type: "text", id: `txt_${pad(i)}`, text: `助手回复 #${i}。` })
    {
      const id = `msg_a_${pad(seq)}`
      const data = {
        agent: "build",
        model: { id: "synthetic-model", providerID: "synthetic" },
        content,
        time: { created: t + 500, completed: t + 900 },
        tokens: { input: 1200, output: 800, reasoning: 0, cache: { read: 0, write: 0 } },
      }
      decode({ ...data, id, type: "assistant" })
      insert.run(id, sessionID, "assistant", seq++, t + 500, t + 900, JSON.stringify(data))
    }
  }
  console.log(
    `[gen] db=${dbPath} session=${sessionID} rows=${seq} parts=${partsMade} partChars=${bytes} running残留=${runningCount}`,
  )
})
tx()
sqlite.close()