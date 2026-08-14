import { Effect, Semaphore, SynchronizedRef } from "effect"

export type KeyedLock = {
  readonly withLock: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
  /** Number of distinct keys currently held (bounded by `MAX_LOCKS`). */
  readonly size: () => Effect.Effect<number>
}

// Bound the lock map so a long-running process cannot grow memory without
// limit as sessions come and go. LRU-ish: on a hit the entry is re-inserted to
// refresh recency; when over the bound, the oldest entry is evicted. An evicted
// lock is never in flight - callers hold a direct reference to the semaphore
// for the duration of their critical section (same pattern as tool/edit.ts).
export const MAX_LOCKS = 200

/** Per-key mutual exclusion that serializes critical sections sharing the same key. */
export function makeKeyedLock(): KeyedLock {
  const locks = SynchronizedRef.makeUnsafe(new Map<string, Semaphore.Semaphore>())

  const withLock = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const semaphore = yield* SynchronizedRef.modifyEffect(locks, (map) => {
        const existing = map.get(key)
        if (existing) {
          // Refresh insertion order so recently-used keys survive eviction.
          map.delete(key)
          map.set(key, existing)
          return Effect.succeed([existing, map] as const)
        }
        return Semaphore.make(1).pipe(
          Effect.map((sem) => {
            map.set(key, sem)
            if (map.size > MAX_LOCKS) {
              const oldest = map.keys().next().value
              if (oldest !== undefined) map.delete(oldest)
            }
            return [sem, map] as const
          }),
        )
      })
      return yield* semaphore.withPermits(1)(effect)
    })

  const size = (): Effect.Effect<number> => SynchronizedRef.get(locks).pipe(Effect.map((map) => map.size))

  return { withLock, size }
}