import { useCallback, useEffect, useReducer, useRef } from "react"
import { chatReducer, initialChatState, type ChatMessage } from "../state/chatReducer"
import { useEvents, type AnyEvent } from "./useEvents"
import { sdk } from "./sdk"

// 选定会话：加载历史消息（hydrate），并订阅全局事件流做增量更新。
export function useChatSession(sessionID: string | null, directory?: string) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState)
  const sessionRef = useRef(sessionID)
  sessionRef.current = sessionID

  const hydrate = useCallback(
    async (id: string) => {
      const res = await sdk(directory).session.messages({ path: { id } })
      const messages = (res.data as ChatMessage[]) ?? []
      dispatch({ type: "hydrate", sessionID: id, messages })
    },
    [directory],
  )

  useEffect(() => {
    if (!sessionID) {
      dispatch({ type: "hydrate", sessionID: "", messages: [] })
      return
    }
    void hydrate(sessionID).catch((err) => console.error("hydrate failed", err))
  }, [sessionID, hydrate])

  const onEvent = useCallback((e: AnyEvent) => {
    if (sessionRef.current && (e.type === "message.updated" || e.type === "message.removed")) {
      const props = e.properties as { sessionID?: string }
      if (props.sessionID && props.sessionID !== sessionRef.current) return
    }
    dispatch(e as never)
  }, [])

  useEvents(directory, onEvent)

  return state
}
