import { WorkflowV2 } from "@gyccode/core/workflow"
import { Effect } from "effect"
import { HttpApiBuilder, HttpApiSchema } from "effect/unstable/httpapi"
import { Api } from "../api"
import { WorkflowStartBody } from "@gyccode/protocol/groups/workflow"

export const WorkflowHandler = HttpApiBuilder.group(Api, "server.workflow", (handlers) =>
  handlers
    .handle("workflow.defs", ({ query }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.defs(query.directory ?? "").pipe(Effect.orDie)
      }),
    )
    .handle("workflow.start", ({ payload }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.start(payload).pipe(Effect.orDie)
      }),
    )
    .handle("workflow.list", ({ query }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.list(query.directory ?? undefined).pipe(Effect.orDie)
      }),
    )
    .handle("workflow.get", ({ params }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.get(params.id).pipe(Effect.orDie)
      }),
    )
    .handle("workflow.abort", ({ params }) =>
      Effect.gen(function* () {
        const workflow = yield* WorkflowV2.Service
        return yield* workflow.abort(params.id).pipe(Effect.orDie)
      }),
    ),
)