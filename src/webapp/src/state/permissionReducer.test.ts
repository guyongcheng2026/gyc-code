import { describe, expect, it } from "vitest"
import { permissionReducer, initialPermissionState, type PermissionItem } from "./permissionReducer"

const item: PermissionItem = {
  id: "p1",
  type: "bash",
  sessionID: "s1",
  messageID: "m1",
  title: "允许运行命令",
  metadata: {},
}

describe("permissionReducer", () => {
  it("queues a permission on permission.updated", () => {
    const s = permissionReducer(initialPermissionState(), { type: "permission.updated", properties: item })
    expect(s.queue).toHaveLength(1)
    expect(s.queue[0].id).toBe("p1")
  })

  it("removes permission on permission.replied", () => {
    let s = permissionReducer(initialPermissionState(), { type: "permission.updated", properties: item })
    s = permissionReducer(s, {
      type: "permission.replied",
      properties: { sessionID: "s1", permissionID: "p1", response: "once" },
    })
    expect(s.queue).toHaveLength(0)
  })
})
