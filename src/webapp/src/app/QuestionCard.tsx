import { useState } from "react"
import type { WebQuestionRequest } from "../state/questionReducer"

export function QuestionCard({
  request,
  onReply,
  onReject,
}: {
  request: WebQuestionRequest
  onReply: (requestID: string, answers: Array<Array<string>>) => void
  onReject: (requestID: string) => void
}) {
  const [selected, setSelected] = useState<Array<Array<string>>>(() => request.questions.map(() => []))
  const [customs, setCustoms] = useState<Array<string>>(() => request.questions.map(() => ""))
  const [busy, setBusy] = useState(false)

  const toggle = (questionIndex: number, label: string) => {
    const info = request.questions[questionIndex]
    if (!info) return
    setSelected((prev) => {
      const next = prev.map((answers) => [...answers])
      const current = next[questionIndex]!
      if (info.multiple) {
        const index = current.indexOf(label)
        if (index >= 0) current.splice(index, 1)
        else current.push(label)
      } else {
        next[questionIndex] = [label]
      }
      return next
    })
  }

  const buildAnswers = (): Array<Array<string>> =>
    request.questions.map((question, index) => {
      const picked = [...selected[index]!]
      const custom = customs[index]?.trim()
      if (question.custom !== false && custom) picked.push(custom)
      return picked
    })

  const submit = async () => {
    if (busy) return
    setBusy(true)
    try {
      await onReply(request.id, buildAnswers())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="tool-card">
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
        <span className="badge" style={{ background: "var(--question, #8b5cf6)", color: "#1a1a1a", fontWeight: 700 }}>
          ?
        </span>
        <strong style={{ fontSize: 13 }}>提问</strong>
      </div>
      {request.questions.map((question, questionIndex) => (
        <div key={questionIndex} style={{ margin: "10px 0", padding: "8px 10px", border: "1px solid var(--border-subtle)", borderRadius: 8 }}>
          <div style={{ fontSize: 12, color: "var(--inactive)", marginBottom: 2 }}>{question.header}</div>
          <div style={{ fontSize: 13, marginBottom: 8 }}>{question.question}</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {question.options.map((option) => {
              const active = selected[questionIndex]!.includes(option.label)
              return (
                <label
                  key={option.label}
                  style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: 8,
                    padding: "6px 8px",
                    borderRadius: 6,
                    cursor: "pointer",
                    background: active ? "var(--selection-bg)" : "transparent",
                    border: active ? "1px solid var(--border)" : "1px solid transparent",
                  }}
                >
                  <input
                    type={question.multiple ? "checkbox" : "radio"}
                    name={`question-${request.id}-${questionIndex}`}
                    checked={active}
                    onChange={() => toggle(questionIndex, option.label)}
                    style={{ marginTop: 3 }}
                  />
                  <span style={{ fontSize: 13 }}>
                    <strong>{option.label}</strong>
                    {option.description ? (
                      <span style={{ display: "block", color: "var(--inactive)", fontSize: 12 }}>{option.description}</span>
                    ) : null}
                  </span>
                </label>
              )
            })}
            {question.custom !== false ? (
              <input
                className="text-input"
                placeholder="输入自定义答案…"
                value={customs[questionIndex]}
                onChange={(e) =>
                  setCustoms((prev) => prev.map((value, index) => (index === questionIndex ? e.target.value : value)))
                }
                style={{ marginTop: 4 }}
              />
            ) : null}
          </div>
        </div>
      ))}
      <div style={{ display: "flex", gap: 8 }}>
        <button
          className="btn"
          style={{ borderColor: "var(--success)", color: "var(--success)", fontWeight: 600 }}
          disabled={busy}
          onClick={() => void submit()}
        >
          提交
        </button>
        <button className="btn" style={{ borderColor: "var(--error)", color: "var(--error)" }} disabled={busy} onClick={() => onReject(request.id)}>
          拒绝
        </button>
      </div>
    </div>
  )
}
