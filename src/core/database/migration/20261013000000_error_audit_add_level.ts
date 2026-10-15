import { Effect } from "effect"
import type { DatabaseMigration } from "../migration"

export default {
  id: "20261013000000_error_audit_add_level",
  up(tx) {
    return Effect.gen(function* () {
      // Add level column to existing error_audit table
      yield* tx.run(`ALTER TABLE \`error_audit\` ADD COLUMN \`level\` text NOT NULL DEFAULT 'error'`)
      // Create index on level column
      yield* tx.run(`CREATE INDEX IF NOT EXISTS \`idx_error_audit_level_time\` ON \`error_audit\` (\`level\`, \`time_created\`)`)
      // Backfill level from fields.level for existing records
      yield* tx.run(`
        UPDATE \`error_audit\`
        SET \`level\` = json_extract(\`fields\`, '$.level')
        WHERE \`fields\` IS NOT NULL
          AND json_type(\`fields\`) = 'object'
          AND json_extract(\`fields\`, '$.level') IS NOT NULL
          AND \`level\` = 'error'
      `)
    })
  },
} satisfies DatabaseMigration.Migration