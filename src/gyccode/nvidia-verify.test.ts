import { test, expect } from "bun:test"
import { runCLI, assert } from "./test-harness"

test("nvidia verified model responds", async () => {
  const result = await runCLI([
    "--model", "nvidia/nvidia/nemotron-3-ultra-550b-a55b",
    "--prompt", "ping"
  ], 60000)
  assert.exitCode(result, 0)
  assert.contains(result, "pong", "stdout")
}, 90000)