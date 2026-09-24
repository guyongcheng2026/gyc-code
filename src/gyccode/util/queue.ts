export class AsyncQueue<T> implements AsyncIterable<T> {
  private queue: T[] = []
  private resolvers: ((value: T) => void)[] = []

  push(item: T) {
    const resolve = this.resolvers.shift()
    if (resolve) resolve(item)
    else this.queue.push(item)
  }

  async next(): Promise<T> {
    if (this.queue.length > 0) return this.queue.shift()!
    return new Promise((resolve) => this.resolvers.push(resolve))
  }

  async *[Symbol.asyncIterator]() {
    while (true) yield await this.next()
  }
}

export async function work<T>(concurrency: number, items: T[], fn: (item: T) => Promise<void>) {
  const pending = [...items]
  const errors: Error[] = []
  await Promise.all(
    Array.from({ length: concurrency }, async () => {
      while (true) {
        const item = pending.pop()
        if (item === undefined) return
        try {
          await fn(item)
        } catch (error) {
          errors.push(error instanceof Error ? error : new Error(String(error)))
        }
      }
    }),
  )
  if (errors.length > 0) {
    const aggregate = new Error(`${errors.length} task(s) failed`)
    aggregate.cause = errors
    throw aggregate
  }
}
