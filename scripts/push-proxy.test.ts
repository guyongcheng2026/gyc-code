import { describe, expect, test } from "bun:test"
import { buildProxyRemote, parseCredential, pickProxy } from "./push-proxy.mjs"

describe("pickProxy", () => {
  test("显式覆盖优先于默认", () => {
    expect(pickProxy({ GYCCODE_PUSH_PROXY: "https://example.test", GH_PROXY: "https://ghfast.top" })).toBe(
      "https://example.test",
    )
  })

  test("回落到 GH_PROXY 环境变量", () => {
    expect(pickProxy({ GH_PROXY: "https://ghfast.top/" })).toBe("https://ghfast.top")
  })

  test("两者都无则返回 undefined（调用方回落直连）", () => {
    expect(pickProxy({})).toBeUndefined()
  })

  test("去掉尾部斜杠（避免拼出双斜杠）", () => {
    expect(pickProxy({ GH_PROXY: "https://ghfast.top///" })).toBe("https://ghfast.top")
  })

  test("空串与纯空白视为未设置", () => {
    expect(pickProxy({ GH_PROXY: "", GYCCODE_PUSH_PROXY: "   " })).toBeUndefined()
  })

  test("无协议时补 https://", () => {
    expect(pickProxy({ GH_PROXY: "ghfast.top" })).toBe("https://ghfast.top")
  })
})

describe("parseCredential", () => {
  test("解析 username= 与 password=", () => {
    const c = parseCredential("protocol=https\nhost=github.com\n\nusername=alice\npassword=tok123\n")
    expect(c).toEqual({ username: "alice", token: "tok123" })
  })

  test("缺 password 时返回 null", () => {
    expect(parseCredential("protocol=https\nhost=github.com\n\nusername=alice\n")).toBeNull()
  })

  test("空输入返回 null", () => {
    expect(parseCredential("")).toBeNull()
  })

  test("CRLF 行尾也能解析", () => {
    const c = parseCredential("protocol=https\r\nhost=github.com\r\n\r\nusername=a\r\npassword=b\r\n")
    expect(c).toEqual({ username: "a", token: "b" })
  })

  test("缺 username 时回落 x-access-token", () => {
    const c = parseCredential("host=github.com\n\npassword=tok\n")
    expect(c).toEqual({ username: "x-access-token", token: "tok" })
  })
})

describe("buildProxyRemote", () => {
  test("拼出带凭据的代理 URL", () => {
    expect(buildProxyRemote("https://ghfast.top", "https://github.com/o/r.git", "alice", "tok")).toBe(
      "https://alice:tok@ghfast.top/https://github.com/o/r.git",
    )
  })

  test("用户名与口令分别 URL 编码（含特殊字符）", () => {
    const url = buildProxyRemote("https://ghfast.top", "https://github.com/o/r.git", "a b", "p@ss/word")
    expect(url).toBe("https://a%20b:p%40ss%2Fword@ghfast.top/https://github.com/o/r.git")
  })

  test("代理带尾部斜杠时不产生双斜杠", () => {
    expect(buildProxyRemote("https://ghfast.top/", "https://github.com/o/r.git", "u", "t")).toBe(
      "https://u:t@ghfast.top/https://github.com/o/r.git",
    )
  })

  test("代理本身不带协议时补 https://", () => {
    expect(buildProxyRemote("ghfast.top", "https://github.com/o/r.git", "u", "t")).toBe(
      "https://u:t@ghfast.top/https://github.com/o/r.git",
    )
  })

  test("origin URL 前导斜杠被规范化", () => {
    expect(buildProxyRemote("https://ghfast.top", "github.com/o/r.git", "u", "t")).toBe(
      "https://u:t@ghfast.top/github.com/o/r.git",
    )
  })
})
