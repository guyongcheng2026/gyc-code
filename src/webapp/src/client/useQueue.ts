import { useCallback, useRef, useState } from "react"
import { useEvents, type AnyEvent } from "./useEvents"

export type QueuedPrompt = {
  messageID: string
  text: string
  delivery: "queue" | "steer"
}

// 运行中投递队列（对齐 DSH QueueDock）：监听 session.next.prompt.admitted
// 入队（busy 态 Enter=queue / Ctrl+Enter=steer），session.next.prompted
// 出队（消息进入 LLM 处理）。事件版本带 .1 后缀，按前缀匹配兼容。
export function useQueue(sessionID: string | null, directory?: string) {
  const [items, setItems] = useState<QueuedPrompt[]>([])
  const sessionRef = useRef(sessionID)
  sessionRef.current = sessionID

  const onEvent = useCallback((e: AnyEvent) => {
    const sid = sessionRef.current
    if (!sid) return
    const props = e.properties as
      | { sessionID?: string; messageID?: string; prompt?: { text?: string }; delivery?: string }
      | undefined
    if (props?.sessionID !== sid) return
    if (e.type.startsWith("session.next.prompt.admitted") && props.messageID) {
      setItems((prev) => [...prev, { messageID: props.messageID!, text: props.prompt?.text ?? "", delivery: props.delivery === "steer" ? "steer" : "queue" }])
    } else if (e.type.startsWith("session.next.prompted") && props.messageID) {
      setItems((prev) => prev.filter((item) => item.messageID !== props.messageID))
    }
  }, [])

  useEvents(directory, onEvent)

  return { queue: items }
}