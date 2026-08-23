import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20260823000000_workflow",
  up(tx) {
    return Effect.gen(function* () {
      yield* tx.run(`
        CREATE TABLE IF NOT EXISTS \`workflow_run\` (
          \`id\` text PRIMARY KEY NOT NULL,
          \`workflow\` text NOT NULL,
          \`session_id\` text NOT NULL,
          \`directory\` text NOT NULL,
          \`status\` text DEFAULT 'pending' NOT NULL,
          \`current_step_index\` integer DEFAULT -1 NOT NULL,
          \`steps\` text DEFAULT '[]' NOT NULL,
          \`error\` text,
          \`time_created\` integer NOT NULL,
          \`time_updated\` integer NOT NULL
        );
      `)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`workflow_run_session_idx\` ON \`workflow_run\` (\`session_id\`);`)
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`workflow_run_workflow_idx\` ON \`workflow_run\` (\`workflow\`);`)
    })
  },
} satisfies DatabaseMigration.Migration