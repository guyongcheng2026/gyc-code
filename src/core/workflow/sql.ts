import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core"
import * as DatabasePath from "../database/path"
import { Timestamps } from "../database/schema.sql"
import type { WorkflowRunStatus } from "@gyccode/schema/workflow"
import type { WorkflowRunStep } from "@gyccode/schema/workflow"

/** workflow_run 表：一次工作流运行的持久化状态（步骤状态机以 JSON 存于 steps 列） */
export const WorkflowRunTable = sqliteTable(
  "workflow_run",
  {
    id: text().primaryKey(),
    workflow: text().notNull(),
    session_id: text().notNull(),
    directory: DatabasePath.directoryColumn().notNull(),
    status: text().$type<WorkflowRunStatus>().notNull().default("pending"),
    current_step_index: integer().notNull().default(-1),
    steps: text({ mode: "json" }).$type<WorkflowRunStep[]>().notNull().default([]),
    error: text(),
    ...Timestamps,
  },
  (table) => [
    index("workflow_run_session_idx").on(table.session_id),
    index("workflow_run_workflow_idx").on(table.workflow),
  ],
)

export type WorkflowRunRow = typeof WorkflowRunTable.$inferSelect