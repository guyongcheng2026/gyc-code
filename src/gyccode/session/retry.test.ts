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

test("generic unknown errors are not retryable", () => {
  const error = {
    name: "UnknownError",
    data: { message: "Some unrelated failure" },
  }
  expect(retryable(error, "opencode")).toBeUndefined()
})
