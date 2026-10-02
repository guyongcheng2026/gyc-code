import { describe, expect, test } from "bun:test"
import { McpCatalog } from "./mcp-catalog"

const decode = (input: unknown) => McpCatalog.decodeEntry(input)

const VALID = {
  name: "filesystem",
  description: "受限文件读写",
  transport: "stdio",
  command: ["npx", "-y", "@modelcontextprotocol/server-filesystem", "/tmp"],
  permissions: ["fs:read", "fs:write"],
  dataFlow: ["file-content"],
  repository: "https://github.com/modelcontextprotocol/servers",
}

describe("McpCatalog 条目校验", () => {
  test("合法条目解码通过", () => {
    expect(decode(VALID).name).toBe("filesystem")
  })

  test("缺 permissions 拒绝：没有权限声明的条目不允许进目录", () => {
    const { permissions, ...rest } = VALID
    expect(() => decode(rest)).toThrow()
  })

  test("缺 dataFlow 拒绝：数据流向不可省略", () => {
    const { dataFlow, ...rest } = VALID
    expect(() => decode(rest)).toThrow()
  })

  test("未知权限前缀拒绝，避免拼错后被当成无害权限", () => {
    expect(() => decode({ ...VALID, permissions: ["exec:shell"] })).toThrow()
  })

  test("带作用域的权限前缀仍然接受", () => {
    expect(() => decode({ ...VALID, permissions: ["fs:read:/home"] })).not.toThrow()
  })

  test("未知传输类型拒绝", () => {
    expect(() => decode({ ...VALID, transport: "carrier-pigeon" })).toThrow()
  })

  test("stdio 传输必须带 command", () => {
    expect(() => decode({ ...VALID, command: undefined })).toThrow()
  })

  test("stdio 传输不能同时带 url", () => {
    expect(() => decode({ ...VALID, url: "https://mcp.example.com" })).toThrow()
  })

  test("remote 传输必须带 url", () => {
    expect(() => decode({ ...VALID, command: undefined, url: undefined })).toThrow()
  })

  test("名字要符合 MCP 命名约定，避免装出无法寻址的条目", () => {
    expect(() => decode({ ...VALID, name: "有中文" })).toThrow()
    expect(() => decode({ ...VALID, name: "" })).toThrow()
  })

  test("自洽性错误要说清是哪一项对不上，而不是抛原始 schema 错误", () => {
    expect(() => decode({ ...VALID, command: undefined })).toThrow(/传输与端点不自洽/)
  })
})

describe("McpCatalog.Builtin 目录行为", () => {
  const store = McpCatalog.Builtin

  test("列出条目所需权限，stdio 按 command 推、remote 按 url 推", () => {
    const entry = store.entry("filesystem")
    expect(entry?.transport).toBe("stdio")
    expect(entry?.permissions).toContain("fs:read")
  })

  test("权限去重且顺序稳定，便于测试与展示", () => {
    expect(McpCatalog.normalize(["fs:read", "fs:read", "net:fetch"])).toEqual(["fs:read", "net:fetch"])
  })

  test("目录里每条 permissions 与 dataFlow 都非空（审计的前提）", () => {
    for (const name of store.entryNames()) {
      const entry = store.entry(name)
      expect(entry?.permissions.length).toBeGreaterThan(0)
      expect(entry?.dataFlow.length).toBeGreaterThan(0)
    }
  })

  test("目录里的每条都能通过自身的解码校验", () => {
    for (const name of store.entryNames()) expect(() => decode(store.entry(name))).not.toThrow()
  })

  test("查找不存在的条目返回 undefined，不抛错", () => {
    expect(store.entry("no-such-server")).toBeUndefined()
  })

  test("按关键词检索命中名称/描述，未命中返回空", () => {
    expect(store.search("文件").length).toBeGreaterThan(0)
    expect(store.search("zzzz-不存在")).toEqual([])
  })

  test("entryNames 覆盖目录里全部条目，便于 CLI 列表", () => {
    expect(store.entryNames().length).toBe(4)
  })

  test("toConfig 返回可直接写入 gyccode.json 的 local 配置", () => {
    const config = store.toConfig("filesystem")
    expect(config?.type).toBe("local")
    expect(config?.type === "local" ? config.command : []).toEqual([...VALID.command.slice(0, 3)])
  })

  test("toConfig 对远程条目返回 remote 配置并带 url", () => {
    const remote = decode({
      name: "remote-demo",
      description: "远程示例",
      transport: "http",
      url: "https://mcp.example.com/mcp",
      permissions: ["net:fetch"],
      dataFlow: ["conversation"],
    })
    const config = McpCatalog.of([remote]).toConfig("remote-demo")
    expect(config?.type).toBe("remote")
    expect(config?.type === "remote" ? config.url : "").toBe("https://mcp.example.com/mcp")
  })

  test("审查文案把权限与数据流向都摊开，这是目录相对 CC 的差异点", () => {
    const text = McpCatalog.describeForReview(store.entry("filesystem")!)
    expect(text).toContain("fs:read")
    expect(text).toContain("file-content")
    expect(text).toContain("stdio")
  })
})