import { useState } from "react"

export function PromptInput({ disabled, onSubmit }: { disabled: boolean; onSubmit: (text: string) => void }) {
  const [value, setValue] = useState("")
  return (
    <input
      placeholder="输入消息…"
      value={value}
      disabled={disabled}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter" && value.trim()) {
          onSubmit(value.trim())
          setValue("")
        }
      }}
      style={{ padding: 10, fontSize: 14 }}
    />
  )
}
