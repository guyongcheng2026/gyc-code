import { describe, expect, test } from "bun:test"
import { Effect, Layer } from "effect"
import * as Tool from "./tool"
import { nearestTools, ToolSearchTool, type SearchToolSource } from "./toolsearch"
import { Truncate } from "./truncate"
import { Agent } from "@/agent/agent"
import { SessionID, MessageID } from "@/session/schema"

/**
 * 对标 A-4（指标 13 · 幻觉率）
 *
 * 检索零命中时，旧实现把「全量工具清单」塞进工具输出，等于把整个工具目录灌进
 * 模型上下文：既污染上下文，又诱发模型照着清单瞎猜工具名。这里锁定：
 * 零命中时只给「换个词」的建议 + 邻近工具，不列全量清单。
 */

const TOOLS: SearchToolSource[] = [
  { id: "read", description: "读取文件内容" },
  { id: "glob", description: "按 glob 模式查找文件" },
  { id: "grep", description: "用正则搜索文件内容" },
  { id: "bash", description: "执行 shell 命令" },
  { id: "edit", description: "精确替换文件中的文本" },
  { id: "write", description: "写入文件" },
  { id: "patch", description: "以 diff 形式修改文件" },
  { id: "list", description: "列出目录内容" },
  { id: "todo", description: "管理待办列表" },
  { id: "task", description: "派发子代理执行任务" },
  { id: "webfetch", description: "抓取网页内容" },
  { id: "browser", description: "打开网页并截图" },
  { id: "git_status", description: "查看 git 工作区状态" },
  { id: "git_diff", description: "查看 git 改动 diff" },
  { id: "git_commit", description: "提交暂存的改动" },
  { id: "mcp_list", description: "列出已连接的 MCP 服务器" },
]

// 判定「输出里出现了哪些工具名」时用，避免子串互相误判
function mentionedIds(output: string, tools: readonly SearchToolSource[]): string[] {
  return tools.map((item) => item.id).filter((id) => output.includes(id))
}

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

async function run(query: string, maxResults?: number) {
  const info = (await Effect.runPromise(
    (
      ToolSearchTool(() => Effect.succeed(TOOLS)) as unknown as Effect.Effect<unknown, never, never>
    ).pipe(Effect.provide(stubs)),
  )) as { init: () => Effect.Effect<any, never, never> }
  const def = await Effect.runPromise(info.init().pipe(Effect.provide(stubs)))
  const args: Record<string, unknown> = { query }
  if (maxResults !== undefined) args.max_results = maxResults
  return (await Effect.runPromise(def.execute(args, ctx))) as {
    output: string
    metadata: { matches: string[] }
  }
}

describe("tool_search 零命中兜底（不泄漏全量工具清单）", () => {
  test("零命中时输出不含全部工具 id，数量不超过阈值", async () => {
    const result = await run("zzzz-not-exist")
    expect(result.metadata.matches).toEqual([])
    expect(mentionedIds(result.output, TOOLS).length).toBeLessThanOrEqual(5)
    expect(mentionedIds(result.output, TOOLS).length).toBeLessThan(TOOLS.length)
    // 旧实现会打出这句全量清单标记
    expect(result.output).not.toContain("Available tools")
  })

  test("零命中时给出「换个词」的可行动建议", async () => {
    const result = await run("zzzz-not-exist")
    expect(result.output).toContain("未找到匹配的工具")
    expect(result.output).toContain("换个")
    expect(result.output).toContain("select:")
  })

  test("零命中时按名称相近度给出邻近工具", async () => {
    const result = await run("commmit")
    expect(result.metadata.matches).toEqual([])
    expect(result.output).toContain("git_commit")
  })

  test("邻近工具按分组前缀加权，并用同族工具补齐", () => {
    expect(nearestTools("git", TOOLS, 3)).toEqual(["git_status", "git_diff", "git_commit"])
    // 拼错的 statuss 只精确命中 git_status，其余名额用 git_ 同族工具补齐
    expect(nearestTools("statuss", TOOLS, 2)).toEqual(["git_status", "git_diff"])
    expect(nearestTools("statuss", TOOLS, 3)).not.toContain("read")
    expect(nearestTools("statuss", TOOLS, 3)).not.toContain("todo")
  })

  test("完全无关的查询不硬凑邻近工具", () => {
    expect(nearestTools("zzzz-not-exist", TOOLS, 5)).toEqual([])
  })

  test("命中时仍只输出命中项，不受兜底影响", async () => {
    const result = await run("git_diff")
    expect(result.metadata.matches).toEqual(["git_diff"])
    expect(result.output).not.toContain("未找到匹配的工具")
  })
})