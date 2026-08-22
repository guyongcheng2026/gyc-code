import { useCallback, useReducer } from "react"
import { initialPermissionState, permissionReducer, type PermissionItem } from "../state/permissionReducer"
import { useEvents, type AnyEvent } from "./useEvents"
import { sdk } from "./sdk"

function permissionSessionID(e: AnyEvent): string | undefined {
  const props = e.properties as Record<string, unknown> | undefined
  if (!props) return undefined
  if (e.type === "permission.updated") return (props as unknown as PermissionItem).sessionID
  return props.sessionID as string | undefined
}

// 订阅 permission.* 事件维护审批队列；resolve 走 GyccodeClient.postSessionIdPermissionsPermissionId。
// 端点: POST /session/{id}/permissions/{permissionID}，body: { response: "once"|"always"|"reject" }
export function usePermissions(sessionID: string | null, directory?: string) {
  const [state, dispatch] = useReducer(permissionReducer, undefined, initialPermissionState)

  useEvents(directory, (e: AnyEvent) => {
    if (e.type !== "permission.updated" && e.type !== "permission.replied") return
    if (sessionID && permissionSessionID(e) && permissionSessionID(e) !== sessionID) return
    dispatch(e as never)
  })

  const resolve = useCallback(
    async (permissionID: string, response: "once" | "always" | "reject") => {
      if (!sessionID) return
      await sdk(directory).postSessionIdPermissionsPermissionId({
        path: { id: sessionID, permissionID },
        body: { response },
      })
      dispatch({ type: "permission.replied", properties: { sessionID, permissionID, response } })
    },
    [sessionID, directory],
  )

  return { queue: state.queue, resolve }
}
