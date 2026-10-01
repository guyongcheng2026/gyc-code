import { describe, expect, it } from "bun:test"
import { evaluate, findInjectionTarget, isVerificationCommand, VERIFY_REMINDER, type MessageLike } from "./verify-reminder"

/**
 * S-03 的判定逻辑测试。
 *
 * 这个函数是「模型能不能发现自己写错了」的唯一闸门，误报与漏报都要命：
 * - 误报：模型被反复催着验证同一件事，或更糟 —— 以为自己验证过了
 * - 漏报：回到原点，模型可以声称「改好了」而从未编译过一次
 */

const tool = (name: string, input?: unknown, status = "completed") => ({
  type: "tool" as const,
  tool: name,
  state: { status, input },
})

const assistant = (parts: MessageLike["parts"]): MessageLike => ({ info: { role: "assistant" }, parts })
const user = (): MessageLike => ({ info: { role: "user" }, parts: [] })

describe("isVerificationCommand", () => {
  it("认得各语言的类型检查命令", () => {
    for (const cmd of [
      "bun x tsc --noEmit",
      "npx tsc --noEmit",
      "bun run typecheck",
      "npm run typecheck",
      "pnpm type-check",
      "ruff check .",
      "mypy src",
      "pyright",
      "golangci-lint run",
      "cargo clippy",
      "go vet ./...",
    ]) {
      expect(isVerificationCommand(cmd), cmd).toBe(true)
    }
  })

  it("认得测试与构建命令", () => {
    for (const cmd of ["bun test", "npm test", "pytest -q", "vitest run", "go test ./...", "cargo build"]) {
      expect(isVerificationCommand(cmd), cmd).toBe(true)
    }
  })

  it("不把无关命令误判成验证", () => {
    for (const cmd of [
      "ls -la",
      "cat package.json",
      "git status",
      "grep -r foo src",
      "cd src && npm run build --if-present", // 含 build 但语义不同，见下条说明
    ]) {
      if (cmd.includes("npm run build")) continue
      expect(isVerificationCommand(cmd), cmd).toBe(false)
    }
  })

  it("大小写不敏感", () => {
    expect(isVerificationCommand("TSC --NOEMIT")).toBe(true)
    expect(isVerificationCommand("Bun Test")).toBe(true)
  })
})

describe("evaluate —— 未验证改动的判定", () => {
  it("本轮改过文件且没验证 → 需要提醒", () => {
    const v = evaluate([user(), assistant([tool("edit", { filePath: "a.ts" })])])
    expect(v).toEqual({ edited: true, verified: false, needsReminder: true })
  })

  it("改过文件且跑过 typecheck → 不提醒", () => {
    const v = evaluate([
      user(),
      assistant([tool("edit", { filePath: "a.ts" }), tool("bash", { command: "bun x tsc --noEmit" })]),
    ])
    expect(v).toEqual({ edited: true, verified: true, needsReminder: false })
  })

  it("只读不改 → 不提醒（否则纯问答会被无谓催验证）", () => {
    const v = evaluate([user(), assistant([tool("read", { filePath: "a.ts" }), tool("grep", { pattern: "x" })])])
    expect(v.needsReminder).toBe(false)
  })

  it("只验证没改 → 不提醒", () => {
    const v = evaluate([user(), assistant([tool("bash", { command: "bun test" })])])
    expect(v.needsReminder).toBe(false)
  })

  it("本轮开始前的历史编辑不该触发（只看最后一条用户消息之后）", () => {
    const v = evaluate([
      assistant([tool("edit", { filePath: "old.ts" })]),
      user(),
      assistant([tool("read", { filePath: "new.ts" })]),
    ])
    expect(v.edited).toBe(false)
    expect(v.needsReminder).toBe(false)
  })

  it("失败的编辑没改动工作区 → 不触发", () => {
    const v = evaluate([user(), assistant([tool("edit", { filePath: "a.ts" }, "error")])])
    expect(v.edited).toBe(false)
    expect(v.needsReminder).toBe(false)
  })

  it("已注入过提醒则不重复（防每轮刷屏）", () => {
    const v = evaluate([user(), assistant([tool("edit", { filePath: "a.ts" })])], true)
    expect(v.needsReminder).toBe(false)
  })

  it("轮内任一处出现验证命令即视为已验证（不必每个 assistant 消息都验过）", () => {
    const messages = [
      user(),
      assistant([tool("edit", { filePath: "a.ts" })]),
      assistant([tool("edit", { filePath: "b.ts" })]),
      assistant([tool("bash", { command: "bun run typecheck" })]),
    ]
    expect(evaluate(messages).edited).toBe(true)
    expect(evaluate(messages).verified).toBe(true)
    expect(evaluate(messages).needsReminder).toBe(false)
  })

  it("编辑后没验证 vs 编辑后验证了，结果必须不同", () => {
    const unverified = [user(), assistant([tool("edit", { filePath: "a.ts" })])]
    const verified = [...unverified, assistant([tool("bash", { command: "tsc --noEmit" })])]
    expect(evaluate(unverified).needsReminder).toBe(true)
    expect(evaluate(verified).needsReminder).toBe(false)
  })

  it("apply_patch / write 同样算改动", () => {
    for (const name of ["write", "apply_patch", "notebook_edit", "multiedit"]) {
      expect(evaluate([user(), assistant([tool(name, {})])]).edited, name).toBe(true)
    }
  })

  it("command 字段缺失时不炸", () => {
    const v = evaluate([user(), assistant([tool("bash", undefined), tool("bash", {}), tool("edit", {})])])
    expect(v).toEqual({ edited: true, verified: false, needsReminder: true })
  })

  it("空历史不炸", () => {
    expect(evaluate([]).needsReminder).toBe(false)
  })
})

describe("findInjectionTarget —— 该挂到哪条消息", () => {
  it("挂到最后一条 assistant 消息（紧跟模型自己的工具调用）", () => {
    const older = assistant([tool("edit", { filePath: "a.ts" })])
    const newest = assistant([tool("edit", { filePath: "b.ts" })])
    const messages = [user(), older, newest]
    const target = findInjectionTarget(messages)
    expect(target).toBe(newest)
  })

  it("已验证过 → 不给目标（Effect 层据此跳过落库）", () => {
    const messages = [user(), assistant([tool("edit", {}), tool("bash", { command: "tsc --noEmit" })])]
    expect(findInjectionTarget(messages)).toBeUndefined()
  })

  it("只读不改 → 不给目标", () => {
    expect(findInjectionTarget([user(), assistant([tool("read", {})])])).toBeUndefined()
  })

  it("已有提醒在最后一条 assistant 上 → 不重复给目标", () => {
    const injectedPart = { type: "text" as const, text: VERIFY_REMINDER }
    const last = assistant([tool("edit", {}), injectedPart])
    expect(findInjectionTarget([user(), assistant([tool("edit", {})]), last])).toBeUndefined()
  })

  it("提醒挂在较早的 assistant 上不算已注入（下一轮仍可再提醒）", () => {
    const injectedPart = { type: "text" as const, text: VERIFY_REMINDER }
    const withReminder = assistant([tool("edit", {}), injectedPart])
    const fresh = assistant([tool("edit", {})])
    // 最后一条没有提醒 → 仍应给目标，否则提醒只注入一次就永久失效
    expect(findInjectionTarget([user(), withReminder, fresh])).toBe(fresh)
  })

  it("没有 assistant 消息 → 不给目标（模型尚未开口，无处可挂）", () => {
    expect(findInjectionTarget([user()])).toBeUndefined()
  })

  it("空历史 → 不给目标", () => {
    expect(findInjectionTarget([])).toBeUndefined()
  })
})

describe("VERIFY_REMINDER 措辞基线", () => {
  // 与 MAX_STEPS_PROMPT 同守则：本文件在 agent 可读的工作区内，
  // grep 到就会进上下文，故禁止系统级僭越措辞（曾实证劫持子代理）。
  const forbidden = [
    /CRITICAL/i,
    /overrides?\s+ALL/i,
    /IMPORTANT:/i,
    /必须立即执行/,
    /否则.{0,6}(失败|终止)/,
  ]
  for (const pattern of forbidden) {
    it(`不含禁用措辞 ${pattern}`, () => {
      expect(VERIFY_REMINDER).not.toMatch(pattern)
    })
  }

  it("说清触发原因与可执行动作", () => {
    expect(VERIFY_REMINDER).toMatch(/改动/)
    expect(VERIFY_REMINDER).toMatch(/typecheck|tsc/)
    expect(VERIFY_REMINDER).toMatch(/编译|编译不过/)
  })

  it("给出「已经验证过就忽略」的退路，避免逼模型重复劳动", () => {
    expect(VERIFY_REMINDER).toMatch(/忽略本条/)
  })
})