import { useState } from "react"
import { useSessions } from "../client/useSessions"
import { sdk } from "../client/sdk"
import { SessionList } from "./SessionList"
import { ChatPanel } from "./ChatPanel"

export function App() {
  const { sessions, reload } = useSessions()
  const [selected, setSelected] = useState<string | null>(null)

  const onNew = async () => {
    const res = await sdk().session.create({ body: {} })
    const created = (res.data as { id: string } | undefined)?.id
    if (created) {
      setSelected(created)
      await reload()
    }
  }

  return (
    <main style={{ display: "flex", height: "100vh", margin: 0 }}>
      <SessionList sessions={sessions} selected={selected} onSelect={setSelected} onNew={onNew} />
      {selected ? <ChatPanel sessionID={selected} /> : <div style={{ flex: 1, padding: 24 }}>选择或新建一个会话</div>}
    </main>
  )
}
