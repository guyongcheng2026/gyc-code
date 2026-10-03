/**
 * error_audit 建表语句（结构化错误落库）。
 *
 * 与 task-table.ts / cost-ledger-table.ts / permission-denial-table.ts 同模式：
 * DDL 单独成文件，供「增量迁移」与「schema.gen.ts」共用同一份字符串，避免两处
 * 手写漂移。
 *
 * 与其它三张表不同，这张表没有 session_id 外键：logError 是进程级兜底入口，
 * 大量调用点在会话之外（CLI 启动、配置加载、插件装载）。因此 session_id 只是
 * 可空列，不做级联约束——错误记录的生命周期应当跟进程走，而不是跟会话走。
 */
export const ERROR_AUDIT_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS \`error_audit\` (
  \`id\` text PRIMARY KEY,
  \`session_id\` text,
  \`scope\` text NOT NULL,
  \`message\` text NOT NULL,
  \`fields\` text,
  \`time_created\` integer NOT NULL DEFAULT (strftime('%s', 'now') * 1000)
)`

export const ERROR_AUDIT_INDEXES = [
  "CREATE INDEX IF NOT EXISTS `idx_error_audit_scope_time` ON `error_audit` (`scope`, `time_created`)",
  "CREATE INDEX IF NOT EXISTS `idx_error_audit_session_time` ON `error_audit` (`session_id`, `time_created`)",
]
