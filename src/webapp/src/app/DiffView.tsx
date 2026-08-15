import { useEffect, useState } from "react"
import { DiffEditor, loader } from "@monaco-editor/react"
import { useSessionDiff, type FileDiff } from "../client/useSessionDiff"

function DiffPair({ diff, index }: { diff: FileDiff; index: number }) {
  const [ready, setReady] = useState(false)

  useEffect(() => {
    let cancelled = false
    void import("../monaco/setup")
      .then(() => loader.init())
      .then(
        () => { if (!cancelled) setReady(true) },
        () => { if (!cancelled) setReady(false) },
      )
    return () => { cancelled = true }
  }, [])

  return (
    <div key={index} style={{ marginBottom: 16 }}>
      <h4 style={{ margin: "8px 0", fontSize: 13 }}>
        <code>{diff.file}</code>
        <span style={{ color: "var(--diff-added-word)" }}> +{diff.additions}</span>
        <span style={{ color: "var(--diff-removed-word)" }}> -{diff.deletions}</span>
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
        <pre style={{ whiteSpace: "pre-wrap", fontSize: 12, background: "var(--code-bg)", padding: 8 }}>
          {diff.before}
        </pre>
      )}
    </div>
  )
}

export function DiffView({ sessionID }: { sessionID: string | null }) {
  const { diffs, loading, error } = useSessionDiff(sessionID)

  if (loading) return <div style={{ padding: 24, color: "var(--inactive)" }}>加载 diff…</div>
  if (error) return <div style={{ padding: 24, color: "var(--error)" }}>{error}</div>
  if (!diffs.length) return <div style={{ padding: 24, color: "var(--inactive)" }}>暂无文件改动</div>

  return (
    <div style={{ padding: 8, overflowY: "auto", height: "100%" }}>
      {diffs.map((d, i) => <DiffPair key={i} diff={d} index={i} />)}
    </div>
  )
}
