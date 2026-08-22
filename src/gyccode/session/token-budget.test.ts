import { expect, test } from "bun:test"
import { parseTokenBudget, parseTokenBudgetNL, checkTokenBudget, budgetContinuationMessage } from "./token-budget"

test("parseTokenBudget parses numeric + suffix", () => {
  expect(parseTokenBudget("+500k")).toBe(500_000)
  expect(parseTokenBudget("2m")).toBe(2_000_000)
  expect(parseTokenBudget("150000")).toBe(150_000)
  expect(parseTokenBudget("not a budget")).toBeNull()
})

test("parseTokenBudgetNL parses natural language", () => {
  expect(parseTokenBudgetNL("use 2M tokens please")).toBe(2_000_000)
  expect(parseTokenBudgetNL("limit to 500k tokens")).toBe(500_000)
  expect(parseTokenBudgetNL("+500k")).toBe(500_000)
  expect(parseTokenBudgetNL("hello world")).toBeNull()
})

test("checkTokenBudget continues under threshold, stops at completion", () => {
  // budget 100k, used 50k (< 90%) -> continue
  expect(checkTokenBudget({ budget: 100_000, used: 50_000, continuations: 0, lastIncrement: 0 }).action).toBe("continue")
  // used 95k (>= 90%) -> complete
  expect(checkTokenBudget({ budget: 100_000, used: 95_000, continuations: 0, lastIncrement: 0 }).action).toBe("complete")
  // diminishing returns: 3+ continuations and increment < 500 -> complete
  expect(
    checkTokenBudget({ budget: 100_000, used: 60_000, continuations: 3, lastIncrement: 200 }).action,
  ).toBe("complete")
})

test("budgetContinuationMessage includes progress percentage", () => {
  const msg = budgetContinuationMessage(0.5)
  expect(msg).toContain("50%")
  expect(msg).toContain("Keep working")
})
