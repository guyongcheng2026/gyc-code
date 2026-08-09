# Sidebar Workspace Par-MS (Align with MiMo-Code) + Default Simp-Chi Fixed

> **For agentic workers:** REQUIRED SUB-SKILL: Use compose:subagent (recommended) or compose:execute to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the gyc TUI right-side sidebar (workspace) to feature/XR parity with MiMo-Code (cwd / context realtime / instructions / goal / task panels) with real data, and harden the default-Simplified-Chinese response across the whole pipeline with tests.

**Architecture:** Server-side event layer (`src/schema/session-event.ts`) + effect event bus (`src/core/session`) gains two new realtime event kinds (`session.cwd`, `session.goal`) and an instructions-list event; TUI sync store (`src/tui/context/sync.tsx`) mirrors them; sidebar panels are feature-plugins registered in `src/tui/feature-plugins/builtins.ts`, each = mimo's version adapted to gyc types. Chinese is enforced server-side in the request assembly (`src/gyccode/session/llm/request.ts`) and locked by tests.

**Tech Stack:** Bun, TypeScript, Effect (@gyccode/effect-drizzle-sqlite), solid-js, opentui, yargs.

---

## Root Context / Reality-Specific Anchors (from exploration)

- MitMiror-mimo clone for reference: `<temp>\gyccode\mimo-code\packages\opencode\src\cli\cmd\tui\feature-plugins\sidebar\` has cwd.tsx/instructions.tsx/context.tsx/goal.tsx/task.tsx/todo.tsx/footer.tsx and sidebar/tps.ts.
- Each plugin: `View(props){...}` returning JSX (`<box>`/`<text fg={theme().textMuted}> `) + `const tui: TuiPlugin = async (api) => { api.slots.register({ order, slots: { sidebar_content(_ctx, props){ return <View .../> } } }) }` + export default plugin.
- Server event publish pattern: `events.publish(SessionEvent.X, {...})` (e.g. `src/gyccode/session/status.ts:41`), enabled by `withPublication(...)`; session runner emits `SessionEvent.Step.Ended` at `src/core/session/runner/llm.ts:326-341` with **`cost: 0` hardcoded**.
- Projector accumulates DB only: `src/core/session/projector.ts` `applyUsage()` (rows ~96-109) does SQL cost/tokens increment WITHOUT emitting session update events.
- TUI store: `src/tui/context/sync.tsx` `createStore` type (~70-108) with `session`, `session_diff`, `todo`, `message`, `part`, etc.; event handling `switch` begins near line 301; `session.next.moved` case updates `session.directory`/`workspaceID` (line ~336-345).
- Adapte plumbing: `src/tui/plugin/adapters.tsx` `stateApi()` lines 98-157 (**`state.session.clearCwd` DOES NOT EXIST** — we extend). `state.session.todo` reads `sync.data.todo[id]` at 131.
- Types come from npm `@opencode-ai/plugin` (TuiState.session) & `@opencode-ai/sdk/v2` — unknown events/types must be handled with local type extension / whitelist assertion, never edit the SDK gen files.
- Chinese directive: `src/gyccode/session/llm/request.ts:59-70` `languageDirective()`, injected as `system[0]` in `assembleSystemPrompt` (~82-90). Config default `language` in `src/core/v1/config/config.ts:90` (Schema.optional). Env override `GYCCODE_LANGUAGE`. For openai-oauth/deepseek/useInstructions path the directive lands in `options.instructions`.

## Spec anchor map (session-design, no md persisted due to tooling)

- [S1] background/goal; [S2] mimo ref paths; [S3.1] server events; [S3.2] cwd; [S3.3] context; [S3.4] instructions; [S3.5] goal; [S3.6] task; [S3.7] panels order; [S4] chinese; [S5] tests/verify; [S6] sync/.git hook; [S7] scope/risk.

---

### Task 1: Create event defs for session.cwd / session.goal / session.instructions (REPLACE) — [S3.1]

**Coverage:** [S1], [S3.1]

**Files:**
- Modify: `docs` -> actual: `src/schema/session-event.ts` (append near `Moved`)
- Test: `src/schema/session-event.test.ts` (new)

**Step 1: Write the failing test** — `src/schema/session-event.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { Event } from "./event"
import { SessionEvent } from "./session-event"

describe("SessionEvent new kinds", () => {
  it("SessionCwd.WorkingDirectoryChanged payload-shaped", () => {
    const e = SessionEvent.WorkingDirectory.make({
      timestamp: 1, sessionID: "s1", directory: "/proj", workedInSub: undefined,
    })
    expect(e.type).toBe("session.cwd")
    expect(e.data.cwd).toBe("/proj")
  })
  it("Goal.Updated carries goal & last verdict", () => {
    const e = SessionEvent.GoalUpdated.make({
      timestamp: 1, sessionID: "s1", goal: { condition: "write tests" },
    })
    expect(e.type).toBe("session.goal")
    expect(e.data.goal?.condition).toBe("write tests")
  })
})
```

If `OpenModes`/shape helpers unknown, verify against existing defs in the file first (they use `Event.define({ type, ...options, schema })`). Adjust `.make(...)` call to what `Event.define` exposes there.

**Step 2: Run and confirm it fails** (`bun test src/schema/session-event.test.ts`) — FAIL due to missing exported `SessionEvent.Cwd`/`Goal`.

**Step 3: Implement** in `src/schema/session-event.ts` (append after `Moved` def):

```ts
export const CwdChanged = Event.define({
  type: "session.cwd",
  ...options,
  schema: {
    ...Base,
    cwd: Schema.String,
  },
})
export type CwdChanged = typeof CwdChanged.Type

export const GoalUpdated = Event.define({
  type: "session.goal",
  ...options,
  schema: {
    ...Base,
    goal: Schema.Struct({ condition: Schema.String }).pipe(Schema.optional),
    lastVerdict: SessionGoalVerdict.pipe(optional),
  },
})
export type GoalUpdated = typeof GoalUpdated.Type

export const InstructionsListed = Event.define({
  type: "session.instructions",
  ...options,
  schema: {
    ...Base,
    files: Schema.Array(Schema.String),
  },
})
export type InstructionsListed = typeof InstructionsListed.Type
```

Also add `import { GoalVerdict } from "./session-goal"` (new file in next task) — see Task 3. For now inline a local `SessionGoalVerdict` struct.

**Step 4: run tests** → PASS.
**Step 5: commit** `feat(schema): session.cwd/session.goal/session.instructions events`.

---

### Task 2: Server cwd tracker + Goal service (+ Instructions emitter hook)

**Cover:** [S3.1], [S3.2] (cwd server), [S3.4] (instr), [S3.5] (goal serve r)

**Files:**
- Create: `src/gyccode/session/session-cwd.ts`
- Create: `src/gyccode/session/goal.ts`
- Modify: `src/gyccode/session/instruction.ts` (emit InstructionsListed on load), `src/gyccode/session/prompt.ts` (~1324) to call the emit
- Modify: `src/gyccode/tool/bash.ts` & `src/gyccode/session/processor.ts` step loop — cwd update hook
- Test: `src/gyccode/session/session-cwd.test.ts`, `goal.test.ts`

**Step 1: failing tests** — `session-cwd.test.ts`:

```ts
import { describe, expect, it } from "bun:test"
import { SessionCwd } from "./session-cwd"

describe("SessionCwd.store", () => {
  it("set/get/clear round-trip", () => {
    SessionCwd.set("s1", "/a/b")
    expect(SessionCwd.get("s1")).toBe("/a/b")
    SessionCwd.clear("s1")
    expect(SessionCwd.get("s1")).toBeUndefined()
  })
})
```

`goal.test.ts` (no LLM – use injected fake judge):

```ts
import { describe, expect, it } from "bun:test"
import { Goal } from "./goal"

describe("Goal", () => {
  it("set/clear stores & verdicts", async () => {
    const svc = Goal.fake({ verdict: { ok: true, reason: "x" } })
    await svc.set("s1", "task done")
    expect(await svc.get("s1")?.condition).toBe("task done")
    const v = await await svc.evaluate({ sessionID: "s1" })
    expect(v.ok).toBe(true)
    await svc.clear("s1")
    expect(await svc.get("s1")).toBeUndefined()
  })
})
```

**Step 2: run → FAIL**

**Step 3: implement**

`session-cwd.ts` (address `src/gyccode/session/session-cwd.ts`) — fully ASCII, model the event-bus publish shown in status.ts:41. Provide `get`/`set`/`clear` with `store = new Map<SessionID, {directory, cwd}>`, plus `publishIfChanged`.

`goal.ts` — interface `{ set, get, clear, bumpReact, evaluate }`, jury via a small `generateObject`-based judge that reads transcript & returns `Verdict`; state tuned to be test-injectable; publish `SessionEvent.GoalUpdated` on each change. Model on mimo `session/goal.ts`.

Hook cwd: in the tool-run step (bash/pty path) after the tool ends read `instancePathCwd()` and call `session-cwd.set + publish`. Find the correct spot by reading `src/gyccode/session/processor.ts`'s step loop and `src/gyccode/session/runner/*`. Connect to `InstanceState` parallel to mimo.

Hook instructions: in prompt build after `systemPaths` resolve, publish `InstructionsListed`.

**Step 4: tests pass.** **Step 5: commit `feat(session): cwd tracker broadcast + goal service + instructions event`**

---

### Task 3: Fix real cost: Step.Ended cost != 0, projector DB→event, message cost

**Cover:** [S3.3] cost

**Files:** Modify `src/core/session/runner/llm.ts:326-341`, `src/core/session/projector.ts` (after `applyUsage`), Test `src/core/session/projector.test.ts`

**Step 1: failing tests** (projector.test.ts + runner-ish unit): assert that a fictional settled token/cost delta lands on `SessionTable.cost` and that a `session.updated` event is emission with the new accumulated cost; assert model/cost math from `usage.cost`.

**Step 2: FAIL.**

**Step 3: implement:**
- In `llm.ts` replace `cost: 0` with computed `cost: costForStep` derived from `stepSettlement.tokens` and price table dec. Ensure unit testable.
- In projector `applyUsage` caller (which currently installs `.then(db.update...)` silently) after run, publish `SessionEvent.Updated` (or reuse `SessionV1.Event.Real` update) carrying `cost`/`tokens` current numbers computed from DB… but `applyUsage` is inside `events.project` where publishing inside a projection may deadlock – SIMPLEST: after `applyUsage` completes in the `.run()` chain, `events.publish` with fresh `session` row (select latest). Guard with try/catch so DB-only-mode stays.

**Step 4/5: commit** `fix(session): real Step.Ended cost + emit session.updated(cost) after usage accumulator` — prove with tests.

---

### Task 4: (TUI /*) Context panel realtime + tps + limit + cost

**Cover:** [S3.3]

**Files:**
- Create: `src/tui/feature-plugins/sidebar/tps.ts` (copy from `tps.ts` reference)
- Modify: `src/tui/feature-plugins/sidebar/context.tsx` (replace body)
- Test: `src/tui/feature-plugins/sidebar/context.test.tsx`

**Step 1: failing tests** for `tps.ts` unit (streamingTPS/completedTPS/formatTPS) and for a pure `computeContextState(messages, config)` extracted fn.

See `context.tsx` reference for exact ms; replicate: `streamingTPS(combined,start,now)`, `completedTPS(out,reason,start,now)`, `formatTPS`.

**Step 2: fail → Step3: implement**:

`context.tsx`: 
- keep `state.session.messages(id)` memo;
- `cost` = sum of `assistant.cost` (fallback `session().cost`);
- `tick` + `setInterval(1000)` when `isStreaming()`;
- `percent` via `contextWindow(config, model)`-like helper (port `Model.contextWindow` from tui util; add `limit` display `limit {effective}` + `of {hard}` when config-sourced);
- `tps` label from `tps.ts`.

**Step4: pass.** **Step5: commit `feat(sidebar): realtime Context tokens/% /spent + limit + tps`**

---

### Task 5: side panels — cwd (TUI)

**Files:** Create `src/tui/feature-plugins/sidebar/cwd.tsx`, test `src/tui/feature-plugins/sidebar/cwd.test.tsx`; Modify `src/tui/context/sync.tsx`, `src/tui/plugin/adapters.tsx` (+ local d.ts to extend `TuiState.session`).

**Step 1: failing test** — assert `<View>` renders path text via fake `api.state.session.cwd(id)`; plus adapters test: `state.session.cwd('s1')` returns `sync.data.session_cwd['s1']` — define e check type (TS compile).

**Step 2/3: implement** — sync.tsx: extend store type (`session_cwd`) + handle `case "session.cwd"`; adapters: return `cwd(id) => sync.data.session_cwd[id]`; sidebar/cwd.tsx: title `CWD` + `~`-abbrev path (use `abbreviateHome` from `src/tui/runtime.tsx:3-9`). Register order 125.

**Step 4/5: commit `feat(sidebar): add working-directory (cwd) panel`**

---

### Task 6: sidebar instructions panel

Reuse InstructionsListed event → sync store `session_instructions`; add `TuiState.instructions()`; `sidebar/instructions.tsx` (order 150); tests similar yo Task5.

---

### Task 7: sidebar goal panel

**Files:** sync case `session.goal`, `TuiState.session.goal(s)`; `sidebar/goal.tsx` (order 350, show active condition + judge status from verdicts); test. Reuse `Goal` service events (Task 2).

---

### Task 8: task/todo panel upgrade

**Files:** Create `sidebar/task.tsx` (+test) : sort by status (in_progress>open/blocked>done), collapse, recent-done tail; keep data from `state.session.todo(id)`. Optionally upgrade `todo.tsx`. Register order 400.

---

### Task 9: register panels order (builtins.ts)

**Files:** Modify `src/tui/feature-plugins/builtins.ts` — add SidebarCwd(125), SidebarInstructions(150), SidebarGoal(350), SidebarTask(400) imports and list. Keep others orders.

---

### Task 10: chinese default + tests

**Files:** Test `src/gyccode/session/llm/request.test.ts`; ensure `languageDirective` cases; `assembleSystemPrompt` yields zh directive; `prepare()` fixture system/instructions contains '简体中文'. Fix nothing server-side (already correct). Confirm i18n zh default: `src/ui/i18n` — set TUI default locale to `zh` (file to touch localize util or language provider in TUI); verify by reading `src/tui` string usage.

### Task 11: full verify & wrap

Run `bun test`, `bun tsc --noEmit` (or per-repo `bun run typecheck`), `bun run build`; manual `bun dev` sanity: sidebar order cwd→instructions→context(realtime)→mcp→lsp→goal→task→files; bash cd updates CWD panel; `/goal` sets goal & judge appears; streaming shows live tokens/tps/spent>0. Commit all; hook auto-pushes; update work log via `node scripts/worklog-sync.mjs` (from repo root).

