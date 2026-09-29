// rate-limit.ts 回归测试（等保三级 · 入侵防范）
//
// 令牌桶是抗暴破/抗 DoS 的唯一闸门。此前 0 测试，而这里的判定一旦被放宽，
// 攻击者即可用随机 Basic 用户名轮换绕过限流（每个新 key 都有独立满桶）。
import { afterEach, describe, expect, test } from "bun:test"
import { HttpServerRequest } from "effect/unstable/http"
import {
  __bucketCountForTest,
  __resetBucketsForTest,
  credentialsFromRequest,
  RATE_LIMIT_PARAMS,
  take,
} from "./rate-limit"

afterEach(() => __resetBucketsForTest())

describe("take — 已认证请求方", () => {
  test("按满桶起步，连续 CAPACITY 次全部放行", () => {
    const { CAPACITY } = RATE_LIMIT_PARAMS
    let allowed = 0
    for (let i = 0; i < CAPACITY; i++) if (take("alice", true)) allowed++
    expect(allowed).toBe(CAPACITY)
  })

  test("超出容量后被限流", () => {
    const { CAPACITY } = RATE_LIMIT_PARAMS
    for (let i = 0; i < CAPACITY; i++) take("alice", true)
    expect(take("alice", true)).toBe(false)
  })

  test("重复放行不会重复扣减已为 0 的桶（不产生负数令牌）", () => {
    const { CAPACITY } = RATE_LIMIT_PARAMS
    for (let i = 0; i < CAPACITY + 5; i++) take("alice", true)
    // 桶已耗尽：再取仍是 false，且不会因 -1 而在补充后"提前恢复"
    expect(take("alice", true)).toBe(false)
  })
})

describe("take — 未认证请求方（新 key 小额度起步）", () => {
  test("新 key 仅有 NEW_KEY_TOKENS 额度（防轮换绕过）", () => {
    const { NEW_KEY_TOKENS } = RATE_LIMIT_PARAMS
    let allowed = 0
    for (let i = 0; i < NEW_KEY_TOKENS; i++) if (take("attacker-1", false)) allowed++
    expect(allowed).toBe(NEW_KEY_TOKENS)
    expect(take("attacker-1", false)).toBe(false)
  })

  test("轮换 100 个随机用户名无法获得 100×CAPACITY 的额度", () => {
    const { NEW_KEY_TOKENS, CAPACITY } = RATE_LIMIT_PARAMS
    // 每个新 key 首请求放行（消耗其 8 枚额度中的 1 枚）
    let allowed = 0
    for (let i = 0; i < 100; i++) if (take(`random-${i}`, false)) allowed++
    // 若按"新桶即满桶"实现，攻击者 100 个身份可得 100*CAPACITY 额度
    expect(allowed).toBe(100)
    expect(allowed).toBeLessThan(CAPACITY / 2)
    expect(NEW_KEY_TOKENS).toBeLessThan(CAPACITY)
  })

  test("不同 key 的桶相互独立", () => {
    const { NEW_KEY_TOKENS } = RATE_LIMIT_PARAMS
    for (let i = 0; i < NEW_KEY_TOKENS; i++) take("a", false)
    expect(take("a", false)).toBe(false)
    expect(take("b", false)).toBe(true)
  })
})

describe("take — 内存有界", () => {
  test("桶数超过上限时按 LRU 淘汰，不无界增长", () => {
    const { MAX_BUCKETS } = RATE_LIMIT_PARAMS
    // 远超上限的新 key
    for (let i = 0; i < MAX_BUCKETS + 50; i++) take(`k-${i}`, false)
    expect(__bucketCountForTest()).toBeLessThanOrEqual(MAX_BUCKETS)
  })

  test("淘汰不整体清空（否则攻击者一键恢复所有桶）", () => {
    const { MAX_BUCKETS, CAPACITY } = RATE_LIMIT_PARAMS
    for (let i = 0; i < MAX_BUCKETS; i++) take(`victim-${i}`, true)
    // 触发一次淘汰
    take("intruder", false)
    // 最早的桶应被淘汰，但绝大多数受害者桶仍在
    let survivors = 0
    for (let i = 0; i < MAX_BUCKETS; i++) if (take(`victim-${i}`, true)) survivors++
    expect(survivors).toBeGreaterThan(MAX_BUCKETS * 0.9)
    expect(survivors).toBeLessThanOrEqual(CAPACITY + MAX_BUCKETS)
  })
})

describe("credentialsFromRequest", () => {
  const makeRequest = (headers: Record<string, string>) =>
    HttpServerRequest.fromWeb(
      new Request("http://localhost/api/session", {
        method: "GET",
        headers: Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v])),
      }),
    )

  test("合法 Basic 头被正确拆分", () => {
    const raw = Buffer.from("alice:s3cret", "utf8").toString("base64")
    const result = credentialsFromRequest(makeRequest({ authorization: `Basic ${raw}` }))
    expect(result.username).toBe("alice")
    expect(result.password).toBe("s3cret")
  })

  test("口令含冒号时按首个冒号切分", () => {
    const raw = Buffer.from("alice:pa:ss", "utf8").toString("base64")
    const result = credentialsFromRequest(makeRequest({ authorization: `Basic ${raw}` }))
    expect(result.username).toBe("alice")
    expect(result.password).toBe("pa:ss")
  })

  test("无 Authorization 头归为 anonymous", () => {
    expect(credentialsFromRequest(makeRequest({}))).toEqual({ username: "anonymous", password: "" })
  })

  test("非 Basic 方案归为 anonymous", () => {
    expect(credentialsFromRequest(makeRequest({ authorization: "Bearer xyz" }))).toEqual({
      username: "anonymous",
      password: "",
    })
  })

  test("无冒号的 base64 载荷归为 anonymous（不猜用户名）", () => {
    const raw = Buffer.from("no-separator", "utf8").toString("base64")
    expect(credentialsFromRequest(makeRequest({ authorization: `Basic ${raw}` }))).toEqual({
      username: "anonymous",
      password: "",
    })
  })

  test("空口令仍算具名用户（分桶维度，不影响鉴权判定）", () => {
    const raw = Buffer.from("carol:", "utf8").toString("base64")
    const result = credentialsFromRequest(makeRequest({ authorization: `Basic ${raw}` }))
    expect(result.username).toBe("carol")
    expect(result.password).toBe("")
  })

  test("含非 base64 字符的头归为 anonymous", () => {
    expect(credentialsFromRequest(makeRequest({ authorization: "Basic !!!not-base64!!!" }))).toEqual({
      username: "anonymous",
      password: "",
    })
  })
})
