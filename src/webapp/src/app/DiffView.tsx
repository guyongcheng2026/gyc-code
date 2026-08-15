import { useEffect, useState } from "react"
import { DiffEditor } from "@monaco-editor/react"
import { loader } from "@monaco-editor/react"
import { useSessionDiff, type FileDiff } from "../client/useSessionDiff"

function DiffPair({ diff, index }: { diff: FileDiff; index: number }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    loader.init().then(
      () => { if (!cancelled) setReady(true) },
      () => { if (!cancelled) setReady(false) },
    )
    return () => { cancelled = true }
  }, [])

  return (
    <div key={index} style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "8px 0" }}>
        {diff.file}
        <span style={{ color: "#7cb342" }}> +{diff.additions}</span>
        <span style={{ color: "#e06c75" }}> -{diff.deletions}</span>
      </h4>
      {ready ? (
        <DiffEditor
          height="240px"
          original={diff.before}
          modified={diff.after}
          theme="vs-dark"
          options={{ readOnly: true, minimap: { enabled: false }, renderSideBySide: true, fontSize: 12 }}
        />
      ) : (
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "#1c1c1c", padding: 8 }}>
          {diff.before}
        </pre>
      )}
    </div>
  )
}

export function DiffView({ sessionID }: { sessionID: string | null }) {
  const { diffs, loading, error } = useSessionDiff(sessionID)

  if (loading) return <div style={{ padding: 24 }}>加载 diff…</div>
  if (error) return <div style={{ padding: 24, color: "red" }}>{error}</div>
  if (!diffs.length) return <div style={{ padding: 24, color: "#888" }}>暂无文件改动</div>

  return (
    <div style={{ padding: 8, overflowY: "auto", height: "100%" }}>
      {diffs.map((d, i) => <DiffPair key={i} diff={d} index={i} />)}
    </div>
  )
}
