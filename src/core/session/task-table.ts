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
  \`start_cost\` real DEFAULT 0 NOT NULL,
  \`cost\` real DEFAULT 0 NOT NULL,
  \`tokens_input\` integer DEFAULT 0 NOT NULL,
  \`tokens_output\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_read\` integer DEFAULT 0 NOT NULL,
  \`tokens_cache_write\` integer DEFAULT 0 NOT NULL,
  \`time_created\` integer NOT NULL,
  \`time_updated\` integer NOT NULL,
  \`time_completed\` integer
)`

/**
 * C-05：给已建过 task 表的库补 start_cost。
 *
 * 抽成常量同样是因为它要与建表语句保持同步——start_cost 是后加的列，
 * 增量迁移与建表必须都覆盖，否则「全新库有列、老库没列」，
 * settleTask 读到 undefined 时 task.cost 会静默算成 session 全额。
 * SQLite 的 ALTER TABLE ADD COLUMN 不支持 IF NOT EXISTS，重复执行会抛
 * duplicate column name，因此迁移 20261001000002 采用「先 PRAGMA table_info
 * 查列、再决定是否 ALTER」的幂等写法，不依赖迁移系统只跑一次。
 */
export const TASK_START_COST_ALTER = "ALTER TABLE `task` ADD COLUMN `start_cost` real DEFAULT 0 NOT NULL"