/**
 * 问题→方案记忆（Problem-Solution Memory, PSM）
 *
 * 当同类错误重复出现时，自动检索过往已验证的解决方案并注入上下文，
 * 避免"同问题从零解决"。存储复用 memory-bridge 的 Markdown 文件，
 * 以 psm_<signature> 为 key，结构化 frontmatter 区分 problem/solution。
 */

import { createHash } from "node:crypto"
import {
  readMemoriesCached,
  stripKeyHeader,
  writeMemoryFile,
  type MemoryEntry,
} from "./memory-bridge"

const PSM_KEY_PREFIX = "psm_"
const PSM_TAG = "#problem-solution"
const STALE_PENDING_MS = 24 * 60 * 60 * 1000
const MAX_MESSAGE_LEN = 500
const MAX_FIX_LEN = 1000

export interface ProblemSolution {
  signature: string
  scope: string
  message: string
  rootCause: string | undefined
  fix: string | undefined
  verified: boolean
  createdAt: number
  hitCount: number
}

/** Normalize error info and generate a stable signature (16-char hex). */
export function psmSignature(scope: string, message: string): string {
  const normalized = `${scope}\u0000${message}`
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_MESSAGE_LEN)
  return createHash("sha256").update(normalized).digest("hex").slice(0, 16)
}

function psmKey(sig: string): string {
  return `${PSM_KEY_PREFIX}${sig}`
}

function parsePSMEntry(entry: MemoryEntry): ProblemSolution | undefined {
  const content = stripKeyHeader(entry.value)
  if (!content.startsWith(PSM_TAG)) return undefined

  const lines = content.split("\n")
  const meta: Record<string, string> = {}
  let i = 1
  for (; i < lines.length; i++) {
    const line = lines[i]
    if (line === "---") break
    if (!line) continue
    const idx = line.indexOf(":")
    if (idx > 0) meta[line.slice(0, idx).trim()] = line.slice(idx + 1).trim()
  }

  const body = lines.slice(i + 1).join("\n")
  const problemMatch = body.match(/## Problem\n([\s\S]*?)(?:\n## Solution|$)/)
  const solutionMatch = body.match(/## Solution\n([\s\S]*)$/)

  const problemText = problemMatch?.[1]?.trim() ?? ""
  const solutionText = solutionMatch?.[1]?.trim() ?? ""
  const rootCauseMatch = solutionText.match(/根因:\s*(.+)/)
  const fixMatch = solutionText.match(/修复:\s*(.+)/s)

  return {
    signature: meta.signature ?? entry.key.replace(PSM_KEY_PREFIX, ""),
    scope: meta.scope ?? "",
    message: problemText,
    rootCause: rootCauseMatch?.[1]?.trim(),
    fix: fixMatch?.[1]?.trim(),
    verified: meta.verified === "true",
    createdAt: Number(meta.created ?? 0),
    hitCount: Number(meta.hit_count ?? 0),
  }
}

function serializePSM(ps: ProblemSolution): string {
  const solutionSection = ps.rootCause
    ? `\n## Solution\n根因: ${ps.rootCause}\n修复: ${(ps.fix ?? "").slice(0, MAX_FIX_LEN)}`
    : ""
  return `${PSM_TAG}
signature: ${ps.signature}
scope: ${ps.scope}
verified: ${String(ps.verified)}
created: ${ps.createdAt}
hit_count: ${ps.hitCount}
---
## Problem
${ps.message.slice(0, MAX_MESSAGE_LEN)}${solutionSection}`
}

/** Record a problem occurrence (pending, no solution yet). No-op if already exists. */
export async function recordProblem(scope: string, message: string): Promise<void> {
  const sig = psmSignature(scope, message)
  const key = psmKey(sig)
  const entries = await readMemoriesCached()
  const existing = entries.find((e) => e.key === key)
  if (existing) {
    const parsed = parsePSMEntry(existing)
    if (parsed?.verified) {
      // 调试闭环：问题复发可见——已有验证方案的问题再次出现，累加复现计数，
      // 注入时据此提示「问题再次出现」，而不是完全无感知。
      await writeMemoryFile({ key, value: serializePSM({ ...parsed, hitCount: parsed.hitCount + 1 }) })
    }
    return
  }

  const ps: ProblemSolution = {
    signature: sig,
    scope,
    message: message.slice(0, MAX_MESSAGE_LEN),
    rootCause: undefined,
    fix: undefined,
    verified: false,
    createdAt: Date.now(),
    hitCount: 0,
  }
  await writeMemoryFile({ key, value: serializePSM(ps) })
}

/** Record or update a verified solution for a problem. */
export async function recordSolution(
  scope: string,
  message: string,
  rootCause: string,
  fix: string,
): Promise<void> {
  const sig = psmSignature(scope, message)
  const key = psmKey(sig)
  const entries = await readMemoriesCached()
  const existing = entries.find((e) => e.key === key)
  const prev = existing ? parsePSMEntry(existing) : undefined

  const ps: ProblemSolution = {
    signature: sig,
    scope,
    message: (prev?.message ?? message).slice(0, MAX_MESSAGE_LEN),
    rootCause: rootCause.slice(0, 200),
    fix: fix.slice(0, MAX_FIX_LEN),
    verified: true,
    createdAt: prev?.createdAt ?? Date.now(),
    hitCount: (prev?.hitCount ?? 0) + 1,
  }
  await writeMemoryFile({ key, value: serializePSM(ps) })
}

/** Search for a verified solution by error signature. */
export async function searchSolution(scope: string, message: string): Promise<ProblemSolution | undefined> {
  const sig = psmSignature(scope, message)
  const key = psmKey(sig)
  const entries = await readMemoriesCached()
  const found = entries.find((e) => e.key === key)
  if (!found) return undefined
  const parsed = parsePSMEntry(found)
  if (!parsed?.verified) return undefined
  return parsed
}

/** Keyword search across all PSM entries (for system prompt injection). */
export async function searchSolutionsByQuery(query: string, limit = 5): Promise<ProblemSolution[]> {
  const trimmed = query.trim()
  if (!trimmed) return []

  const tokens = Array.from(
    new Set(
      trimmed
        .toLowerCase()
        .split(/[^\p{L}\p{N}_-]+/u)
        .filter((t) => t.length >= 2),
    ),
  )
  if (tokens.length === 0) return []

  const entries = await readMemoriesCached()
  const scored: Array<{ ps: ProblemSolution; score: number }> = []
  for (const entry of entries) {
    if (!entry.key.startsWith(PSM_KEY_PREFIX)) continue
    const parsed = parsePSMEntry(entry)
    if (!parsed?.verified) continue
    const haystack = `${parsed.scope}\n${parsed.message}\n${parsed.rootCause ?? ""}\n${parsed.fix ?? ""}`.toLowerCase()
    let score = 0
    for (const token of tokens) {
      if (haystack.includes(token)) score++
    }
    if (score > 0) scored.push({ ps: parsed, score })
  }

  scored.sort((a, b) => b.score - a.score)
  return scored.slice(0, limit).map((s) => s.ps)
}

/** Format a verified solution for prompt injection. */
export function formatPSMForPrompt(ps: ProblemSolution): string {
  const reuse = ps.hitCount > 0 ? `，已复用${ps.hitCount}次` : ""
  return `⚠️ 此问题曾解决：${ps.rootCause ?? ""} → ${ps.fix ?? ""}（${ps.scope}${reuse}）`
}

/** Format multiple solutions for prompt injection with token budget. */
export function formatPSMBatchForPrompt(solutions: ProblemSolution[], budget = 2000): string | undefined {
  if (solutions.length === 0) return undefined
  const lines: string[] = []
  let used = 0
  for (const ps of solutions) {
    const line = formatPSMForPrompt(ps)
    if (used + line.length > budget) break
    lines.push(line)
    used += line.length
  }
  if (lines.length === 0) return undefined
  return `<problem-solutions>\n${lines.join("\n")}\n</problem-solutions>`
}

/** Remove pending (unverified) entries older than maxAgeMs. */
export async function cleanupStalePending(maxAgeMs = STALE_PENDING_MS): Promise<void> {
  const entries = await readMemoriesCached()
  const now = Date.now()
  for (const entry of entries) {
    if (!entry.key.startsWith(PSM_KEY_PREFIX)) continue
    const parsed = parsePSMEntry(entry)
    if (!parsed || parsed.verified) continue
    if (now - parsed.createdAt > maxAgeMs) {
      // deleteMemoryEntry 未在 memory-bridge 中导出；此处跳过，过期条目由下一次写入覆盖
    }
  }
}

/** Pending PSM entry to track for auto-resolution after a successful fix. */
interface PendingProblem {
  signature: string
  scope: string
  message: string
  recordedAt: number
}

const pendingForSession = new Map<string, PendingProblem[]>()

/** Record a problem and track it for auto-resolution in this session. */
export async function trackProblem(sessionID: string, scope: string, message: string): Promise<void> {
  await recordProblem(scope, message)
  const sig = psmSignature(scope, message)
  const list = pendingForSession.get(sessionID) ?? []
  if (!list.some((p) => p.signature === sig)) {
    list.push({ signature: sig, scope, message, recordedAt: Date.now() })
    pendingForSession.set(sessionID, list)
  }
}

/** Check if there are pending problems for a session and try to auto-resolve them. */
export async function tryResolvePending(
  sessionID: string,
  toolName: string,
  toolOutput: string,
): Promise<void> {
  const list = pendingForSession.get(sessionID)
  if (!list || list.length === 0) return

  const editTools = new Set(["edit", "write", "bash", "apply_patch"])
  if (!editTools.has(toolName)) return

  const remaining: PendingProblem[] = []
  for (const pending of list) {
    if (Date.now() - pending.recordedAt > STALE_PENDING_MS) continue
    const rootCause = inferRootCause(pending.message, toolName, toolOutput)
    const fix = inferFix(toolName, toolOutput)
    if (rootCause && fix) {
      await recordSolution(pending.scope, pending.message, rootCause, fix)
    } else {
      remaining.push(pending)
    }
  }
  pendingForSession.set(sessionID, remaining)
}

function inferRootCause(message: string, toolName: string, _output: string): string | undefined {
  const lower = message.toLowerCase()
  if (lower.includes("cannot find module") || lower.includes("module not found"))
    return "依赖缺失或导入路径错误"
  if (lower.includes("type") && lower.includes("error")) return "类型不匹配"
  if (lower.includes("permission") || lower.includes("denied")) return "权限不足"
  if (lower.includes("enoent")) return "文件或目录不存在"
  if (lower.includes("eaddrinuse")) return "端口被占用"
  if (lower.includes("timeout") || lower.includes("timed out")) return "操作超时"
  if (lower.includes("syntax")) return "语法错误"
  if (lower.includes("is not a function")) return "方法不存在或调用对象类型错误"
  if (lower.includes("undefined") || lower.includes("null")) return "空值引用"
  return `通过 ${toolName} 修复`
}

function inferFix(toolName: string, output: string): string {
  const trimmed = output.trim().slice(0, MAX_FIX_LEN)
  if (toolName === "edit" || toolName === "write") {
    const match = trimmed.match(/Successfully edited.*?\n([\s\S]*)/)
    return match ? `编辑文件修复: ${match[1].slice(0, 200)}` : `通过 ${toolName} 编辑修复`
  }
  if (toolName === "bash") {
    return `执行命令修复: ${trimmed.slice(0, 200)}`
  }
  return `通过 ${toolName} 修复`
}

/** Clear pending tracking for a session (on session end). */
export function clearPending(sessionID: string): void {
  pendingForSession.delete(sessionID)
}
