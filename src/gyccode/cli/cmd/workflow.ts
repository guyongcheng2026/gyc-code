import { cmd } from "./cmd"
import type { Argv } from "yargs"
import { Effect, ManagedRuntime } from "effect"
import { WorkflowV2, Service } from "@gyccode/core/workflow"
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

function runInRuntime<A, E>(effect: Effect.Effect<A, E, Service>, runtime: WorkflowRuntime) {
  return runtime.runPromise(effect)
}

const directoryOf = (cwd: string, directory?: string) => (directory ? directory : cwd)

const WorkflowDefsCommand = cmd({
  command: "defs",
  describe: "列出可用的工作流定义",
  builder: (yargs: Argv) =>
    yargs.option("directory", {
      type: "string",
      describe: "项目目录（默认：cwd）",
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
      runtime.dispose()
    }
  },
})

const WorkflowStartCommand = cmd({
  command: "start <workflow>",
  describe: "在会话上启动工作流运行",
  builder: (yargs: Argv) =>
    yargs
      .positional("workflow", {
        type: "string",
        describe: "工作流定义名称",
      })
      .option("session", {
        type: "string",
        alias: "s",
        demandOption: true,
        describe: "运行工作流所用的会话 ID",
      })
      .option("directory", {
        type: "string",
        describe: "项目目录（默认：cwd）",
      }),
  handler: async (args) => {
    const runtime = makeRuntime()
    try {
      const run = await runInRuntime(
        WorkflowV2.Service.use((svc) =>
          svc.start({
            workflow: args.workflow!,
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
      runtime.dispose()
    }
  },
})

const WorkflowStatusCommand = cmd({
  command: "status [run]",
  describe: "显示工作流运行状态（或列出运行记录）",
  builder: (yargs: Argv) =>
    yargs
      .positional("run", {
        type: "string",
        describe: "工作流运行 ID",
      })
      .option("directory", {
        type: "string",
        describe: "按目录筛选运行记录（默认：cwd）",
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
      runtime.dispose()
    }
  },
})

const WorkflowAbortCommand = cmd({
  command: "abort <run>",
  describe: "中止正在运行的工作流",
  builder: (yargs: Argv) =>
    yargs.positional("run", {
      type: "string",
      describe: "工作流运行 ID",
    }),
  handler: async (args) => {
    const runtime = makeRuntime()
    try {
      await runInRuntime(WorkflowV2.Service.use((svc) => svc.abort(args.run as string)), runtime)
      console.log(`已终止运行：${args.run}`)
    } finally {
      runtime.dispose()
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
  describe: "工作流编排引擎",
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
