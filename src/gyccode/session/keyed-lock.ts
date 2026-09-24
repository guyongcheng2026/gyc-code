import { Effect, Semaphore, SynchronizedRef } from "effect"

export type KeyedLock = {
  readonly withLock: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Number of distinct keys currently held (bounded by `MAX_LOCKS`). */
  readonly size: () => Effect.Effect<number>
}

// Bound the lock map so a long-running process cannot grow memory without
// limit as sessions come and go. LRU: on a hit the entry is moved to end;
// when over the bound, the oldest entry is evicted. An evicted lock is never
// in flight - callers hold a direct reference to the semaphore for the duration
// of their critical section.
export const MAX_LOCKS = 200

interface LockEntry {
  semaphore: Semaphore.Semaphore
  lastUsed: number
}

/** Per-key mutual exclusion that serializes critical sections sharing the same key. */
export function makeKeyedLock(): KeyedLock {
  const locks = SynchronizedRef.makeUnsafe(new Map<string, LockEntry>())
  let accessCounter = 0

  const withLock = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const semaphore = yield* SynchronizedRef.modifyEffect(locks, (map) => {
        const existing = map.get(key)
        const now = ++accessCounter
        if (existing) {
          // Refresh recency
          existing.lastUsed = now
          map.set(key, existing)
          return Effect.succeed([existing.semaphore, map] as const)
        }
        return Semaphore.make(1).pipe(
          Effect.map((sem) => {
            const entry: LockEntry = { semaphore: sem, lastUsed: now }
            map.set(key, entry)
            if (map.size > MAX_LOCKS) {
              // Evict oldest by lastUsed
              let oldestKey: string | undefined
              let oldestTime = Infinity
              for (const [k, v] of map) {
                if (v.lastUsed < oldestTime) {
                  oldestTime = v.lastUsed
                  oldestKey = k
                }
              }
              if (oldestKey !== undefined && oldestKey !== key) {
                map.delete(oldestKey)
              }
            }
            return [sem, map] as const
          }),
        )
      })
      return yield* semaphore.withPermits(1)(effect)
    })

  const size = (): Effect.Effect<number> =>
    SynchronizedRef.get(locks).pipe(Effect.map((map) => map.size))

  return { withLock, size }
}