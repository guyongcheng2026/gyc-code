export type PermissionItem = {
  id: string
  type: string
  pattern?: string | Array<string>
  sessionID: string
  messageID: string
  callID?: string
  title: string
  metadata: Record<string, unknown>
  time?: { created: number }
}

export type PermissionState = { queue: PermissionItem[] }

export const initialPermissionState = (): PermissionState => ({ queue: [] })

type PermissionAction =
  | { type: "permission.updated"; properties: PermissionItem }
  | { type: "permission.replied"; properties: { sessionID: string; permissionID: string; response: string } }

export function permissionReducer(state: PermissionState, action: PermissionAction): PermissionState {
  switch (action.type) {
    case "permission.updated": {
      const item = action.properties
      const exists = state.queue.some((p) => p.id === item.id)
      const queue = exists ? state.queue.map((p) => (p.id === item.id ? item : p)) : [...state.queue, item]
      return { queue }
    }
    case "permission.replied":
      return { queue: state.queue.filter((p) => p.id !== action.properties.permissionID) }
    default:
      return state
  }
}
