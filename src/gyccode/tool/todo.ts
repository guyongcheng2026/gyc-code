import { Effect, Schema } from "effect"
import * as Tool from "./tool"
import DESCRIPTION_WRITE from "./todowrite.txt"
import { Todo } from "../session/todo"

export const Parameters = Schema.Struct({
  todos: Schema.mutable(Schema.Array(Todo.Info)).annotate({ description: "The updated todo list" }),
})

type Metadata = {
  todos: Todo.Info[]
}


/** Min closed todos that triggers the verification reminder. */
const VERIFY_REMINDER_CLOSED_THRESHOLD = 3
const VERIFY_HINT = /verify|verification|run tests|run test|test suite|check that|validate|验证|测试/i

/**
 * Build the todowrite tool output. When 3+ todos are closed in this update and
 * no remaining/known todo mentions verification, append a reminder to verify
 * the completed work (aligned with Claude Code TodoWriteTool).
 */
export function buildTodoOutput(input: { prev: readonly Todo.Info[]; next: readonly Todo.Info[] }): string {
  const closed = input.next.filter((t) => t.status === "completed").length - input.prev.filter((t) => t.status === "completed").length
  const hasVerifyStep = input.next.some((t) => VERIFY_HINT.test(t.content)) || input.prev.some((t) => VERIFY_HINT.test(t.content))
  if (closed >= VERIFY_REMINDER_CLOSED_THRESHOLD && !hasVerifyStep) {
    return "Todos updated.\n\nYou have closed several tasks at once. Consider running a verification step (tests, typecheck, or a quick manual check) to confirm the work actually meets the requirements before reporting completion."
  }
  return "Todos updated."
}
export const TodoWriteTool = Tool.define<typeof Parameters, Metadata, Todo.Service>(
  "todowrite",
  Effect.gen(function* () {
    const todo = yield* Todo.Service

    return {
      description: DESCRIPTION_WRITE,
      parameters: Parameters,
      execute: (params: Schema.Schema.Type<typeof Parameters>, ctx: Tool.Context<Metadata>) =>
        Effect.gen(function* () {
          yield* ctx.ask({
            permission: "todowrite",
            patterns: ["*"],
            always: ["*"],
            metadata: {},
          })

          const prev = yield* todo.get(ctx.sessionID)

          yield* todo.update({
            sessionID: ctx.sessionID,
            todos: params.todos,
          })

          return {
            title: `${params.todos.filter((x) => x.status !== "completed").length} todos`,
            output: buildTodoOutput({ prev, next: params.todos }),
            metadata: {
              todos: params.todos,
            },
          }
        }),
    } satisfies Tool.DefWithoutID<typeof Parameters, Metadata>
  }),
)

