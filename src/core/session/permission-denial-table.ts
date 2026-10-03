/**
 * permission_denials 建表语句（A-5）。
 *
 * 与 task-table.ts / cost-ledger-table.ts 同模式：DDL 单独成文件，供「迁移」与
 * 「schema.gen.ts」共用同一份字符串，杜绝两处手写漂移。
 */
export const PERMISSION_DENIALS_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS \`permission_denials\` (
  \`id\` text PRIMARY KEY,
  \`session_id\` text,
  \`permission\` text NOT NULL,
  \`patterns\` text NOT NULL,
  \`reason\` text NOT NULL,
  \`time_created\` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000),
  FOREIGN KEY (\`session_id\`) REFERENCES \`session\`(\`id\`) ON DELETE CASCADE
)`

export const PERMISSION_DENIALS_INDEXES = [
  "CREATE INDEX IF NOT EXISTS `idx_permission_denials_session_time` ON `permission_denials` (`session_id`, `time_created`)",
]
