import { useEffect, useState } from "react"
import { createGyccodeClient } from "@gyccode/protocol/v1"

type Session = { id: string }

export function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const client = createGyccodeClient({ baseUrl: "" })
    let cancelled = false
    client.session
      .list()
      .then((res) => {
        if (cancelled) return
        setSessions((res.data as Session[]) ?? [])
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : String(err))
      })
    return () => {
      cancelled = true
    }
  }, [])

  return (
    <main>
      <h1>gyc web</h1>
      {error ? <p style={{ color: "red" }}>连接失败: {error}</p> : null}
      <h2>会话列表</h2>
      {sessions.length === 0 && !error ? <p>（空，或尚未连接 server）</p> : null}
      <ul>{sessions.map((s) => <li key={s.id}>{s.id}</li>)}</ul>
    </main>
  )
}
