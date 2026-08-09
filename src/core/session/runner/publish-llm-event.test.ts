import { describe, expect, it } from "bun:test"
import { costForStep, type Price, type StepTokens } from "./publish-llm-event"

const price: Price = { input: 3, output: 15, cache: { read: 0.3, write: 3 } }

describe("costForStep", () => {
  it("charges each token bucket against its per-1M price", () => {
    const tokens: StepTokens = {
      input: 1_000_000,
      output: 500_000,
      reasoning: 250_000,
      cache: { read: 1_000_000, write: 250_000 },
    }
    // input 1M * 3/1M = 3
    // output 500k * 15/1M = 7.5
    // reasoning 250k * 15/1M = 3.75
    // cache read 1M * 0.3/1M = 0.3
    // cache write 250k * 3/1M = 0.75
    expect(costForStep(tokens, price)).toBeCloseTo(15.3, 10)
  })

  it("bills reasoning tokens at the output rate", () => {
    const tokens: StepTokens = { input: 0, output: 100_000, reasoning: 900_000, cache: { read: 0, write: 0 } }
    expect(costForStep(tokens, price)).toBeCloseTo(15, 10)
  })

  it("returns 0 when the price is zeroed", () => {
    const zero: Price = { input: 0, output: 0, cache: { read: 0, write: 0 } }
    const tokens: StepTokens = { input: 123, output: 456, reasoning: 789, cache: { read: 12, write: 34 } }
    expect(costForStep(tokens, zero)).toBe(0)
  })
})
