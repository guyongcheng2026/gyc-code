import { useCallback, useEffect, useReducer, useRef } from "react"
import { chatReducer, initialChatState, type ChatMessage, type ChatPart } from "../state/chatReducer"
import { useEvents, type AnyEvent } from "./useEvents"
import { sdk } from "./sdk"
import { unwrapList } from "./useCommands"

type Hydrated = { info: { id: string; role: string; sessionID?: string; error?: unknown }; parts: ChatPart[] }

// 从事件 payload 提取所属会话（不同事件类型携带 sessionID 的位置不同）。
function eventSessionID(e: AnyEvent): string | undefined {
  const props = e.properties as Record<string, unknown> | undefined
  if (!props) return undefined
  if (e.type === "message.updated") return (props.info as { sessionID?: string } | undefined)?.sessionID
  if (e.type === "message.part.updated") return (props.part as { sessionID?: string } | undefined)?.sessionID
  return props.sessionID as string | undefined
}

// 选定会话：加载历史消息（hydrate），并订阅全局事件流做增量更新。
export function useChatSession(sessionID: string | null, directory?: string) {
  const [state, dispatch] = useReducer(chatReducer, undefined, initialChatState)
  const sessionRef = useRef(sessionID)
  sessionRef.current = sessionID

  const hydrate = useCallback(
    async (id: string) => {
      const res = await sdk(directory).session.messages({ path: { id } })
      const list = unwrapList<Hydrated>(res.data)
      const messages: ChatMessage[] = list.map(({ info, parts }) => ({
        id: info.id,
        role: info.role === "user" ? "user" : "assistant",
        parts: parts.map((p) => {
          const anyPart = p as unknown as Record<string, unknown>
          return {
            id: p.id,
            type: p.type,
            text: p.text,
            tool: anyPart.tool as string | undefined,
            callID: anyPart.callID as string | undefined,
            title: anyPart.title as string | undefined,
            state: anyPart.state as ChatPart["state"],
            output: anyPart.output as string | undefined,
            error: anyPart.error as string | undefined,
            reason: anyPart.reason as string | undefined,
            prompt: anyPart.prompt as string | undefined,
            description: anyPart.description as string | undefined,
          } as ChatPart
        }),
        error: info.error,
      }))
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
    const sid = eventSessionID(e)
    if (sessionRef.current && sid && sid !== sessionRef.current) return
    dispatch(e as never)
  }, [])

  useEvents(directory, onEvent)

  return state
}
