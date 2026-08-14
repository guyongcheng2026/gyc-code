import { createHash } from "node:crypto"

/** Deterministic string digest (Node replacement for Bun.hash, used for cache keys). */
export function hashString(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 16)
}
