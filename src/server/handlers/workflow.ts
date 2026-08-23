import { WorkflowV2 } from "@gyccode/core/workflow"
import { Effect } from "effect"
import { HttpApiBuilder } from "effect/unstable/httpapi"
import { Api } from "../api"
import { WorkflowStartBody } from "@gyccode/protocol/groups/workflow"

export const WorkflowHandler = HttpApiBuilder.group(Api, "server.workflow", (handlers) =>
  handlers
    .handle("workflow.defs", ({ query }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.defs(query.directory ?? "")
      }),
    )
    .handle("workflow.start", ({ body }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.start(body)
      }),
    )
    .handle("workflow.list", ({ query }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.list(query.directory ?? undefined)
      }),
    )
    .handle("workflow.get", ({ path }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.get(path.id)
      }),
    )
    .handle("workflow.abort", ({ path }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.abort(path.id)
      }),
    ),
)