import { test, expect } from "bun:test"
import { runCLI, assert } from "./test-harness"

test("gyc --version prints version", async () => {
  const result = await runCLI(["--version"], 10000)
  assert.exitCode(result, 0)
  assert.contains(result, "0.0.1")
}, 15000)

test("gyc --help prints help", async () => {
  const result = await runCLI(["--help"], 30000)
  assert.exitCode(result, 0)
  assert.contains(result, "gyc", "stderr")
  assert.contains(result, "Commands:", "stderr")
}, 40000)

test("gyc cli --help prints cli command help", async () => {
  const result = await runCLI(["cli", "--help"], 15000)
  assert.exitCode(result, 0)
  assert.contains(result, "cli", "stderr")
  assert.contains(result, "纯命令行界面", "stderr")
}, 20000)