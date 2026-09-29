// PTY 票据 URL 判定回归测试（等保三级 · 访问控制）
//
// hasPtyConnectTicketURL 是 Authorization 中间件的**豁免开关**：命中即跳过
// 凭据校验，改由 connect handler 消费票据。该函数判定过宽 = 鉴权被绕过；
// 判定过严 = 合法 PTY 连接失败。属于全盘失守级的高危纯函数。
import { describe, expect, test } from "bun:test"
import { hasPtyConnectTicketURL, PTY_CONNECT_TICKET_QUERY } from "@gyccode/protocol/groups/pty"

const url = (raw: string) => new URL(raw, "http://localhost")

describe("hasPtyConnectTicketURL — 正例", () => {
  test("带 ticket 的 connect 路径命中", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/sess_123/connect?ticket=abc"))).toBe(true)
  })

  test("ticket 为空字符串时不命中（空票据不得豁免鉴权）", () => {
    // searchParams.get 对 "?ticket=" 返回 ""，falsy → 不豁免。
    // 这是正确的 fail-closed 行为：空票据必须走凭据校验，不能靠带键绕过。
    expect(hasPtyConnectTicketURL(url(`/api/pty/sess_123/connect?${PTY_CONNECT_TICKET_QUERY}=`))).toBe(false)
  })

  test("ticket 可与其它 query 参数共存", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/s/connect?other=1&ticket=t"))).toBe(true)
  })

  test("路径含子目录结构时按段匹配", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/abc-def/connect?ticket=t"))).toBe(true)
  })
})

describe("hasPtyConnectTicketURL — 反例（不得豁免鉴权）", () => {
  test("无 ticket 参数不命中", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/sess_123/connect"))).toBe(false)
  })

  test("无 ticket 的其它 query 不命中", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/sess_123/connect?foo=bar"))).toBe(false)
  })

  test("非 connect 路径不命中", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/sess_123?ticket=t"))).toBe(false)
    expect(hasPtyConnectTicketURL(url("/api/pty?ticket=t"))).toBe(false)
  })

  test("connect 路径多一层不命中（防止 /connect/extra 蹭豁免）", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/s/connect/extra?ticket=t"))).toBe(false)
  })

  test("session id 含斜杠不命中（避免跨段匹配）", () => {
    expect(hasPtyConnectTicketURL(url("/api/pty/a/b/connect?ticket=t"))).toBe(false)
  })

  test("不同前缀不命中", () => {
    expect(hasPtyConnectTicketURL(url("/api/session/s/connect?ticket=t"))).toBe(false)
    expect(hasPtyConnectTicketURL(url("/pty/s/connect?ticket=t"))).toBe(false)
    expect(hasPtyConnectTicketURL(url("/api/pty/s/CONNECT?ticket=t"))).toBe(false)
  })

  test("路径中的 .. 已被 URL 规范化，仍按规范化后路径判定", () => {
    // new URL 会把 /api/pty/../pty/s/connect 归一为 /api/pty/s/connect，
    // 因此命中是正确的——这正是"规范化后再判定"想要的效果。
    expect(hasPtyConnectTicketURL(url("/api/pty/../pty/s/connect?ticket=t"))).toBe(true)
  })

  test("规范化后越出 pty 前缀则不命中", () => {
    // ".." 只消掉一段：/api/pty/s/../../pty/../pty/s/connect → /api/pty/s/connect
    // 再多退一段才会离开命名空间：
    // /api/pty/s/../../../x/connect → /x/connect，不在 pty 下。
    expect(hasPtyConnectTicketURL(url("/api/pty/s/../../../x/connect?ticket=t"))).toBe(false)
  })
})
