// 沉淀主流程单测：容错解析模型输出 + 逐条落盘 + 单条失败不中断。
// 模型调用（reviewer）与技能存储（store）全部用内存假件注入，测试不碰真实文件系统。
import { describe, expect, it } from "bun:test"
import { Effect } from "effect"
import type { ApplyResult, RejectReason, SkillInfo, SkillStore } from "./skill-store"
import { parseActions, runReview, type Reviewer, type RunReviewOptions } from "./runner"

const EMPTY_RESULT = { created: [], patched: [], wroteFiles: [], rejected: [] }

interface RecordedCalls {
  readonly creates: Array<{ name: string; description: string; body: string; sessionId: string }>
  readonly patches: Array<{ name: string; description?: string; body?: string; sessionId: string }>
  readonly writes: Array<{ name: string; filePath: string; content: string; sessionId: string }>
}

/** 内存假存储：记录调用，可指定某个技能名一律被拒。 */
function makeFakeStore(options: { reject?: string; reason?: RejectReason } = {}): {
  store: SkillStore
  calls: RecordedCalls
} {
  const calls: RecordedCalls = { creates: [], patches: [], writes: [] }
  const verdict = (name: string): ApplyResult =>
    options.reject === name
      ? { ok: false, reason: options.reason ?? "not-writable", message: `假存储拒绝写入 ${name}` }
      : { ok: true }

  const store: SkillStore = {
    list: async () => [],
    read: async (): Promise<SkillInfo | undefined> => undefined,
    readSupportFile: async () => undefined,
    create: async (input) => {
      calls.creates.push(input)
      return verdict(input.name)
    },
    patch: async (input) => {
      calls.patches.push(input)
      return verdict(input.name)
    },
    writeSupportFile: async (input) => {
      calls.writes.push(input)
      return verdict(input.name)
    },
    archive: async () => ({ ok: true }),
    restore: async () => ({ ok: true }),
  }
  return { store, calls }
}

function reviewerOf(raw: string): Reviewer {
  return () => Effect.succeed(raw)
}

function optionsFor(overrides: Partial<RunReviewOptions> & { reviewer: Reviewer }): RunReviewOptions {
  return {
    root: "C:/临时/技能根",
    sessionId: "session-1",
    transcript: "谷总：把网关限流调稳。",
    skills: ["gateway-ops"],
    loadedSkills: ["gateway-ops"],
    store: makeFakeStore().store,
    ...overrides,
  }
}

describe("learning/runner parseActions 容错解析", () => {
  it("坏 JSON / 空串 / 非数组一律返回空数组，永不抛错", () => {
    const bad = ["", "   ", "这次没有可沉淀的经验", "{\"action\":\"create\"}", "[{]", "[1,", "null", "[1,2]"]
    for (const raw of bad) {
      expect(parseActions(raw)).toEqual([])
    }
  })

  it("```json 代码块包裹并夹带解释文字时仍能解析出动作", () => {
    const raw = [
      "分析如下，本次只有一处可复用经验：",
      "```json",
      JSON.stringify([
        {
          action: "create",
          name: "gateway-ops",
          description: "网关限流调优",
          body: "先看指标再调参。",
        },
        {
          action: "write_file",
          name: "gateway-ops",
          file_path: "references/limits.md",
          content: "限流档位表",
        },
      ]),
      "```",
      "以上。",
    ].join("\n")

    const actions = parseActions(raw)
    expect(actions.map((action) => action.action)).toEqual(["create", "write_file"])
    expect(actions[0]?.name).toBe("gateway-ops")
    expect(actions[1]?.file_path).toBe("references/limits.md")
  })

  it("非法 action / 空 name / create 缺 body / write_file 缺 file_path 一律丢弃", () => {
    const raw = JSON.stringify([
      { action: "delete", name: "gateway-ops" },
      { action: "patch", name: "" },
      { action: "patch", name: 42 },
      { action: "create", name: "缺正文", description: "只给了描述" },
      { action: "create", name: "缺描述", body: "只给了正文" },
      { action: "write_file", name: "gateway-ops", content: "没给路径" },
      { action: "write_file", name: "gateway-ops", file_path: "references/a.md" },
      null,
      "字符串元素",
      { action: "patch", name: "gateway-ops", body: "只改正文" },
    ])

    const actions = parseActions(raw)
    expect(actions).toHaveLength(1)
    expect(actions[0]).toEqual({ action: "patch", name: "gateway-ops", body: "只改正文" })
  })
})

describe("learning/runner runReview 落盘编排", () => {
  it("坏输出 → 全空结果且不抛错", async () => {
    const result = await Effect.runPromise(
      runReview(optionsFor({ reviewer: reviewerOf("模型没按规定输出，也没有 JSON") })),
    )
    expect(result).toEqual(EMPTY_RESULT)
  })

  it("按 maxActions 截断，只应用前 N 条", async () => {
    const raw = JSON.stringify(
      Array.from({ length: 8 }, (_, index) => ({
        action: "create",
        name: `skill-${index}`,
        description: `第 ${index} 个`,
        body: `正文 ${index}`,
      })),
    )
    const { store, calls } = makeFakeStore()

    const result = await Effect.runPromise(
      runReview(optionsFor({ reviewer: reviewerOf(raw), store, maxActions: 3 })),
    )

    expect(calls.creates.map((call) => call.name)).toEqual(["skill-0", "skill-1", "skill-2"])
    expect(result.created).toEqual(["skill-0", "skill-1", "skill-2"])
    expect(result.rejected).toEqual([])
  })

  it("不传 maxActions 时默认最多应用 5 条", async () => {
    const raw = JSON.stringify(
      Array.from({ length: 7 }, (_, index) => ({
        action: "patch",
        name: `skill-${index}`,
        body: `正文 ${index}`,
      })),
    )
    const { store, calls } = makeFakeStore()

    const result = await Effect.runPromise(runReview(optionsFor({ reviewer: reviewerOf(raw), store })))

    expect(calls.patches).toHaveLength(5)
    expect(result.patched).toEqual(["skill-0", "skill-1", "skill-2", "skill-3", "skill-4"])
  })

  it("单条被拒不影响其余动作，rejected 记下 name 与 reason", async () => {
    const raw = JSON.stringify([
      { action: "create", name: "gateway-ops", description: "网关", body: "正文" },
      { action: "patch", name: "手写技能", body: "想改写只读技能" },
      { action: "write_file", name: "gateway-ops", file_path: "scripts/probe.sh", content: "echo hi" },
    ])
    const { store, calls } = makeFakeStore({ reject: "手写技能", reason: "not-writable" })

    const result = await Effect.runPromise(runReview(optionsFor({ reviewer: reviewerOf(raw), store })))

    expect(result.created).toEqual(["gateway-ops"])
    expect(result.patched).toEqual([])
    expect(result.wroteFiles).toEqual(["gateway-ops"])
    expect(result.rejected).toEqual([{ name: "手写技能", reason: "not-writable" }])
    expect(calls.writes.map((call) => call.filePath)).toEqual(["scripts/probe.sh"])
  })

  it("三类动作各走对应方法，并把 sessionId 透传给存储", async () => {
    const raw = JSON.stringify([
      { action: "create", name: "skill-a", description: "描述", body: "正文" },
      { action: "patch", name: "skill-b", body: "新正文" },
      {
        action: "write_file",
        name: "skill-b",
        file_path: "templates/t.md",
        content: "模板",
      },
    ])
    const { store, calls } = makeFakeStore()

    const result = await Effect.runPromise(
      runReview(optionsFor({ reviewer: reviewerOf(raw), store, sessionId: "session-9" })),
    )

    expect(calls.creates).toEqual([
      { name: "skill-a", description: "描述", body: "正文", sessionId: "session-9" },
    ])
    expect(calls.patches).toEqual([{ name: "skill-b", description: undefined, body: "新正文", sessionId: "session-9" }])
    expect(calls.writes).toEqual([
      { name: "skill-b", filePath: "templates/t.md", content: "模板", sessionId: "session-9" },
    ])
    expect(result).toEqual({
      created: ["skill-a"],
      patched: ["skill-b"],
      wroteFiles: ["skill-b"],
      rejected: [],
    })
  })

  it("store 抛错时按拒绝记账，其余动作照旧", async () => {
    const raw = JSON.stringify([
      { action: "create", name: "会炸的技能", description: "描述", body: "正文" },
      { action: "patch", name: "skill-ok", body: "正文" },
    ])
    const { store, calls } = makeFakeStore()
    store.create = async (input) => {
      calls.creates.push(input)
      throw new Error("盘炸了")
    }

    const result = await Effect.runPromise(runReview(optionsFor({ reviewer: reviewerOf(raw), store })))

    expect(result.created).toEqual([])
    expect(result.rejected).toEqual([{ name: "会炸的技能", reason: "store-error" }])
    expect(result.patched).toEqual(["skill-ok"])
  })

  it("模型调用直接失败 → 不抛错且返回空结果", async () => {
    const result = await Effect.runPromise(
      runReview(optionsFor({ reviewer: () => Effect.die(new Error("模型调用炸了")) })),
    )
    expect(result).toEqual(EMPTY_RESULT)
  })
})
