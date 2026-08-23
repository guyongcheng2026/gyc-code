import { describe, expect, it, vi, beforeEach } from "vitest"
import { act, renderHook, waitFor } from "@testing-library/react"

// 受控 SSE mock：记录每次 global.event 调用（含 signal），并暴露事件注入口。
// 状态经 vi.hoisted 提前创建（先于 mock 工厂与 beforeEach），工厂重复执行时复用同一对象。
const h = vi.hoisted(() => ({
  calls: [] as Array<{ directory: string | undefined; signal: AbortSignal }>,
  sinks: new Map<string, (data: unknown) => void>(),
}))

vi.mock("./sdk", () => {
  return {
    sdk: (directory?: string) => ({
      global: {
        event: (options?: { signal?: AbortSignal }) => {
          const signal = options?.signal ?? new AbortController().signal
          h.calls.push({ directory, signal })
          const key = directory ?? "(default)"
          const stream = {
            [Symbol.asyncIterator]() {
              return {
                next: () =>
                  new Promise<{ value: unknown; done: false }>((resolve) => {
                    h.sinks.set(key, (data: unknown) => resolve({ value: data, done: false }))
                  }),
              }
            },
          }
          return Promise.resolve({ stream })
        },
      },
    }),
  }
})

function testState() {
  return h
}

async function loadUseEvents() {
  return await import("./useEvents")
}

beforeEach(() => {
  // resetModules 只重置模块注册表（让 useEvents 内的 buses Map 归零）；
  // ./sdk 的 mock 工厂仅执行一次，其状态需在此显式清空。
  const s = testState()
  s.calls.length = 0
  s.sinks.clear()
})

describe("useEvents（共享单连接）", () => {
  it("同一 directory 的多个订阅者只建立一条 SSE 流，且各自收到同一事件", async () => {
    const { useEvents } = await loadUseEvents()
    const seenA: unknown[] = []
    const seenB: unknown[] = []
    const { unmount } = renderHook(() => {
      useEvents(undefined, (e) => seenA.push(e))
      useEvents(undefined, (e) => seenB.push(e))
    })
    await waitFor(() => expect(testState().calls).toHaveLength(1))
    act(() => {
      testState().sinks.get("(default)")!({ payload: { type: "session.busy", properties: { sessionID: "s1" } } })
    })
    await waitFor(() => expect(seenA).toHaveLength(1))
    expect(seenB).toHaveLength(1)
    expect(seenA[0]).toEqual({ type: "session.busy", properties: { sessionID: "s1" } })
    unmount()
  })

  it("最后一个订阅者卸载后中止底层流；仍有订阅者时不中止", async () => {
    const { useEvents } = await loadUseEvents()
    const a = renderHook(() => useEvents(undefined, () => {}))
    await waitFor(() => expect(testState().calls).toHaveLength(1))
    const b = renderHook(() => useEvents(undefined, () => {}))
    // 短暂等待确认不会新建第二条流
    await new Promise((r) => setTimeout(r, 50))
    expect(testState().calls).toHaveLength(1)

    a.unmount()
    expect(testState().calls[0]!.signal.aborted).toBe(false)
    b.unmount()
    await waitFor(() => expect(testState().calls[0]!.signal.aborted).toBe(true))
  })

  it("不同 directory 各自建立独立流", async () => {
    const { useEvents } = await loadUseEvents()
    renderHook(() => useEvents("/a", () => {}))
    renderHook(() => useEvents("/b", () => {}))
    await waitFor(() => expect(testState().calls).toHaveLength(2))
    expect(new Set(testState().calls.map((c) => c.directory))).toEqual(new Set(["/a", "/b"]))
  })
})
