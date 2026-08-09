import { DateTime, Effect, Schema } from "effect"
import { generateObject, type ModelMessage } from "ai"
import { registerDisposer } from "@/effect/instance-registry"
import { SessionEvent, type SessionGoalVerdict } from "@gyccode/schema/session-event"
import type { SessionEventPublisher } from "./session-cwd"
import type { SessionID } from "./schema"
import type { WithParts } from "@gyccode/core/v1/session"

/**
 * Per-session stop-condition goal. A goal is a user-supplied condition that the
 * runLoop keeps working toward until an independent judge model decides the
 * condition is satisfied (or genuinely impossible). The judge is a separate,
 * low-temperature model call that only reads the session transcript - it never
 * does the work, so its verdict stays cold relative to the working agent.
 *
 * State lives in an in-memory store keyed by sessionID and is pruned when the
 * session ends (`GoalService.clear` from Session.remove) and when the hosting
 * instance is disposed (`registerDisposer`), mirroring `session-cwd.ts`.
 *
 * The LLM judge is INJECTABLE so tests run with a fake judge and never touch a
 * real model. `Goal.fake({ verdict })` builds a service whose judge always
 * returns the given verdict; `Goal.make({ events, judge, ... })` builds one
 * wired to a real (or fake) judge of the caller's choosing.
 */

export interface GoalState {
  readonly goalID?: string
  readonly condition: string
  /** Number of judge-driven re-entries so far; bounded by MAX_GOAL_REACT. */
  readonly react: number
  readonly lastVerdict?: SessionGoalVerdict
}

/** Base verdict produced by a judge before the service stamps `attempt`. */
export interface JudgeVerdict {
  readonly ok: boolean
  readonly impossible?: boolean
  readonly reason: string
}

/** What a judge receives: the session, the active condition, and the transcript. */
export interface GoalRunnerContext {
  readonly sessionID: SessionID
  readonly condition: string
  readonly msgs: readonly WithParts[]
}

export type GoalRunner = (input: GoalRunnerContext) => Effect.Effect<JudgeVerdict>

interface Entry extends GoalState {
  readonly directory?: string
}

const store = new Map<SessionID, Entry>()

// Scope the store to the instance lifetime: when an instance directory is
// disposed (workspace closed, instance switched, or server shutdown) drop every
// goal that belonged to it. Session-level pruning happens in Session.remove.
registerDisposer((directory) => {
  for (const [sessionID, entry] of store) {
    if (entry.directory === directory) store.delete(sessionID)
  }
  return Promise.resolve()
})

/** Publish the durable `session.goal` event carrying the goal + latest verdict. */
export const publishGoalUpdated = Effect.fn("Goal.publishGoalUpdated")(function* (
  events: SessionEventPublisher,
  sessionID: SessionID,
  goal: { readonly condition: string } | undefined,
  lastVerdict: SessionGoalVerdict | undefined,
) {
  yield* events.publish(SessionEvent.GoalUpdated, {
    sessionID,
    timestamp: yield* DateTime.now,
    goal,
    lastVerdict,
  })
})

export const reset = (): void => {
  store.clear()
}

/** Drop the goal state for one session (used from Session.remove cleanup). */
export const clearSession = (sessionID: SessionID): void => {
  store.delete(sessionID)
}

const noopPublisher: SessionEventPublisher = {
  publish: () => Effect.succeed(undefined as never),
}

function sameVerdict(a: SessionGoalVerdict | undefined, b: SessionGoalVerdict): boolean {
  if (!a) return false
  return a.ok === b.ok && a.impossible === b.impossible && a.reason === b.reason
}

export interface Options {
  readonly events: SessionEventPublisher
  readonly judge: GoalRunner
  /** Read the session transcript for evaluation. Defaults to an empty list. */
  readonly readTranscript?: (sessionID: SessionID) => Promise<readonly WithParts[]>
}

export interface GoalService {
  readonly get: (sessionID: SessionID) => GoalState | undefined
  readonly set: (sessionID: SessionID, condition: string, directory?: string) => Promise<void>
  readonly clear: (sessionID: SessionID) => Promise<void>
  /** Increment the judge-driven re-entry counter, returning the new count. */
  readonly bumpReact: (sessionID: SessionID) => number
  readonly evaluate: (input: {
    readonly sessionID: SessionID
    readonly msgs?: readonly WithParts[]
  }) => Promise<SessionGoalVerdict>
  readonly reset: () => void
}

/** Build a goal service with an injected event handle + judge. */
export const make = (options: Options): GoalService => {
  const events = options.events
  const readTranscript = options.readTranscript ?? (() => Promise.resolve([] as readonly WithParts[]))

  const publish = (
    sessionID: SessionID,
    goal: { readonly condition: string } | undefined,
    lastVerdict: SessionGoalVerdict | undefined,
  ) => Effect.runPromise(publishGoalUpdated(events, sessionID, goal, lastVerdict))

  return {
    get: (sessionID) => store.get(sessionID),

    set: async (sessionID, condition, directory = "") => {
      const previous = store.get(sessionID)
      // A fresh condition starts a new goal: reset the react counter and drop the
      // stale verdict. Re-setting the SAME condition keeps the last judge verdict
      // so the panel does not flash a blank status while it waits for a re-judge.
      store.set(sessionID, {
        ...(previous ? { goalID: previous.goalID } : {}),
        condition,
        react: 0,
        lastVerdict: previous?.condition === condition ? previous?.lastVerdict : undefined,
        directory,
      })
      await publish(sessionID, { condition }, store.get(sessionID)?.lastVerdict)
    },

    clear: (sessionID) => {
      store.delete(sessionID)
      return publish(sessionID, undefined, undefined)
    },

    bumpReact: (sessionID) => {
      const entry = store.get(sessionID)
      if (!entry) return 0
      const next: Entry = { ...entry, react: entry.react + 1 }
      store.set(sessionID, next)
      return next.react
    },

    evaluate: async (input) => {
      const sessionID = input.sessionID
      const entry = store.get(sessionID)
      if (!entry) throw new Error("no active goal for session " + sessionID)
      const msgs = input.msgs ?? (await readTranscript(sessionID))
      const attempt = (entry.lastVerdict?.attempt ?? 0) + 1

      let verdict: SessionGoalVerdict
      try {
        const judged = await Effect.runPromise(options.judge({ sessionID, condition: entry.condition, msgs }))
        verdict = { ...judged, attempt }
      } catch (error) {
        verdict = {
          ok: false,
          reason: error instanceof Error ? error.message : String(error),
          attempt,
          error: true,
        }
      }

      const changed = !sameVerdict(entry.lastVerdict, verdict)
      store.set(sessionID, { ...entry, lastVerdict: verdict })
      if (changed) {
        await publish(sessionID, { condition: entry.condition }, verdict)
      }
      return verdict
    },

    reset: () => store.clear(),
  }
}

/** Test-friendly factory: fake judge over a no-op event handle. */
export const fake = (
  options: { readonly verdict?: JudgeVerdict; readonly events?: SessionEventPublisher; readonly judge?: GoalRunner } = {},
): GoalService =>
  make({
    events: options.events ?? noopPublisher,
    judge: options.judge ?? (() => Effect.succeed(options.verdict ?? { ok: true, reason: "fake judge" })),
    readTranscript: () => Promise.resolve([]),
  })

// ---- Real judge (LLM). Never invoked in tests; wired by the call site. ----

const JudgeSchema = Schema.Struct({
  ok: Schema.Boolean,
  impossible: Schema.optional(Schema.Boolean),
  reason: Schema.String,
}).annotate({ identifier: "session.goal.judge" })

export const JUDGE_SYSTEM = `You are evaluating a stop-condition goal for a coding agent. Read the conversation
transcript carefully, then decide whether the user's goal condition has been satisfied.

Respond with a JSON object:
- {"ok": true, "reason": "<quote evidence from the transcript that satisfies the condition>"}
- {"ok": false, "reason": "<quote what is missing or what blocks the condition>"}
- {"ok": false, "impossible": true, "reason": "<explain why the condition can never be satisfied>"}

Always include a "reason" quoting specific transcript text when possible. When the transcript
has no clear evidence, answer {"ok": false, "reason": "insufficient evidence in transcript"}.
Only use "impossible" for conditions that are genuinely unachievable; when in doubt,
return {"ok": false} without "impossible".`

const judgeUser = (condition: string) =>
  "Based on the conversation transcript above, has the following condition been satisfied? " + condition

/**
 * Low-temperature `generateObject` judge. `messages` is the transcript
 * converted to native model messages (see `MessageV2.toModelMessagesEffect`);
 * `model` is the resolved judge language model (usually the session's
 * small/preview model). Requires a separate, colder model than the working
 * agent so the verdict stays independent of the worker's optimism.
 */
export const judge = (input: {
  readonly condition: string
  readonly messages: readonly ModelMessage[]
  readonly model: Parameters<typeof generateObject>[0]["model"]
}): Effect.Effect<JudgeVerdict> =>
  Effect.gen(function* () {
    yield* Effect.logInfo("Goal.judge", {
      condition: input.condition,
      messageCount: input.messages.length,
    })
    const params = {
      temperature: 0,
      messages: [
        { role: "system", content: JUDGE_SYSTEM } as const,
        ...input.messages,
        { role: "user", content: judgeUser(input.condition) } as const,
      ] as ModelMessage[],
      model: input.model,
      schema: Object.assign(
        Schema.toStandardSchemaV1(JudgeSchema),
        Schema.toStandardJSONSchemaV1(JudgeSchema),
      ),
    } satisfies Parameters<typeof generateObject>[0]
    const result = yield* Effect.promise(() => generateObject(params))
    return Schema.decodeUnknownSync(JudgeSchema)(result.object) as JudgeVerdict
  })

export * as Goal from "./goal"