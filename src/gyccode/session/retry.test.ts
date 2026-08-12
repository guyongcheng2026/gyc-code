import { expect, test } from "bun:test"
import { retryable } from "./retry"

test("stream idle timeout errors are retryable", () => {
  const error = {
    name: "UnknownError",
    data: {
      message:
        "LLM stream connection idle timeout: no data received within 600000ms. The connection may have dropped.",
    },
  }
  expect(retryable(error, "opencode")).toBeDefined()
})

test("RETRY_TOTAL_CAP_MS bounds silent retry windows to ~2 minutes", () => {
  expect(RETRY_TOTAL_CAP_MS).toBe(120_000)
  // 60s header timeout x 5 retries would otherwise stall the run loop ~6min
  expect(RETRY_TOTAL_CAP_MS).toBeLessThan(60_000 * 5)
})

test("generic unknown errors are not retryable", () => {
  const error = {
    name: "UnknownError",
    data: { message: "Some unrelated failure" },
  }
  expect(retryable(error, "opencode")).toBeUndefined()
})
