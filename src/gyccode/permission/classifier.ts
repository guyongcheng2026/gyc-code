export class DenialTracker {
  private denials = new Map<string, number>()
  private readonly MAX_DENIALS = 3

  recordDenial(key: string): void {
    const count = (this.denials.get(key) ?? 0) + 1
    this.denials.set(key, count)
  }

  shouldBlock(key: string): boolean {
    return (this.denials.get(key) ?? 0) >= this.MAX_DENIALS
  }

  getDenialCount(key: string): number {
    return this.denials.get(key) ?? 0
  }

  reset(): void {
    this.denials.clear()
  }
}
