export const ShardTier = {
  Static: "static",
  SemiStatic: "semi",
  Dynamic: "dynamic",
} as const
export type ShardTier = (typeof ShardTier)[keyof typeof ShardTier]

export interface PromptShard {
  tier: ShardTier
  content: string
  hash: string
}

export function hashShard(content: string): string {
  let hash = 2166136261
  for (let i = 0; i < content.length; i++) {
    hash ^= content.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return (hash >>> 0).toString(16)
}

export class ShardCache {
  private cache = new Map<ShardTier, PromptShard>()

  get(tier: ShardTier): PromptShard | undefined {
    return this.cache.get(tier)
  }

  set(shard: PromptShard): void {
    this.cache.set(shard.tier, shard)
  }

  invalidate(tier?: ShardTier): void {
    if (tier) {
      this.cache.delete(tier)
    } else {
      this.cache.clear()
    }
  }

  buildPrompt(): string {
    const order: ShardTier[] = ["static", "semi", "dynamic"]
    return order
      .map(tier => this.cache.get(tier)?.content ?? "")
      .filter(Boolean)
      .join("\n\n")
  }
}
