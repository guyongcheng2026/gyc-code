import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test"
import { mkdtemp, rm } from "fs/promises"
import { tmpdir } from "os"
import path from "path"
import { invalidateMemoryCache } from "./memory-bridge"
import {
  cleanupStalePending,
  clearPending,
  formatPSMBatchForPrompt,
  recordProblem,
  recordSolution,
  searchSolution,
  searchSolutionsByQuery,
  trackProblem,
  tryResolvePending,
} from "./problem-solution"

describe("PSM 调试全链路：记录 → 配对 → 检索 → 注入", () => {
  const prevHome = process.env.GYCCODE_MEMORY_HOME
  let home = ""
  const SESSION = "session-psm-test"

  beforeAll(async () => {
    home = await mkdtemp(path.join(tmpdir(), "gyc-psm-"))
    process.env.GYCCODE_MEMORY_HOME = home
  })

  afterAll(async () => {
    clearPending(SESSION)
    if (prevHome === undefined) delete process.env.GYCCODE_MEMORY_HOME
    else process.env.GYCCODE_MEMORY_HOME = prevHome
    await rm(home, { recursive: true, force: true })
  })

  beforeEach(() => {
    clearPending(SESSION)
    invalidateMemoryCache()
  })

  test("1. 问题记录为 pending（未验证）", async () => {
    await recordProblem("session.tools", "Cannot find module '@gyccode/core/effect/layer-node'")
    const found = await searchSolution("session.tools", "Cannot find module '@gyccode/core/effect/layer-node'")
    // pending 未验证，searchSolution 只返回 verified
    expect(found).toBeUndefined()
  })

  test("2. 工具成功后配对方案，检索可见", async () => {
    const scope = "session.tools"
    const message = "Cannot find module './missing-helper' after edit"
    await trackProblem(SESSION, scope, message)
    await tryResolvePending(SESSION, "edit", "Successfully edited src/x.ts\n+import helper")

    const found = await searchSolution(scope, message)
    expect(found).toBeDefined()
    expect(found!.verified).toBe(true)
    expect(found!.rootCause).toBeTruthy()
    expect(found!.fix).toBeTruthy()
  })

  test("3. 关键词检索 + prompt 注入格式", async () => {
    const scope = "session.tools"
    const message = "EADDRINUSE: address already in use 127.0.0.1:4000"
    await recordSolution(scope, message, "端口被占用", "释放端口或换端口重试")

    const hits = await searchSolutionsByQuery("EADDRINUSE port 127.0.0.1")
    expect(hits.length).toBeGreaterThan(0)
    expect(hits.some((h) => h.rootCause === "端口被占用")).toBe(true)

    const text = formatPSMBatchForPrompt(hits)
    expect(text).toBeDefined()
    expect(text).toContain("<problem-solutions>")
    expect(text).toContain("端口被占用")
  })

  test("4. 问题复发：verified 条目再次出现累加 hitCount", async () => {
    const scope = "session.tools"
    const message = "permission denied for write operations"
    await recordSolution(scope, message, "权限不足", "调整权限规则")

    await recordProblem(scope, message)
    await recordProblem(scope, message)

    const found = await searchSolution(scope, message)
    expect(found).toBeDefined()
    expect(found!.verified).toBe(true)
    expect(found!.hitCount).toBeGreaterThanOrEqual(2)
  })

  test("5. clearPending 清理会话内 pending 跟踪", async () => {
    await trackProblem(SESSION, "scope.x", "timeout while waiting for response")
    // 清理后配对不再发生
    clearPending(SESSION)
    await tryResolvePending(SESSION, "bash", "done")
    const found = await searchSolution("scope.x", "timeout while waiting for response")
    expect(found).toBeUndefined()
  })

  test("6. cleanupStalePending 不删除 verified 条目", async () => {
    const scope = "session.tools"
    const message = "syntax error in generated output"
    await recordSolution(scope, message, "语法错误", "修正生成模板")
    await cleanupStalePending(0) // maxAge=0：所有 pending 都过期
    const found = await searchSolution(scope, message)
    expect(found).toBeDefined()
  })
})
