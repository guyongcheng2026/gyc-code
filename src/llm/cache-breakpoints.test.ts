// T3#9 P1：prompt cache 断点回归防护（对齐 hermes marker_count 全套语义）。
// 覆盖三层：
// 1) 策略层 applyCachePolicy——auto 恰好 4 断点（tools末+system末+tail2）、
//    tail 随消息追加滚动、none 零标记、非 anthropic-lineage 协议跳过、
//    手动 CacheHint 不被覆盖；
// 2) 协议层 cap——bedrock-cache.block 消耗共享计数、超额 dropped++（兜底）；
// 3) TTL 桶映射（anthropic cacheControl 与 block 同构共用 ttlBucket）。
import { describe, expect, test } from "bun:test"
import { applyCachePolicy } from "./cache-policy"
import { LLMRequest } from "./schema/messages"
import { CacheHint, Model } from "./schema/options"
import { BedrockCache } from "./protocols/utils/bedrock-cache"
import { newBreakpoints, ttlBucket } from "./protocols/utils/cache"

type Part = { cache?: unknown }
const hasHint = (parts: ReadonlyArray<Part>) => parts.some((p) => p.cache !== undefined)

function req(input: {
  routeID?: string
  cache?: LLMRequest["cache"]
  tools?: ReadonlyArray<unknown>
  system?: ReadonlyArray<unknown>
  messages?: ReadonlyArray<unknown>
} = {}): LLMRequest {
  const tool = (name: string) => ({ name, description: `${name} desc`, inputSchema: { type: "object" } })
  const msg = (role: string, text: string) => ({
    role,
    content: [{ type: "text", text }],
  })
  return {
    // LLMRequest.update 走 Schema.declare(value instanceof Model) 校验——
    // model 必须是真实 Model 实例；route 只被 applyCachePolicy 读 .id。
    model: new Model({
      id: "m" as never,
      provider: "p" as never,
      route: { id: input.routeID ?? "anthropic-messages" } as never,
    }),
    cache: input.cache,
    tools: input.tools ?? [tool("t1"), tool("t2"), tool("t3")],
    system: input.system ?? [
      { type: "text", text: "sys-a" },
      { type: "text", text: "sys-b" },
    ],
    messages:
      input.messages ??
      [
        msg("user", "m1"),
        msg("assistant", "m2"),
        msg("user", "m3"),
        msg("assistant", "m4"),
      ],
  } as unknown as LLMRequest
}

const summarize = (r: LLMRequest) => ({
  tools: r.tools.filter((t) => t.cache !== undefined).length,
  system: r.system.filter((p) => p.cache !== undefined).length,
  messages: r.messages.filter((m) => hasHint(m.content as ReadonlyArray<Part>)).length,
})

describe("applyCachePolicy（auto 断点布局）", () => {
  test("auto 恰好 4 断点：tools末 + system末 + messages tail2，前部不标记", () => {
    const out = applyCachePolicy(req())
    expect(summarize(out)).toEqual({ tools: 1, system: 1, messages: 2 })
    expect(out.tools.at(-1)!.cache).toBeDefined()
    expect(out.tools[0]!.cache).toBeUndefined()
    expect(out.system.at(-1)!.cache).toBeDefined()
    expect(out.system[0]!.cache).toBeUndefined()
    expect(hasHint(out.messages.at(-1)!.content as ReadonlyArray<Part>)).toBe(true)
    expect(hasHint(out.messages.at(-2)!.content as ReadonlyArray<Part>)).toBe(true)
    expect(hasHint(out.messages[0]!.content as ReadonlyArray<Part>)).toBe(false)
    const s = summarize(out)
    expect(s.tools + s.system + s.messages).toBeLessThanOrEqual(4)
  })

  test("tail 滚动：消息追加后断点落在新末 2 条（每轮从无 hint 的重建请求出发）", () => {
    const first = applyCachePolicy(req())
    expect(hasHint(first.messages.at(-1)!.content as ReadonlyArray<Part>)).toBe(true)
    const grown = req({
      // 真实链路：messages 每轮从会话重建（无旧 hint），仅 tools/system 幂等沿用
      messages: [
        ...req().messages.map((m) => ({ role: m.role, content: m.content })),
        { role: "user", content: [{ type: "text", text: "m5" }] },
        { role: "assistant", content: [{ type: "text", text: "m6" }] },
      ],
      tools: first.tools,
      system: first.system,
    })
    const out = applyCachePolicy(grown)
    expect(hasHint(out.messages.at(-1)!.content as ReadonlyArray<Part>)).toBe(true)
    expect(hasHint(out.messages.at(-2)!.content as ReadonlyArray<Part>)).toBe(true)
    // 重建的旧消息不带 hint（不跨轮累积）；tools/system 既有 hint 幂等保留
    expect(hasHint(out.messages[0]!.content as ReadonlyArray<Part>)).toBe(false)
    expect(summarize(out).messages).toBe(2)
    expect(summarize(out).tools).toBe(1)
    expect(summarize(out).system).toBe(1)
  })

  test("cache:'none' 零标记；缺省（undefined）走 auto", () => {
    expect(summarize(applyCachePolicy(req({ cache: "none" })))).toEqual({
      tools: 0,
      system: 0,
      messages: 0,
    })
    expect(summarize(applyCachePolicy(req({ cache: undefined })))).toEqual({
      tools: 1,
      system: 1,
      messages: 2,
    })
  })

  test("非 anthropic-lineage 协议（openai 等隐式缓存）整体跳过", () => {
    const out = applyCachePolicy(req({ routeID: "openai-compatible" }))
    expect(summarize(out)).toEqual({ tools: 0, system: 0, messages: 0 })
  })

  test("手动 CacheHint 保留（auto 只补空位不覆盖）", () => {
    const hint = new CacheHint({ type: "ephemeral" })
    const out = applyCachePolicy(
      req({
        system: [
          { type: "text", text: "sys-a", cache: hint },
          { type: "text", text: "sys-b" },
        ],
      }),
    )
    expect(out.system[0]!.cache).toBe(hint)
    // 末段仍被 auto 标记（last 无 hint 时补位）
    expect(out.system.at(-1)!.cache).toBeDefined()
  })
})

describe("协议层 cap 与 TTL（bedrock block；anthropic cacheControl 同构共用 ttlBucket）", () => {
  test("block 消耗 4 配额，超额 dropped++ 且不返回标记", () => {
    const bp = BedrockCache.breakpoints()
    expect(bp.remaining).toBe(BedrockCache.BEDROCK_BREAKPOINT_CAP)
    for (let i = 0; i < BedrockCache.BEDROCK_BREAKPOINT_CAP; i++) {
      expect(BedrockCache.block(bp, new CacheHint({ type: "ephemeral" }))).toBeDefined()
    }
    expect(bp.remaining).toBe(0)
    expect(BedrockCache.block(bp, new CacheHint({ type: "ephemeral" }))).toBeUndefined()
    expect(bp.dropped).toBe(1)
  })

  test("非 ephemeral/persistent hint 不消耗配额", () => {
    const bp = newBreakpoints(4)
    expect(BedrockCache.block(bp, undefined)).toBeUndefined()
    expect(bp.remaining).toBe(4)
    expect(bp.dropped).toBe(0)
  })

  test("ttl 桶：>=3600s -> 1h，其余默认 5m（undefined）", () => {
    expect(ttlBucket(undefined)).toBeUndefined()
    expect(ttlBucket(300)).toBeUndefined()
    expect(ttlBucket(3599)).toBeUndefined()
    expect(ttlBucket(3600)).toBe("1h")
    expect(ttlBucket(7200)).toBe("1h")
    const oneHour = BedrockCache.block(newBreakpoints(4), new CacheHint({ type: "ephemeral", ttlSeconds: 3600 }))
    expect(oneHour?.cachePoint.ttl).toBe("1h")
    const fiveMin = BedrockCache.block(newBreakpoints(4), new CacheHint({ type: "ephemeral", ttlSeconds: 300 }))
    expect(fiveMin?.cachePoint.ttl).toBeUndefined()
  })
})
