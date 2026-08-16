export type WebQuestionOption = {
  label: string
  description: string
}

export type WebQuestionInfo = {
  question: string
  header: string
  options: Array<WebQuestionOption>
  multiple?: boolean
  custom?: boolean
}

export type WebQuestionRequest = {
  id: string
  sessionID: string
  questions: Array<WebQuestionInfo>
  tool?: { messageID: string; callID: string }
}

export type QuestionState = { requests: Array<WebQuestionRequest> }

export const initialQuestionState = (): QuestionState => ({ requests: [] })

type QuestionAction =
  | { type: "question.v2.asked"; properties: WebQuestionRequest }
  | { type: "question.v2.replied"; properties: { sessionID: string; requestID: string; answers: Array<Array<string>> } }
  | { type: "question.v2.rejected"; properties: { sessionID: string; requestID: string } }

export function questionReducer(state: QuestionState, action: QuestionAction): QuestionState {
  switch (action.type) {
    case "question.v2.asked": {
      const item = action.properties
      const exists = state.requests.some((r) => r.id === item.id)
      const requests = exists ? state.requests.map((r) => (r.id === item.id ? item : r)) : [...state.requests, item]
      return { requests }
    }
    case "question.v2.replied":
    case "question.v2.rejected":
      return { requests: state.requests.filter((r) => r.id !== action.properties.requestID) }
    default:
      return state
  }
}
