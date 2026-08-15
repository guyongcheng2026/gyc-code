import { useState } from "react"

export function PromptInput({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("")

  const submit = () => {
    const text = value.trim()
    if (!text || disabled) return
    onSubmit(text)
    setValue("")
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        background: "var(--panel-bg)",
        border: "1px solid var(--border)",
        borderRadius: 12,
        padding: "4px 4px 4px 12px",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
      }}
    >
      <input
        className="text-input"
        placeholder="向 gyc 描述你要完成的任务…"
        value={value}
        disabled={disabled}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) submit()
        }}
      />
      <button
        className="btn"
        style={{ borderRadius: 8, padding: "8px 14px", fontWeight: 600 }}
        disabled={disabled || !value.trim()}
        onClick={submit}
      >
        发送
      </button>
    </div>
  )
}
