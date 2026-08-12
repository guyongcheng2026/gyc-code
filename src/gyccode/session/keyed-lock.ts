import { Effect, Semaphore, SynchronizedRef } from "effect"

export type KeyedLock = {
  readonly withLock: <A, E, R>(key: string, effect: Effect.Effect<A, E, R>) => Effect.Effect<A, E, R>
}

/** Per-key mutual exclusion that serializes critical sections sharing the same key. */
export function makeKeyedLock(): KeyedLock {
  const locks = SynchronizedRef.makeUnsafe(new Map<string, Semaphore.Semaphore>())

  const withLock = <A, E, R>(key: string, effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    Effect.gen(function* () {
      const semaphore = yield* SynchronizedRef.modifyEffect(locks, (map) => {
        const existing = map.get(key)
        if (existing) return Effect.succeed([existing, map] as const)
        return Semaphore.make(1).pipe(
          Effect.map((sem) => {
            map.set(key, sem)
            return [sem, map] as const
          }),
        )
      })
      return yield* semaphore.withPermits(1)(effect)
    })

  return { withLock }
}