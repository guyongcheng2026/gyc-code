import { describe, expect, test } from "bun:test"
import { convertMcpJsonServers } from "./config"

describe("convertMcpJsonServers（.mcp.json → gyc MCP 配置）", () => {
  test("stdio 服务器：command + args + env 归一化为 local", () => {
    const out = convertMcpJsonServers({
      gh: { command: "npx", args: ["-y", "@modelcontextprotocol/server-github"], env: { GITHUB_TOKEN: "x" } },
    })
    expect(out.gh).toEqual({
      type: "local",
      command: ["npx", "-y", "@modelcontextprotocol/server-github"],
      environment: { GITHUB_TOKEN: "x" },
    })
  })

  test("remote 服务器：url + headers 归一化为 remote", () => {
    const out = convertMcpJsonServers({
      api: { url: "https://example.com/mcp", headers: { Authorization: "Bearer t" } },
    })
    expect(out.api).toEqual({
      type: "remote",
      url: "https://example.com/mcp",
      headers: { Authorization: "Bearer t" },
    })
  })

  test("非法条目与无法识别的 server 被跳过", () => {
    const out = convertMcpJsonServers({
      bad1: 42,
      bad2: { foo: "bar" },
      ok: { command: "node", args: [] },
    })
    expect(out.bad1).toBeUndefined()
    expect(out.bad2).toBeUndefined()
    expect(out.ok).toEqual({ type: "local", command: ["node"] })
  })

  test("非对象输入返回空对象", () => {
    expect(convertMcpJsonServers(undefined)).toEqual({})
    expect(convertMcpJsonServers("str")).toEqual({})
    expect(convertMcpJsonServers([1, 2])).toEqual({})
  })
})
