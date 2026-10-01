/**
 * cost_ledger 建表语句（C-05）。
 *
 * 与 task-table.ts 同理：全新库（schema.gen.ts）与增量迁移各有一处消费，
 * 抽成常量是为了日后加列不会只改一边。表是 append-only 成本流水，只增不改。
 */
export const COST_LEDGER_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS \`cost_ledger\` (
  \`id\` integer PRIMARY KEY AUTOINCREMENT,
  \`session_id\` text NOT NULL,
  \`task_id\` text,
  \`event_type\` text NOT NULL,
  \`cost_usd\` real NOT NULL,
  \`tokens_input\` integer NOT NULL DEFAULT 0,
  \`tokens_output\` integer NOT NULL DEFAULT 0,
  \`tokens_cache_read\` integer NOT NULL DEFAULT 0,
  \`tokens_cache_write\` integer NOT NULL DEFAULT 0,
  \`tokens_reasoning\` integer NOT NULL DEFAULT 0,
  \`cost_source\` text NOT NULL DEFAULT 'estimated',
  \`metadata\` text,
  \`time_created\` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE,
  FOREIGN KEY (\`task_id\`) REFERENCES \`task\`(\`id\`) ON DELETE SET NULL
)`

export const COST_LEDGER_INDEXES = [
  "CREATE INDEX IF NOT EXISTS `idx_cost_ledger_session_time` ON `cost_ledger` (`session_id`, `time_created`)",
  "CREATE INDEX IF NOT EXISTS `idx_cost_ledger_task` ON `cost_ledger` (`task_id`)",
]
