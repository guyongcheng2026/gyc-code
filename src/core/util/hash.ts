import { createHash } from "crypto"

export namespace Hash {
  // P1 安全修复：SHA-1 存在碰撞风险，已替换为 SHA-256
  export function fast(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("hex")
  }

  export function sha256(input: string | Buffer): string {
    return createHash("sha256").update(input).digest("hex")
  }
}
