import { tool } from "@gyccode/protocol/plugin/tool"

/**
 * gyc-hello：最小示例插件。
 * 注册一个 hello 工具，用于验证插件市场的安装 → 加载 → 调用全链路。
 */
export default async function helloPlugin() {
  return {
    tool: {
      hello: tool({
        description: "向 gyc 打个招呼（gyc-hello 示例插件）",
        args: {
          name: tool.schema.string().optional().describe("打招呼对象"),
        },
        async execute(args, ctx) {
          const who = args.name ?? "gyc"
          return {
            title: "gyc-hello",
            output: `Hello, ${who}! 来自 gyc-hello 插件（会话 ${ctx.sessionID}）`,
          }
        },
      }),
    },
  }
}
