import { Workflow } from "@gyccode/schema/workflow"
import { Schema } from "effect"
import { HttpApiEndpoint, HttpApiGroup, OpenApi } from "effect/unstable/httpapi"

/** 启动工作流运行的请求体 */
export const WorkflowStartBody = Schema.Struct({
  workflow: Schema.String,
  sessionID: Schema.String,
  directory: Schema.String,
})

export const WorkflowGroup = HttpApiGroup.make("server.workflow")
  .add(
    HttpApiEndpoint.get("workflow.defs", "/api/workflow/defs", {
      query: Schema.Struct({ directory: Schema.optional(Schema.String) }),
      success: Schema.Array(Workflow.WorkflowDef),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workflow.defs",
        summary: "List workflow definitions",
        description: "List user-defined workflow definitions for the given directory.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workflow.start", "/api/workflow/start", {
      body: WorkflowStartBody,
      success: Workflow.WorkflowRun,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workflow.start",
        summary: "Start a workflow run",
        description: "Start a workflow run on a session and execute steps sequentially.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workflow.list", "/api/workflow", {
      query: Schema.Struct({ directory: Schema.optional(Schema.String) }),
      success: Schema.Array(Workflow.WorkflowRun),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workflow.list",
        summary: "List workflow runs",
        description: "List workflow runs, optionally filtered by directory.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.get("workflow.get", "/api/workflow/:id", {
      path: Schema.Struct({ id: Schema.String }),
      success: Schema.optional(Workflow.WorkflowRun),
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workflow.get",
        summary: "Get a workflow run",
        description: "Get a single workflow run by id.",
      }),
    ),
  )
  .add(
    HttpApiEndpoint.post("workflow.abort", "/api/workflow/:id/abort", {
      path: Schema.Struct({ id: Schema.String }),
      success: Schema.Void,
    }).annotateMerge(
      OpenApi.annotations({
        identifier: "v2.workflow.abort",
        summary: "Abort a workflow run",
        description: "Abort a running workflow.",
      }),
    ),
  )
  .annotateMerge(
    OpenApi.annotations({
      title: "workflow",
      description: "Workflow orchestration routes.",
    }),
  )