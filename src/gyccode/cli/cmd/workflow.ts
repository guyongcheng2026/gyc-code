import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { Effect, ManagedRuntime } from "effect"
import { WorkflowV2 } from "@gyccode/core/workflow"
import { AppNodeBuilder } from "@gyccode/core/effect/app-node-builder"
import type { WorkflowRun } from "@gyccode/schema/workflow"

/**
 * gyc workflow —— 工作流编排引擎 CLI
 *
 * 直接构建 core WorkflowV2 服务（与 server 同源），无需外部进程。
 * 子命令：defs / start / status / abort
 */

type WorkflowRuntime = ReturnType<typeof makeRuntime>

function makeRuntime() {
  return ManagedRuntime.make(AppNodeBuilder.build(WorkflowV2.node))
}

function runInRuntime<A, E>(effect: Effect.Effect<A, E>, runtime: WorkflowRuntime) {
  return runtime.runPromise(effect)
}

const directoryOf = (cwd: string, directory?: string) => (directory ? directory : cwd)

const WorkflowDefsCommand = cmd({
  command: "defs",
  describe: "list available workflow definitions",
  builder: (yargs: Argv) =>
    yargs.option("directory", {
      type: "string",
      describe: "project directory (default: cwd)",
    }),
  handler: async (args) => {
    const runtime = makeRuntime()
    try {
      const defs = await runInRuntime(WorkflowV2.Service.use((svc) => svc.defs(directoryOf(process.cwd(), args.directory))), runtime)
      if (defs.length === 0) {
        console.log("未找到工作流定义（检查 .gyccode/workflows/*.json 或全局 workflows/ 目录）")
        return
      }
      for (const def of defs) {
        console.log(`- ${def.name}${def.description ? "：" + def.description : ""}`)
        for (const step of def.steps) {
          console.log(`    ${step.id} (${step.name})${step.agent ? " [agent=" + step.agent + "]" : ""}${step.retry ? " [retry=" + step.retry + "]" : ""}`)
        }
      }
    } finally {
      runtime.disposeSync()
    }
  },
})

const WorkflowStartCommand = cmd({
  command: "start <workflow>",
  describe: "start a workflow run on a session",
  builder: (yargs: Argv) =>
    yargs
      .positional("workflow", {
        type: "string",
        describe: "workflow definition name",
      })
      .option("session", {
        type: "string",
        alias: "s",
        demandOption: true,
        describe: "session id to run the workflow on",
      })
      .option("directory", {
        type: "string",
        describe: "project directory (default: cwd)",
      }),
  handler: async (args) => {
    const runtime = makeRuntime()
    try {
      const run = await runInRuntime(
        WorkflowV2.Service.use((svc) =>
          svc.start({
            workflow: args.workflow,
            sessionID: args.session,
            directory: directoryOf(process.cwd(), args.directory),
          }),
        ),
        runtime,
      )
      console.log(`已启动工作流 ${run.workflow}（运行 ${run.id}），共 ${run.steps.length} 步`)
      for (const step of run.steps) {
        console.log(`  - ${step.stepId}: ${step.status}`)
      }
    } finally {
      runtime.disposeSync()
    }
  },
})

const WorkflowStatusCommand = cmd({
  command: "status [run]",
  describe: "show workflow run status (or list runs)",
  builder: (yargs: Argv) =>
    yargs
      .positional("run", {
        type: "string",
        describe: "workflow run id",
      })
      .option("directory", {
        type: "string",
        describe: "filter runs by directory (default: cwd)",
      }),
  handler: async (args) => {
    const runtime = makeRuntime()
    try {
      if (args.run) {
        const run = await runInRuntime(WorkflowV2.Service.use((svc) => svc.get(args.run as string)), runtime)
        if (!run) {
          console.log(`未找到运行：${args.run}`)
          return
        }
        printRun(run)
        return
      }
      const runs = await runInRuntime(WorkflowV2.Service.use((svc) => svc.list(directoryOf(process.cwd(), args.directory))), runtime)
      if (runs.length === 0) {
        console.log("暂无工作流运行记录")
        return
      }
      for (const run of runs) printRun(run)
    } finally {
      runtime.disposeSync()
    }
  },
})

const WorkflowAbortCommand = cmd({
  command: "abort <run>",
  describe: "abort a running workflow",
  builder: (yargs: Argv) =>
    yargs.positional("run", {
      type: "string",
      describe: "workflow run id",
    }),
  handler: async (args) => {
    const runtime = makeRuntime()
    try {
      await runInRuntime(WorkflowV2.Service.use((svc) => svc.abort(args.run as string)), runtime)
      console.log(`已终止运行：${args.run}`)
    } finally {
      runtime.disposeSync()
    }
  },
})

function printRun(run: WorkflowRun) {
  console.log(`运行 ${run.id}｜工作流 ${run.workflow}｜状态 ${run.status}`)
  if (run.error) console.log(`  错误：${run.error}`)
  run.steps.forEach((step, index) => {
    const current = index === run.currentStepIndex ? " ←" : ""
    const retry = step.retries ? "（重试" + step.retries + "）" : ""
    console.log(`  ${index + 1}. ${step.stepId} [${step.status}]${retry}${step.summary ? "｜" + step.summary.slice(0, 120) : ""}${current}`)
  })
}

export const WorkflowCommand = cmd({
  command: "workflow",
  describe: "workflow orchestration engine",
  builder: (yargs: Argv) =>
    yargs
      .command(WorkflowDefsCommand)
      .command(WorkflowStartCommand)
      .command(WorkflowStatusCommand)
      .command(WorkflowAbortCommand)
      .demandCommand(1, "需要指定子命令：defs / start / status / abort"),
  handler: () => {
    // 无参数时由 demandCommand 提示
  },
})
