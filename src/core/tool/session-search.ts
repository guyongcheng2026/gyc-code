export * as SessionSearchTool from "./session-search"

import { Effect, Layer, Schema } from "effect"
import { Database } from "../database/database"
import { makeLocationNode } from "../effect/app-node"
import { SessionSearch } from "../session-search"
import { ToolRegistry } from "./registry"
import { Tool } from "./tool"
import { Tools } from "./tools"

export const name = "session_search"
const DEFAULT_LIMIT = 20

export const ResultRow = Schema.Struct({
  session_id: Schema.String,
  session_title: Schema.String,
  message_id: Schema.String,
  part_id: Schema.String,
  snippet: Schema.String,
  time_created: Schema.Number,
})

export const Input = Schema.Struct({
  query: Schema.String.annotate({
    description: "Literal substring to look for in past conversation text",
  }),
  sessionID: Schema.optional(
    Schema.String.annotate({ description: "Restrict the search to a single session id" }),
  ),
  limit: Schema.optional(Schema.Number.annotate({ description: "Maximum rows to return, 1-100 (default 20)" })),
})

export const Output = Schema.Struct({
  query: Schema.String,
  results: Schema.Array(ResultRow),
})

export const description = [
  "Search past sessions by substring across stored conversation text.",
  "",
  "Use this to recall earlier decisions, error messages, code snippets or discussions without re-reading whole transcripts.",
  "Returns newest matches first with a short snippet plus session/message/part ids for follow-up reads.",
].join("\n")

type SqliteClient = Parameters<typeof SessionSearch.search>[0]

const layer = Layer.effectDiscard(
  Effect.gen(function* () {
    const tools = yield* Tools.Service
    const database = yield* Database.Service

    yield* tools
      .register({
        [name]: Tool.make({
          description,
          input: Input,
          output: Output,
          toModelOutput: ({ output }) => [
            {
              type: "text",
              text:
                output.results.length === 0
                  ? `No session content matched "${output.query}".`
                  : output.results
                      .map(
                        (row) =>
                          `[${row.time_created}] ${row.session_title || row.session_id} · message ${row.message_id} · part ${row.part_id}\n${row.snippet}`,
                      )
                      .join("\n---\n"),
            },
          ],
          execute: (input) =>
            Effect.suspend(() => {
              // The service exposes the drizzle instance; reach the underlying
              // bun:sqlite handle it wraps for the plain SQL scan.
              const client = (database.db as unknown as { $client?: SqliteClient }).$client
              if (!client) return Effect.die(new Error("sqlite client unavailable"))
              const results = SessionSearch.search(client, {
                query: input.query,
                sessionID: input.sessionID,
                limit: input.limit ?? DEFAULT_LIMIT,
              })
              return Effect.succeed({ query: input.query, results })
            }),
        }),
      })
      .pipe(Effect.orDie)
  }),
)

export const node = makeLocationNode({
  name: "tool/session-search",
  layer,
  deps: [ToolRegistry.node, Database.node],
})
