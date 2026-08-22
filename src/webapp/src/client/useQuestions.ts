import { useCallback, useReducer } from "react"
import { initialQuestionState, questionReducer, type WebQuestionRequest } from "../state/questionReducer"
import { useEvents, type AnyEvent } from "./useEvents"
import { v2 } from "./v2"

function questionRequestSessionID(e: AnyEvent): string | undefined {
  const props = e.properties as Record<string, unknown> | undefined
  if (!props) return undefined
  return props.sessionID as string | undefined
}

// 订阅 question.v2.* 事件维护问答队列；reply/reject 走 v2 session question 端点。
// 端点: POST /v2/session/{id}/question/{requestID} (reply/reject)
export function useQuestions(sessionID: string | null, directory?: string) {
  const [state, dispatch] = useReducer(questionReducer, undefined, initialQuestionState)

  useEvents(directory, (e: AnyEvent) => {
    if (e.type !== "question.v2.asked" && e.type !== "question.v2.replied" && e.type !== "question.v2.rejected") return
    if (sessionID && questionRequestSessionID(e) && questionRequestSessionID(e) !== sessionID) return
    dispatch(e as never)
  })

  const reply = useCallback(
    async (requestID: string, answers: Array<Array<string>>) => {
      if (!sessionID) return
      await v2(directory).v2.session.question.reply({
        sessionID,
        requestID,
        questionV2Reply: { answers },
      })
      dispatch({
        type: "question.v2.replied",
        properties: { sessionID, requestID, answers },
      })
    },
    [sessionID, directory],
  )

  const reject = useCallback(
    async (requestID: string) => {
      if (!sessionID) return
      await v2(directory).v2.session.question.reject({ sessionID, requestID })
      dispatch({
        type: "question.v2.rejected",
        properties: { sessionID, requestID },
      })
    },
    [sessionID, directory],
  )

  return { requests: state.requests as Array<WebQuestionRequest>, reply, reject }
}
