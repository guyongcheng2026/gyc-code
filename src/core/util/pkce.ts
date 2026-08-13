export interface PkceCodes {
  verifier: string
  challenge: string
}

const CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~"

export function generateRandomString(length: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(length)))
    .map((b) => CHARS[b % CHARS.length])
    .join("")
}

export function base64UrlEncode(buffer: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(buffer))
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "")
}

export async function generatePKCE(verifierLength = 43): Promise<PkceCodes> {
  const verifier = generateRandomString(verifierLength)
  const challenge = base64UrlEncode(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)))
  return { verifier, challenge }
}
