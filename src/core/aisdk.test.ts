import { describe, expect, it } from "bun:test"
import { wrapSSE } from "./aisdk"

describe("wrapSSE", () => {
  it("cancel() should clear pending chunk timer so it never fires after cancel", async () => {
    let cancelCount = 0
    const abortCtl = new AbortController()
    const body = new ReadableStream<Uint8Array>({
      pull() {
        // never settles -> underlying read() stays pending (hung stream)
        return new Promise<undefined>(() => {})
      },
      cancel() {
        cancelCount++
        return Promise.resolve()
      },
    })
    const res = new Response(body, {
      status: 200,
      headers: { "content-type": "text/event-stream" },
    })

    const wrapped = wrapSSE(res, 50, abortCtl)
    const reader = wrapped.body!.getReader()
    const readPromise = reader.read()
    void readPromise.then(
      () => {},
      () => {},
    )

    await Bun.sleep(20) // timer is now pending
    await reader.cancel("test cancel")

    await Bun.sleep(100) // beyond the 50ms timer window
    // If the timer was not cleared on cancel, it fires afterwards and
    // cancels the underlying reader a second time.
    expect(cancelCount).toBe(1)
  })
})