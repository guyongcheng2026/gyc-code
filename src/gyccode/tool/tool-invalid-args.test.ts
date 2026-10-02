import { describe, expect, it } from "bun:test"
import { Effect, Layer, Schema } from "effect"
import * as Tool from "./tool"
import { Truncate } from "./truncate"
import { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"

/**
 * P2-6（对标指标 10 · 编译/测试失败的结构化回灌）
 *
 * 此前 `Effect.orDie` 会把「模型参数写错」升级成进程级 defect，整轮被打断，
 * 模型连自己参数错了都不知道。修复后参数解码失败应作为普通工具输出回灌，
 * 模型可据此重试。
 */

const DemoParams = Schema.Struct({
  count: Schema.Number.annotate({ description: "必须是非负整数" }),
})

const DemoTool = Tool.define<typeof DemoParams, { preview: string; truncated: boolean; loaded: string[] }, never>(
  "demo_tool",
  Effect.succeed({
    description: "demo",
    parameters: DemoParams,
    execute: (params) =>
      Effect.sync(() => ({
        title: "ok",
        output: `count=${params.count}`,
        metadata: { preview: "ok", truncated: false, loaded: [] as string[] },
      })),
  }),
)

// Tool.define 返回的是「待 init 的 Info」，init() 才产出带 execute 的 Def。
// wrap 依赖 Truncate 与 Agent，必须给「能用」的桩而非 undefined。
const agentStub = { get: () => Effect.succeed({}), default: () => Effect.succeed({}) }
const truncateStub = { output: (text: string) => Effect.succeed({ content: text, truncated: false }) }

const stubs = Layer.mergeAll(
  Layer.succeed(Truncate.Service, truncateStub as never),
  Layer.succeed(Agent.Service, agentStub as never),
)

const ctx: Tool.Context = {
  sessionID: SessionID.make("ses_test"),
  messageID: MessageID.make("msg_test"),
  agent: "build" as never,
  abort: new AbortController().signal,
  extra: {},
  messages: [] as never,
  metadata: {} as never,
  ask: (() => Effect.succeed(undefined)) as never,
}

async function run(args: unknown) {
  const info = (await Effect.runPromise(
    (DemoTool as unknown as Effect.Effect<unknown, never, never>).pipe(Effect.provide(stubs)),
  )) as { init: () => Effect.Effect<any, never, never> }
  const def = await Effect.runPromise(info.init().pipe(Effect.provide(stubs)))
  return (await Effect.runPromise(def.execute(args, ctx))) as { output: string; metadata: { preview: string } }
}

describe("工具参数解码失败的处理（P2-6）", () => {
  it("参数合法时正常执行", async () => {
    const result = await run({ count: 3 })
    expect(result.output).toContain("count=3")
  })

  it("参数缺字段时回灌结构化错误而不是抛 defect", async () => {
    const result = await run({})
    expect(result.output).toContain('<tool_error kind="invalid_arguments" tool="demo_tool">')
    expect(result.output).toContain("请按上面的 schema 修正参数后重试")
    // 关键：说明本轮未执行，模型不会误以为操作已生效
    expect(result.output).toContain("本轮未执行任何操作")
  })

  it("参数类型错误时同样回灌，且 preview 可读", async () => {
    const result = await run({ count: "not-a-number" })
    expect(result.output).toContain("invalid_arguments")
    expect(result.metadata.preview).toContain("参数不合法")
  })
})