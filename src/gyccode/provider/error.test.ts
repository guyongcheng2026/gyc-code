import { expect, test } from "bun:test"
import { ProviderError } from "../provider/error"

test("HeaderTimeoutError and ResponseStreamError are retryable mapping targets", () => {
  const h = new ProviderError.HeaderTimeoutError(60_000)
  expect(h.name).toBe("ProviderHeaderTimeoutError")
  expect(h.message).toContain("60000")
  const s = new ProviderError.ResponseStreamError("SSE read timed out")
  expect(s.name).toBe("ProviderResponseStreamError")
})
