/**
 * task 表建表语句（2026-09-30 每任务真实成本 P0 / C-01）。
 *
 * 抽成常量是因为它有两个消费方：全新库的初始建表（schema.gen.ts）与增量迁移
 * （database/migration/20261001000000_task.ts）。此前 workflow_run 的两处是
 * 各写一份字符串，日后改列就会漏。
 */
export const TASK_TABLE_STATEMENT = `CREATE TABLE IF NOT EXISTS \`task\` (
  \`id\` text PRIMARY KEY NOT NULL,
  \`session_id\` text NOT NULL,
  \`message_id\` text NOT NULL,
  \`title\` text NOT NULL,
  \`status\` text DEFAULT 'running' NOT NULL,
  \`error\` text,
  \`cost\` real DEFAULT 0 NOT NULL,
  \`tokens_input\` integer DEFAULT 0 NOT NULL,
  \`tokens_output\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
  \`time_created\` integer NOT NULL,
  \`time_updated\` integer NOT NULL,
  \`time_completed\` integer
)`