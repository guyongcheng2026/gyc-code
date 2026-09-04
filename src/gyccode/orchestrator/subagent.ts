// Sub-Agent Orchestrator — 子智能体编排引擎
// 支持复杂任务分解、并行执行、结果聚合

import { Effect, Context, Layer } from "effect"
import { SkillInfo, SkillRegistry, SkillRegistryService } from "../skills/skill-registry"
import { z } from "zod"

export interface SubAgentSpec {
  id: string
  skillId: string
  name: string
  description: string
  inputSchema: z.ZodSchema
  outputSchema: z.ZodSchema
  timeoutMs: number
  retryCount: number
  dependencies: string[] // 依赖的其他子任务 ID
  parallel: boolean // 是否可并行执行
}

export interface SubAgentTask {
  spec: SubAgentSpec
  input: unknown
  context: Record<string, unknown>
}

export interface SubAgentResult {
  taskId: string
  skillId: string
  success: boolean
  output?: unknown
  error?: string
  durationMs: number
  retries: number
}

export interface OrchestrationPlan {
  taskId: string
  name: string
  description: string
  tasks: SubAgentSpec[]
  globalTimeoutMs: number
}

export interface OrchestrationResult {
  planId: string
  success: boolean
  results: SubAgentResult[]
  aggregatedOutput?: unknown
  totalDurationMs: number
  errors: string[]
}

/** 子智能体执行器接口 */
export interface SubAgentExecutor {
  execute: (task: SubAgentTask) => Effect.Effect<SubAgentResult>
  validateInput: (input: unknown, schema: z.ZodSchema) => Effect.Effect<void>
  validateOutput: (output: unknown, schema: z.ZodSchema) => Effect.Effect<void>
}

/** 编排引擎接口 */
export interface Orchestrator {
  createPlan: (name: string, description: string, tasks: SubAgentSpec[]) => OrchestrationPlan
  executePlan: (plan: OrchestrationPlan, initialInput: Record<string, unknown>) => Effect.Effect<OrchestrationResult>
  executeTask: (task: SubAgentTask) => Effect.Effect<SubAgentResult>
}

/** 任务图拓扑排序 */
function topologicalSort(tasks: SubAgentSpec[]): SubAgentSpec[][] {
  const graph = new Map<string, SubAgentSpec>()
  const inDegree = new Map<string, number>()

  for (const task of tasks) {
    graph.set(task.id, task)
    inDegree.set(task.id, 0)
  }

  for (const task of tasks) {
    for (const dep of task.dependencies) {
      if (graph.has(dep)) {
        inDegree.set(task.id, (inDegree.get(task.id) || 0) + 1)
      }
    }
  }

  const levels: SubAgentSpec[][] = []
  let queue = Array.from(graph.values()).filter(t => inDegree.get(t.id) === 0)

  while (queue.length > 0) {
    levels.push(queue)
    const nextQueue: SubAgentSpec[] = []

    for (const task of queue) {
      for (const other of graph.values()) {
        if (other.dependencies.includes(task.id)) {
          const newDegree = (inDegree.get(other.id) || 0) - 1
          inDegree.set(other.id, newDegree)
          if (newDegree === 0) {
            nextQueue.push(other)
          }
        }
      }
    }

    queue = nextQueue
  }

  // 检查循环依赖
  const totalSorted = levels.flat().length
  if (totalSorted !== tasks.length) {
    throw new Error("Circular dependency detected in sub-agent tasks")
  }

  return levels
}

/** 创建子智能体执行器 */
export function createSubAgentExecutor(skillRegistry: SkillRegistry): SubAgentExecutor {
  const execute = (task: SubAgentTask): Effect.Effect<SubAgentResult> =>
    Effect.gen(function* () {
      const startTime = Date.now()
      let retries = 0
      const maxRetries = task.spec.retryCount

      while (retries <= maxRetries) {
        try {
          // 验证输入
          yield* Effect.try({
            try: () => task.spec.inputSchema.parse(task.input),
            catch: (e) => new Error(`Input validation failed: ${e}`),
          }).pipe(Effect.orDie)

          // 获取技能
          const skill = yield* skillRegistry.getSkill(task.spec.skillId)
          if (!skill) {
            throw new Error(`Skill not found: ${task.spec.skillId}`)
          }

          // 这里应该调用实际的技能执行逻辑
          // 目前模拟执行
          const output = yield* simulateSkillExecution(skill, task.input, task.context)

          // 验证输出
          yield* Effect.try({
            try: () => task.spec.outputSchema.parse(output),
            catch: (e) => new Error(`Output validation failed: ${e}`),
          }).pipe(Effect.orDie)

          return {
            taskId: task.spec.id,
            skillId: task.spec.skillId,
            success: true,
            output,
            durationMs: Date.now() - startTime,
            retries,
          }
        } catch (error) {
          retries++
          if (retries > maxRetries) {
            return {
              taskId: task.spec.id,
              skillId: task.spec.skillId,
              success: false,
              error: error instanceof Error ? error.message : String(error),
              durationMs: Date.now() - startTime,
              retries: retries - 1,
            }
          }
          // 等待后重试
          yield* Effect.sleep(`${retries * 100} millis`)
        }
      }

      // 不应该到达这里
      throw new Error("Unexpected execution state")
    })

  const validateInput = (input: unknown, schema: z.ZodSchema) =>
    Effect.try({
      try: () => schema.parse(input),
      catch: (e) => new Error(`Input validation failed: ${e}`),
    }).pipe(Effect.asVoid, Effect.orDie)

  const validateOutput = (output: unknown, schema: z.ZodSchema) =>
    Effect.try({
      try: () => schema.parse(output),
      catch: (e) => new Error(`Output validation failed: ${e}`),
    }).pipe(Effect.asVoid, Effect.orDie)

  return { execute, validateInput, validateOutput }
}

/** 模拟技能执行（实际应替换为真实的技能调用） */
function simulateSkillExecution(skill: SkillInfo, input: unknown, context: Record<string, unknown>): Effect.Effect<unknown> {
  return Effect.gen(function* () {
    // 模拟执行延迟
    yield* Effect.sleep("100 millis")

    // 根据技能类型返回模拟结果
    switch (skill.category) {
      case "development":
        return { code: "// Generated code", files: ["file1.ts", "file2.ts"] }
      case "testing":
        return { tests: ["test1", "test2"], coverage: 85 }
      case "documentation":
        return { docs: ["api.md", "readme.md"] }
      default:
        return { result: "completed", input }
    }
  })
}

/** 创建编排引擎 */
export function createOrchestrator(skillRegistry: SkillRegistry): Orchestrator {
  const executor = createSubAgentExecutor(skillRegistry)

  const createPlan = (name: string, description: string, tasks: SubAgentSpec[]): OrchestrationPlan => {
    const globalTimeoutMs = tasks.reduce((sum, t) => sum + t.timeoutMs, 0) * 2
    return {
      taskId: `plan_${Date.now()}`,
      name,
      description,
      tasks,
      globalTimeoutMs,
    }
  }

  const executePlan = (plan: OrchestrationPlan, initialInput: Record<string, unknown>): Effect.Effect<OrchestrationResult> =>
    Effect.gen(function* () {
      const startTime = Date.now()
      const levels = topologicalSort(plan.tasks)
      const allResults: SubAgentResult[] = []
      const context: Record<string, unknown> = { ...initialInput }
      const errors: string[] = []

      for (const level of levels) {
        // 并行执行同一层级的任务
        const parallelTasks = level.filter(t => t.parallel)
        const sequentialTasks = level.filter(t => !t.parallel)

        // 先执行并行任务
        if (parallelTasks.length > 0) {
          const parallelResults = yield* Effect.all(
            parallelTasks.map(task => {
              const taskInput = { ...context, ...initialInput }
              return executor.execute({
                spec: task,
                input: taskInput,
                context,
              })
            }),
            { concurrency: "unbounded" }
          )
          allResults.push(...parallelResults)

          // 更新上下文
          for (const result of parallelResults) {
            if (result.success && result.output) {
              context[result.taskId] = result.output
            } else if (!result.success) {
              errors.push(`${result.taskId}: ${result.error}`)
            }
          }
        }

        // 再执行串行任务
        for (const task of sequentialTasks) {
          const taskInput = { ...context, ...initialInput }
          const result = yield* executor.execute({ spec: task, input: taskInput, context })
          allResults.push(result)

          if (result.success && result.output) {
            context[result.taskId] = result.output
          } else if (!result.success) {
            errors.push(`${result.taskId}: ${result.error}`)
          }
        }
      }

      // 聚合输出
      const aggregatedOutput = aggregateResults(allResults, context)

      const success = errors.length === 0 && allResults.every(r => r.success)

      return {
        planId: plan.taskId,
        success,
        results: allResults,
        aggregatedOutput,
        totalDurationMs: Date.now() - startTime,
        errors,
      }
    })

  const executeTask = (task: SubAgentTask) => executor.execute(task)

  return { createPlan, executePlan, executeTask }
}

/** 聚合多个子任务结果 */
function aggregateResults(results: SubAgentResult[], context: Record<string, unknown>): unknown {
  const successful = results.filter(r => r.success)
  const failed = results.filter(r => !r.success)

  return {
    summary: {
      total: results.length,
      successful: successful.length,
      failed: failed.length,
    },
    outputs: successful.reduce((acc, r) => {
      acc[r.taskId] = r.output
      return acc
    }, {} as Record<string, unknown>),
    errors: failed.map(r => ({ taskId: r.taskId, error: r.error })),
    context,
  }
}

/** 预定义的常用编排计划 */
export const PREDEFINED_PLANS = {
  /** 完整 CRUD 生成计划 */
  fullCrudGeneration: (
    entityName: string,
    fields: Record<string, string>
  ): OrchestrationPlan => {
    const baseTasks: SubAgentSpec[] = [
      {
        id: "generate-model",
        skillId: "gyc-code-generation",
        name: "生成数据模型",
        description: `生成 ${entityName} 实体模型`,
        inputSchema: z.object({ entityName: z.string(), fields: z.record(z.string()) }),
        outputSchema: z.object({ modelCode: z.string(), filePath: z.string() }),
        timeoutMs: 30000,
        retryCount: 2,
        dependencies: [],
        parallel: false,
      },
      {
        id: "generate-repository",
        skillId: "gyc-code-generation",
        name: "生成 Repository",
        description: `生成 ${entityName} 数据访问层`,
        inputSchema: z.object({ entityName: z.string(), model: z.any() }),
        outputSchema: z.object({ repositoryCode: z.string(), filePath: z.string() }),
        timeoutMs: 30000,
        retryCount: 2,
        dependencies: ["generate-model"],
        parallel: false,
      },
      {
        id: "generate-service",
        skillId: "gyc-code-generation",
        name: "生成 Service",
        description: `生成 ${entityName} 业务逻辑层`,
        inputSchema: z.object({ entityName: z.string(), repository: z.any() }),
        outputSchema: z.object({ serviceCode: z.string(), filePath: z.string() }),
        timeoutMs: 30000,
        retryCount: 2,
        dependencies: ["generate-repository"],
        parallel: false,
      },
      {
        id: "generate-controller",
        skillId: "gyc-code-generation",
        name: "生成 Controller",
        description: `生成 ${entityName} API 接口层`,
        inputSchema: z.object({ entityName: z.string(), service: z.any() }),
        outputSchema: z.object({ controllerCode: z.string(), filePath: z.string() }),
        timeoutMs: 30000,
        retryCount: 2,
        dependencies: ["generate-service"],
        parallel: false,
      },
      {
        id: "generate-tests",
        skillId: "gyc-test-generation",
        name: "生成单元测试",
        description: `为 ${entityName} 生成完整单元测试`,
        inputSchema: z.object({ entityName: z.string(), allCode: z.any() }),
        outputSchema: z.object({ testFiles: z.array(z.string()), coverage: z.number() }),
        timeoutMs: 60000,
        retryCount: 2,
        dependencies: ["generate-controller"],
        parallel: false,
      },
    ]

    return createOrchestrator({} as any).createPlan(
      `Full CRUD for ${entityName}`,
      `生成 ${entityName} 完整 CRUD 代码：Model、Repository、Service、Controller、Tests`,
      baseTasks
    )
  },

  /** 代码审查 + 重构计划 */
  codeReviewAndRefactor: (filePaths: string[]): OrchestrationPlan => {
    const tasks: SubAgentSpec[] = [
      {
        id: "review-code",
        skillId: "gyc-code-review",
        name: "代码审查",
        description: "对指定文件进行深度代码审查",
        inputSchema: z.object({ filePaths: z.array(z.string()) }),
        outputSchema: z.object({ issues: z.array(z.any()), score: z.number() }),
        timeoutMs: 60000,
        retryCount: 1,
        dependencies: [],
        parallel: false,
      },
      {
        id: "generate-fixes",
        skillId: "gyc-code-generation",
        name: "生成修复代码",
        description: "基于审查结果生成修复代码",
        inputSchema: z.object({ issues: z.array(z.any()), filePaths: z.array(z.string()) }),
        outputSchema: z.object({ fixes: z.array(z.any()) }),
        timeoutMs: 60000,
        retryCount: 2,
        dependencies: ["review-code"],
        parallel: false,
      },
      {
        id: "run-tests",
        skillId: "gyc-test-generation",
        name: "运行测试验证",
        description: "运行测试确保修复不破坏现有功能",
        inputSchema: z.object({ filePaths: z.array(z.string()) }),
        outputSchema: z.object({ passed: z.boolean(), coverage: z.number() }),
        timeoutMs: 120000,
        retryCount: 1,
        dependencies: ["generate-fixes"],
        parallel: false,
      },
    ]

    return createOrchestrator({} as any).createPlan(
      "Code Review & Refactor",
      "代码审查并自动重构",
      tasks
    )
  },
}

/** Effect Layer for Orchestrator */
export class OrchestratorService extends Context.Service<OrchestratorService, Orchestrator>()("@gyccode/Orchestrator") {}

export const OrchestratorLive = Layer.effect(
  OrchestratorService,
  Effect.gen(function* () {
    const skillRegistry = yield* SkillRegistryService
    return createOrchestrator(skillRegistry)
  })
)