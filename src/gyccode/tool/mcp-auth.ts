import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION from "./mcp-auth.txt"
import { MCP } from "@/mcp"

export const Parameters = Schema.Struct({
  server: Schema.String.annotate({
    description: "The name of the MCP server to authenticate.",
  }),
})

export const McpAuthTool = Tool.define<typeof Parameters, Record<string, unknown>, MCP.Service>(
  "mcp_authenticate",
  Effect.gen(function* () {
    const mcp = yield* MCP.Service

    return {
      description: DESCRIPTION,
      parameters: Parameters,
      execute: (
        params: Schema.Schema.Type<typeof Parameters>,
        _ctx: Tool.Context,
      ) =>
        Effect.gen(function* () {
          const serverName = params.server

          // 检查服务器是否存在
          const statuses = yield* mcp.status()
          if (!(serverName in statuses)) {
            return {
              title: `MCP auth: ${serverName}`,
              metadata: { server: serverName, status: "not_found" },
              output: `MCP server "${serverName}" is not configured. Available servers: ${Object.keys(statuses).join(", ") || "(none)"}.`,
            }
          }

          // 检查是否支持 OAuth
          const supportsOAuth = yield* mcp.supportsOAuth(serverName).pipe(
            Effect.catch(() => Effect.succeed(false)),
          )
          if (!supportsOAuth) {
            return {
              title: `MCP auth: ${serverName}`,
              metadata: { server: serverName, status: "unsupported" },
              output: `Server "${serverName}" does not support OAuth. Ask the user to run /mcp and authenticate manually.`,
            }
          }

          // 检查是否已认证
          const authStatus = yield* mcp.getAuthStatus(serverName).pipe(
            Effect.catch(() => Effect.succeed("unknown" as const)),
          )
          if (authStatus === "authenticated") {
            return {
              title: `MCP auth: ${serverName}`,
              metadata: { server: serverName, status: "already_authenticated" },
              output: `Server "${serverName}" is already authenticated. Its tools should be available.`,
            }
          }

          // 启动 OAuth 流程，获取授权 URL
          const authResult = yield* mcp.startAuth(serverName).pipe(
            Effect.catch(() =>
              Effect.succeed({
                authorizationUrl: "",
                oauthState: "",
              }),
            ),
          )

          if (!authResult.authorizationUrl) {
            return {
              title: `MCP auth: ${serverName}`,
              metadata: { server: serverName, status: "error" },
              output: `Failed to start OAuth flow for "${serverName}". Ask the user to run /mcp and authenticate manually.`,
            }
          }

          return {
            title: `MCP auth: ${serverName}`,
            metadata: {
              server: serverName,
              status: "auth_url",
              authorizationUrl: authResult.authorizationUrl,
            },
            output: `Ask the user to open this URL in their browser to authorize the ${serverName} MCP server:\n\n${authResult.authorizationUrl}\n\nOnce they complete the flow, the server's tools will become available automatically.`,
          }
        }).pipe(Effect.orDie),
    } satisfies Tool.DefWithoutID<typeof Parameters>
  }),
)
