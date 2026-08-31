// P0-9: Sensitive info log sanitization
const SENSITIVE_KEYS = new Set(["api_key","apiKey","api-key","apikey","secret","secret_key","secretKey","password","pwd","passwd","token","access_token","accessToken","auth","authorization","Authorization","private_key","privateKey","private-key","session_id","sessionId","SESSION_ID","session_secret","sessionSecret","bearer","bearer_token","x_api_key","x-api-key","weixin_token","wx_token","wechat_token"])
const MASK = "[REDACTED]"
function isSensitiveValue(v: unknown): boolean { if (typeof v !== "string") return false; if (v.length >= 8 && v.length <= 512) { if (/^[A-Za-z0-9_-]{20,}$/.test(v)) return true; if (/^sk-/.test(v)) return true; if (/^Bearer\\s+/i.test(v)) return true; } return false; }
export function sanitizeForLog(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (typeof obj === "string") return isSensitiveValue(obj) ? MASK : obj;
  if (typeof obj === "number" || typeof obj === "boolean") return obj;
  if (Array.isArray(obj)) return obj.map((item) => sanitizeForLog(item));
  if (typeof obj === "object") { const result: Record<string, unknown> = {}; for (const [key, value] of Object.entries(obj as Record<string, unknown>)) { const keyLower = key.toLowerCase(); const isSensitive = SENSITIVE_KEYS.has(keyLower) || SENSITIVE_KEYS.has(key) || keyLower.includes("secret") || keyLower.includes("password") || keyLower.includes("token") || keyLower.includes("auth"); if (isSensitive) { result[key] = MASK; } else if (typeof value === "object" && value !== null) { result[key] = sanitizeForLog(value); } else if (isSensitiveValue(value)) { result[key] = MASK; } else { result[key] = value; } } return result; } return obj; }
export function safeStringify(obj: unknown): string { try { return JSON.stringify(sanitizeForLog(obj)); } catch { return "[Unserializable]"; } }
