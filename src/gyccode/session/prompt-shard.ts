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
  /** Optional array segmentation (e.g. semi-static env + MCP segments). */
  segments?: string[]
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

  /**
   * Build the ordered system-prompt parts (static → semi → dynamic) plus
   * extras (memories, structured-output hint). Semi/dynamic tiers expand their
   * segments; static contributes its single content string. Empty tiers and
   * empty segments are skipped so the result is a minimal non-empty parts list.
   */
  buildSystem(extra?: string[]): string[] {
    const order: ShardTier[] = ["static", "semi", "dynamic"]
    const parts: string[] = []
    for (const tier of order) {
      const shard = this.cache.get(tier)
      if (!shard) continue
      if (shard.segments && shard.segments.length > 0) parts.push(...shard.segments)
      else if (shard.content) parts.push(shard.content)
    }
    if (extra) parts.push(...extra)
    return parts
  }

  /** Join cached shard contents into a single diagnostic string. */
  buildPrompt(): string {
    return this.buildSystem().join("\n\n")
  }
}
