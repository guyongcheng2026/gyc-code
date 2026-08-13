import { expect, test } from "bun:test"
import { Effect } from "effect"
import { runExtraction, type Extractor, type MemorySink } from "./extraction-runner"
import type { MemoryEntry } from "./memory-bridge"

test("runExtraction extracts, dedupes, and persists new memories", async () => {
  const existing: MemoryEntry[] = [
    { key: "memory_0", value: "User prefers TypeScript.", tags: [] },
  ]
  const extractor: Extractor = () => Effect.succeed(["User prefers TypeScript.", "The project uses bun."])
  const persisted: string[] = []
  const sink: MemorySink = (memories) => {
    persisted.push(...memories)
    return Effect.succeed(memories.length)
  }

  const result = await Effect.runPromise(
    runExtraction({ extractor, sink, existing, conversation: "hello", config: { minTurns: 3, model: "x", maxMemories: 5 } }),
  )

  // Duplicate "User prefers TypeScript." must be filtered; only new one persisted.
  expect(persisted).toEqual(["The project uses bun."])
  expect(result).toEqual(["The project uses bun."])
})

test("runExtraction returns empty when extractor yields nothing new", async () => {
  const extractor: Extractor = () => Effect.succeed([])
  const persisted: string[] = []
  const sink: MemorySink = (memories) => {
    persisted.push(...memories)
    return Effect.succeed(memories.length)
  }
  const result = await Effect.runPromise(
    runExtraction({ extractor, sink, existing: [], conversation: "hi", config: { minTurns: 3, model: "x", maxMemories: 5 } }),
  )
  expect(persisted).toEqual([])
  expect(result).toEqual([])
})

test("runExtraction caps persisted memories to maxMemories", async () => {
  const extractor: Extractor = () => Effect.succeed(["a", "b", "c", "d", "e", "f"])
  const persisted: string[] = []
  const sink: MemorySink = (memories) => {
    persisted.push(...memories)
    return Effect.succeed(memories.length)
  }
  await Effect.runPromise(
    runExtraction({ extractor, sink, existing: [], conversation: "hi", config: { minTurns: 3, model: "x", maxMemories: 3 } }),
  )
  expect(persisted).toHaveLength(3)
})
