import { describe, expect, it } from "bun:test"
import { settled } from "./fire-and-forget"

describe("settled", () => {
  it("swallows rejection and reports it via onError", async () => {
    const seen: unknown[] = []
    await settled(Promise.reject(new Error("boom")), "test.scope", (e) => seen.push(e))
    expect(seen.length).toBe(1)
    expect((seen[0] as Error).message).toBe("boom")
  })

  it("passes the scope through to onError", async () => {
    const scopes: string[] = []
    await settled(Promise.reject(new Error("boom")), "tui.session", (_e, s) => scopes.push(s))
    expect(scopes).toEqual(["tui.session"])
  })

  it("resolves without calling onError on success", async () => {
    let calls = 0
    await expect(settled(Promise.resolve(1), "test.scope", () => calls++)).resolves.toBeUndefined()
    expect(calls).toBe(0)
  })

  it("tolerates a throwing onError without rejecting", async () => {
    await expect(
      settled(
        Promise.reject(new Error("boom")),
        "test.scope",
        () => {
          throw new Error("handler exploded")
        },
      ),
    ).resolves.toBeUndefined()
  })

  it("preserves the resolved value semantics by discarding it", async () => {
    await expect(settled(Promise.resolve("payload"), "test.scope")).resolves.toBeUndefined()
  })

  it("reports non-Error rejection reasons as-is", async () => {
    const seen: unknown[] = []
    await settled(Promise.reject("plain string"), "test.scope", (e) => seen.push(e))
    expect(seen).toEqual(["plain string"])
  })
})
