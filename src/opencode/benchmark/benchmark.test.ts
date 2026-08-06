// gyc-cli 能力基准测试 — 对标 mimo-code 20 项核心能力
// 运行: bun test src/opencode/benchmark/benchmark.test.ts
import { test, expect } from "bun:test"

// 1. CLI 启动
test("01: CLI 可启动 (--help)", async () => {
  const proc = Bun.spawn(["bun", "run", "--conditions=browser", "src/opencode/index.ts", "--help"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exit, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  expect(exit).toBe(0)
  expect(stdout.length + stderr.length).toBeGreaterThan(100)
})

// 2. 模型列表
test("02: 模型列表", async () => {
  const proc = Bun.spawn(["bun", "run", "--conditions=browser", "src/opencode/index.ts", "models", "deepseek"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exit, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  expect(exit).toBe(0)
  expect(stdout).toContain("deepseek-chat")
})

// 3. Provider 配置
test("03: Provider 配置加载", async () => {
  const proc = Bun.spawn(["bun", "run", "--conditions=browser", "src/opencode/index.ts", "debug", "config"], {
    cwd: process.cwd(),
    stdout: "pipe",
    stderr: "pipe",
  })
  const [exit, stdout] = await Promise.all([proc.exited, new Response(proc.stdout).text()])
  expect(exit).toBe(0)
  const cfg = JSON.parse(stdout)
  expect(cfg.provider).toBeDefined()
  expect(Object.keys(cfg.provider).length).toBeGreaterThan(0)
})

// 4. Memory Bridge 模块
test("04: Memory Bridge 模块可加载", async () => {
  const mod = await import("../memory/hermes-bridge")
  expect(mod.readHermesMemories).toBeDefined()
  expect(mod.writeHermesMemoryFile).toBeDefined()
})

// 5. Composer 模块
test("05: Composer 模块可加载", async () => {
  const mod = await import("../composer/index")
  expect(mod.Composer).toBeDefined()
})

// 6. Memory Bridge 读取
test("06: Memory Bridge 读取 Hermes 记忆", async () => {
  const { readHermesMemories } = await import("../memory/hermes-bridge")
  const memories = await readHermesMemories()
  expect(Array.isArray(memories)).toBe(true)
})

// 7. LLM 协议模块
test("07: LLM 协议模块存在", async () => {
  const files = ["src/llm/protocols/openai-chat.ts", "src/llm/protocols/openai-compatible-chat.ts", "src/llm/protocols/openai-responses.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 8. Skill 系统
test("08: Skill 系统存在", async () => {
  const files = ["src/opencode/skill/index.ts", "src/opencode/skill/discovery.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 9. Session 系统
test("09: Session 系统存在", async () => {
  const files = ["src/opencode/session/prompt.ts", "src/opencode/session/processor.ts", "src/opencode/session/llm.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 10. Server HTTP API
test("10: Server API 存在", async () => {
  const files = ["src/server/api.ts", "src/server/handlers/session.ts", "src/server/handlers/message.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 11. MCP 支持
test("11: MCP 支持存在", async () => {
  const files = ["src/opencode/mcp/index.ts", "src/opencode/mcp/auth.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 12. Agent 系统
test("12: Agent 系统存在", async () => {
  const files = ["src/opencode/agent/agent.ts", "src/opencode/session/run-state.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 13. 工具系统
test("13: 工具系统存在", async () => {
  const files = ["src/opencode/tool/apply_patch.ts", "src/opencode/tool/edit.ts", "src/opencode/tool/code-mode.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 14. 权限系统
test("14: 权限系统存在", async () => {
  const files = ["src/opencode/permission/index.ts", "src/core/permission.ts"]
  const results = []
  for (const f of files) {
    results.push(await Bun.file(f).exists())
  }
  expect(results.some(Boolean)).toBe(true)
})

// 15. 后台任务
test("15: 后台任务系统存在", async () => {
  const files = ["src/opencode/background/job.ts", "src/core/background-job.ts"]
  const results = []
  for (const f of files) {
    results.push(await Bun.file(f).exists())
  }
  expect(results.some(Boolean)).toBe(true)
})

// 16. 快照系统
test("16: 快照系统存在", async () => {
  const files = ["src/opencode/snapshot/index.ts", "src/core/snapshot.ts"]
  const results = []
  for (const f of files) {
    results.push(await Bun.file(f).exists())
  }
  expect(results.some(Boolean)).toBe(true)
})

// 17. 同步系统
test("17: 同步系统存在", async () => {
  const files = ["src/opencode/sync/schema.ts", "src/opencode/sync/README.md"]
  const results = []
  for (const f of files) {
    results.push(await Bun.file(f).exists())
  }
  expect(results.some(Boolean)).toBe(true)
})

// 18. 事件系统
test("18: 事件系统存在", async () => {
  const files = ["src/opencode/event-v2-bridge.ts", "src/core/event.ts"]
  for (const f of files) {
    const stat = await Bun.file(f).exists()
    expect(stat).toBe(true)
  }
})

// 19. 插件系统
test("19: 插件系统存在", async () => {
  const files = ["src/opencode/plugin/index.ts", "src/core/plugin/index.ts"]
  const results = []
  for (const f of files) {
    results.push(await Bun.file(f).exists())
  }
  expect(results.some(Boolean)).toBe(true)
})

// 20. 数据库/存储
test("20: 数据库存储存在", async () => {
  const files = ["src/core/database/index.ts", "src/core/database/sqlite.bun.ts", "src/effect-drizzle-sqlite/index.ts"]
  const results = []
  for (const f of files) {
    results.push(await Bun.file(f).exists())
  }
  expect(results.some(Boolean)).toBe(true)
})
