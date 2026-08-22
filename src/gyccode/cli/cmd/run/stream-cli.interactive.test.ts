import { describe, expect, it } from "bun:test"
import { streamLoop, type PermissionAsk, type QuestionAsk } from "./stream-cli"

type AnyEvent = { type: string; properties: Record<string, unknown> }

function eventsOf(list: AnyEvent[]) {
  const stream = (async function* () {
    for (const event of list) yield event
  })()
  return { stream } as never
}

function makeClient(permissionReply: (input: unknown) => void) {
  return {
    permission: { reply: permissionReply },
  } as never
}

const PERMISSION: PermissionAsk = {
  id: "p1",
  sessionID: "s1",
  permission: "bash",
  patterns: ["npm run build"],
}

const QUESTION: QuestionAsk = {
  id: "q1",
  sessionID: "s1",
  questions: [
    {
      header: "确认",
      question: "是否继续？",
      options: [{ label: "是", description: "继续" }, { label: "否" }],
      custom: false,
    },
  ],
}

const IDLE: AnyEvent = { type: "session.status", properties: { sessionID: "s1", status: { type: "idle" } } }

describe("stream-cli 交互分支（权限/问答）", () => {
  it("permission.asked 交互模式：按 askPermission 返回回复", async () => {
    const replies: unknown[] = []
    const interactive = {
      askPermission: async (permission: PermissionAsk) => {
        expect(permission.id).toBe("p1")
        return "always" as const
      },
      askQuestion: async () => [] as Array<Array<string>>,
    }
    await streamLoop({
      client: makeClient((input) => replies.push(input)),
      events: eventsOf([
        { type: "permission.asked", properties: PERMISSION },
        IDLE,
      ]),
      sessionID: "s1",
      format: "default",
      thinking: false,
      auto: false,
      interactive,
    })
    expect(replies).toEqual([{ requestID: "p1", reply: "always" }])
  })

  it("permission.asked 非交互：默认自动拒绝", async () => {
    const replies: unknown[] = []
    await streamLoop({
      client: makeClient((input) => replies.push(input)),
      events: eventsOf([
        { type: "permission.asked", properties: PERMISSION },
        IDLE,
      ]),
      sessionID: "s1",
      format: "default",
      thinking: false,
      auto: false,
    })
    expect(replies).toEqual([{ requestID: "p1", reply: "reject" }])
  })

  it("question.asked 交互模式：有答案则 reply", async () => {
    const calls: Array<{ kind: string; input: unknown }> = []
    await streamLoop({
      client: makeClient(() => {}),
      events: eventsOf([
        { type: "question.asked", properties: QUESTION },
        IDLE,
      ]),
      sessionID: "s1",
      format: "default",
      thinking: false,
      auto: false,
      interactive: {
        askPermission: async () => "once" as const,
        askQuestion: async (request: QuestionAsk) => {
          expect(request.id).toBe("q1")
          return [["是"]]
        },
      },
      question: {
        reply: async (requestID, answers) => calls.push({ kind: "reply", input: { requestID, answers } }),
        reject: async (requestID) => calls.push({ kind: "reject", input: requestID }),
      },
    })
    expect(calls).toEqual([{ kind: "reply", input: { requestID: "q1", answers: [["是"]] } }])
  })

  it("question.asked 交互模式：无答案（取消）则 reject", async () => {
    const calls: Array<{ kind: string; input: unknown }> = []
    await streamLoop({
      client: makeClient(() => {}),
      events: eventsOf([
        { type: "question.asked", properties: QUESTION },
        IDLE,
      ]),
      sessionID: "s1",
      format: "default",
      thinking: false,
      auto: false,
      interactive: {
        askPermission: async () => "once" as const,
        askQuestion: async () => undefined,
      },
      question: {
        reply: async () => calls.push({ kind: "reply", input: {} }),
        reject: async (requestID) => calls.push({ kind: "reject", input: requestID }),
      },
    })
    expect(calls).toEqual([{ kind: "reject", input: "q1" }])
  })

  it("question.asked 非交互：自动拒绝避免挂起", async () => {
    const calls: Array<{ kind: string; input: unknown }> = []
    await streamLoop({
      client: makeClient(() => {}),
      events: eventsOf([
        { type: "question.asked", properties: QUESTION },
        IDLE,
      ]),
      sessionID: "s1",
      format: "default",
      thinking: false,
      auto: false,
      question: {
        reply: async () => calls.push({ kind: "reply", input: {} }),
        reject: async (requestID) => calls.push({ kind: "reject", input: requestID }),
      },
    })
    expect(calls).toEqual([{ kind: "reject", input: "q1" }])
  })
})
