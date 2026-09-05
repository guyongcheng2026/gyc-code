// MCP Standard Elements — 标准元素获取与合规校验
// 集成 MemPalace MCP 服务，提供 API/模型/组件/规范的标准定义

import { Effect } from "effect"

export type StandardElementType = "api" | "model" | "component" | "rule" | "pattern" | "template" | "config"

export interface StandardElement {
  id: string
  type: StandardElementType
  name: string
  version: string
  description: string
  schema?: Record<string, unknown>
  examples?: string[]
  tags: string[]
  source: "mcp" | "local" | "remote"
  fetchedAt: number
}

export interface ComplianceCheckResult {
  compliant: boolean
  score: number // 0-100
  violations: ComplianceViolation[]
  suggestions: string[]
  correctedContent?: string
}

export interface ComplianceViolation {
  rule: string
  severity: "error" | "warning" | "info"
  message: string
  location?: { line: number; column: number }
  suggestion?: string
}

export interface StandardElementsClient {
  fetchStandards: (type: StandardElementType, filters?: Record<string, string>) => Effect.Effect<StandardElement[], Error>
  fetchById: (id: string) => Effect.Effect<StandardElement | null, Error>
  checkCompliance: (content: string, type: StandardElementType, context?: Record<string, unknown>) => Effect.Effect<ComplianceCheckResult, Error>
  enforceStandards: (content: string, type: StandardElementType, maxRetries?: number) => Effect.Effect<string, Error>
}

/** MemPalace MCP 客户端配置 */
export interface MemPalaceConfig {
  palacePath: string
  mcpServerCommand?: string[]
  timeoutMs?: number
}

/** 标准元素缓存 */
const standardsCache = new Map<string, { data: StandardElement[]; expiresAt: number }>()
const CACHE_TTL_MS = 5 * 60 * 1000 // 5分钟

function getCacheKey(type: StandardElementType, filters?: Record<string, string>): string {
  return `${type}:${JSON.stringify(filters || {})}`
}

function isCacheValid(expiresAt: number): boolean {
  return Date.now() < expiresAt
}

/** 调用 MCP 服务获取标准元素 */
async function callMcpServer(method: string, params: Record<string, unknown>): Promise<unknown> {
  // 这里应该调用实际的 MCP 服务
  // 目前返回模拟数据，实际部署时替换为真实 MCP 调用
  console.log(`[MCP] Calling ${method} with params:`, params)

  // 模拟标准元素数据
  const mockStandards: Record<StandardElementType, StandardElement[]> = {
    api: [
      {
        id: "api-response-format",
        type: "api",
        name: "统一API响应格式",
        version: "1.0.0",
        description: "所有后端API必须返回 {code, msg, data} 格式",
        schema: {
          type: "object",
          required: ["code", "msg", "data"],
          properties: {
            code: { type: "integer", description: "业务状态码，200成功，非200失败" },
            msg: { type: "string", description: "用户可读消息" },
            data: { description: "业务数据，可为任意类型或null" },
          },
        },
        examples: [
          '{"code": 200, "msg": "成功", "data": {"id": 1, "name": "test"}}',
          '{"code": 400, "msg": "参数错误", "data": null}',
        ],
        tags: ["backend", "api", "response", "standard"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
      {
        id: "api-auth-header",
        type: "api",
        name: "JWT认证头标准",
        version: "1.0.0",
        description: "使用 Authorization: Bearer <token> 头进行认证",
        schema: {
          type: "object",
          properties: {
            authorization: { type: "string", pattern: "^Bearer\\s+\\S+$" },
          },
        },
        examples: ['Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...'],
        tags: ["auth", "jwt", "security", "header"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
    model: [
      {
        id: "user-model",
        type: "model",
        name: "用户数据模型",
        version: "1.0.0",
        description: "标准用户实体定义",
        schema: {
          type: "object",
          required: ["id", "name", "email", "roles", "createdAt"],
          properties: {
            id: { type: "integer" },
            name: { type: "string", minLength: 1, maxLength: 50 },
            email: { type: "string", format: "email" },
            roles: { type: "array", items: { type: "string" } },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
        examples: [],
        tags: ["user", "entity", "model", "database"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
    component: [
      {
        id: "protable-component",
        type: "component",
        name: "ProTable 表格组件",
        version: "1.0.0",
        description: "基于 Element Plus 的高级表格组件，支持搜索、分页、操作列",
        schema: {
          type: "object",
          properties: {
            columns: { type: "array", description: "列定义" },
            data: { type: "array", description: "表格数据" },
            pagination: { type: "object", description: "分页配置" },
            search: { type: "object", description: "搜索配置" },
            actions: { type: "array", description: "操作列配置" },
          },
        },
        examples: [],
        tags: ["frontend", "vue", "element-plus", "table", "protable"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
    rule: [
      {
        id: "no-hardcoded-config",
        type: "rule",
        name: "禁止硬编码配置",
        version: "1.0.0",
        description: "所有配置常量必须从 sys_config 读取，禁止在代码中硬编码",
        schema: {
          type: "object",
          properties: {
            checkPattern: { type: "string", description: "检测硬编码的正则模式" },
          },
        },
        examples: [
          "// ❌ 禁止\nconst API_URL = 'https://api.example.com'\n\n// ✅ 正确\nconst API_URL = config.apiUrl",
        ],
        tags: ["config", "hardcoded", "backend", "frontend"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
      {
        id: "no-any-type",
        type: "rule",
        name: "禁用 any 类型",
        version: "1.0.0",
        description: "TypeScript 代码中禁止使用 any 类型，必须显式定义类型",
        schema: {},
        examples: [
          "// ❌ 禁止\nfunction process(data: any) {}\n\n// ✅ 正确\nfunction process(data: UserData) {}",
        ],
        tags: ["typescript", "type-safety", "strict"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
      {
        id: "sqlite-only-local",
        type: "rule",
        name: "本地开发仅用 SQLite",
        version: "1.0.0",
        description: "本地开发环境禁止引入 MySQL/PostgreSQL，统一使用 SQLite",
        schema: {},
        examples: [
          "// ❌ 禁止\nimport mysql from 'mysql2'\nimport pg from 'pg'\n\n// ✅ 正确\nimport Database from 'better-sqlite3'",
        ],
        tags: ["database", "sqlite", "local-dev", "dependency"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
    pattern: [
      {
        id: "repository-pattern",
        type: "pattern",
        name: "Repository 模式",
        version: "1.0.0",
        description: "数据访问层统一使用 Repository 模式，通过接口依赖倒置",
        schema: {},
        examples: [
          "interface UserRepository { findById(id: number): Promise<User | null>; save(user: User): Promise<User> }",
        ],
        tags: ["architecture", "repository", "dependency-inversion", "clean-architecture"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
    template: [
      {
        id: "crud-template",
        type: "template",
        name: "CRUD 标准模板",
        version: "1.0.0",
        description: "标准 CRUD 接口实现模板",
        schema: {},
        examples: [],
        tags: ["crud", "template", "boilerplate", "backend"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
    config: [
      {
        id: "jwt-config",
        type: "config",
        name: "JWT 配置标准",
        version: "1.0.0",
        description: "JWT 相关配置项标准定义",
        schema: {
          type: "object",
          properties: {
            secret: { type: "string", description: "签名密钥，从环境变量读取" },
            expiresIn: { type: "string", default: "24h" },
            algorithm: { type: "string", default: "HS256" },
          },
        },
        examples: [],
        tags: ["jwt", "auth", "config", "security"],
        source: "mcp",
        fetchedAt: Date.now(),
      },
    ],
  }

  if (method === "get_standards") {
    const type = params.type as StandardElementType
    return mockStandards[type] || []
  }

  if (method === "get_standard_by_id") {
    const id = params.id as string
    for (const standards of Object.values(mockStandards)) {
      const found = standards.find(s => s.id === id)
      if (found) return found
    }
    return null
  }

  return null
}

/** 创建标准元素客户端 */
export function createStandardElementsClient(config: MemPalaceConfig): StandardElementsClient {
  // 具名 client：方法内部相互调用需引用它而非 this（箭头函数没有自己的 this）
  const client: StandardElementsClient = {
    fetchStandards: (type, filters) =>
      Effect.gen(function* () {
        const cacheKey = getCacheKey(type, filters)
        const cached = standardsCache.get(cacheKey)
        if (cached && isCacheValid(cached.expiresAt)) {
          return cached.data
        }

        const result = yield* Effect.tryPromise({
          try: () => callMcpServer("get_standards", { type, filters }),
          catch: (e) => new Error(`MCP fetch standards failed: ${e}`),
        })

        const standards = result as StandardElement[]
        standardsCache.set(cacheKey, { data: standards, expiresAt: Date.now() + CACHE_TTL_MS })
        return standards
      }),

    fetchById: (id) =>
      Effect.gen(function* () {
        const result = yield* Effect.tryPromise({
          try: () => callMcpServer("get_standard_by_id", { id }),
          catch: (e) => new Error(`MCP fetch by id failed: ${e}`),
        })
        return result as StandardElement | null
      }),

    checkCompliance: (content, type, context) =>
      Effect.gen(function* () {
        const standards = yield* client.fetchStandards(type)
        const violations: ComplianceViolation[] = []
        const suggestions: string[] = []

        // 简单的合规检查逻辑
        for (const standard of standards) {
          if (standard.schema && standard.type === "rule") {
            // 这里可以集成更复杂的规则引擎
            // 例如：使用 eslint、ruff、mypy 等工具进行静态分析
          }
        }

        // 基础关键词检查
        if (type === "api") {
          if (!content.includes("code") || !content.includes("msg") || !content.includes("data")) {
            violations.push({
              rule: "api-response-format",
              severity: "error",
              message: "API 响应缺少必需字段: code, msg, data",
              suggestion: "使用标准响应格式: { code: number, msg: string, data: any }",
            })
          }
        }

        if (type === "rule") {
          if (content.includes(": any") || content.includes("any[]")) {
            violations.push({
              rule: "no-any-type",
              severity: "error",
              message: "检测到 any 类型使用",
              suggestion: "替换为具体类型定义",
            })
          }
          if (content.includes("mysql2") || content.includes("pg") || content.includes("'postgres'") || content.includes('"postgres"')) {
            violations.push({
              rule: "sqlite-only-local",
              severity: "error",
              message: "本地开发检测到 PostgreSQL/MySQL 依赖",
              suggestion: "改用 better-sqlite3",
            })
          }
        }

        const score = violations.length === 0 ? 100 : Math.max(0, 100 - violations.length * 20)

        return {
          compliant: violations.filter(v => v.severity === "error").length === 0,
          score,
          violations,
          suggestions,
        }
      }),

    enforceStandards: (content, type, maxRetries = 3) =>
      Effect.gen(function* () {
        let currentContent = content

        for (let attempt = 0; attempt < maxRetries; attempt++) {
          const check = yield* client.checkCompliance(currentContent, type)

          if (check.compliant) {
            return currentContent
          }

          // 尝试自动修复
          let corrected = currentContent
          for (const violation of check.violations) {
            if (violation.suggestion) {
              // 简单的自动修复逻辑
              if (violation.rule === "no-any-type") {
                corrected = corrected.replace(/: any\b/g, ": unknown")
                corrected = corrected.replace(/any\[\]/g, "unknown[]")
              }
              if (violation.rule === "sqlite-only-local") {
                corrected = corrected.replace(/import\s+\w+\s+from\s+['"]mysql2['"]/g, "// REMOVED: import mysql from 'mysql2'")
                corrected = corrected.replace(/import\s+\w+\s+from\s+['"]pg['"]/g, "// REMOVED: import pg from 'pg'")
              }
            }
          }

          if (corrected === currentContent) {
            // 无法自动修复，抛出错误
            throw new Error(`Standard compliance failed after ${attempt + 1} attempts: ${check.violations.map(v => v.message).join("; ")}`)
          }

          currentContent = corrected
        }

        throw new Error(`Standard compliance failed after ${maxRetries} retries`)
      }),
  }

  return client
}

/** 默认客户端实例 */
let defaultClient: StandardElementsClient | null = null

export function getStandardElementsClient(config?: MemPalaceConfig): StandardElementsClient {
  if (!defaultClient) {
    defaultClient = createStandardElementsClient(config || {
      palacePath: process.env.MEMPALACE_PALACE || "E:\\myAI\\open code\\mempalace",
    })
  }
  return defaultClient
}

/** 便捷函数：获取标准并强制合规 */
export async function enforceStandardCompliance(
  content: string,
  type: StandardElementType,
  maxRetries = 3
): Promise<string> {
  const client = getStandardElementsClient()
  return Effect.runPromise(client.enforceStandards(content, type, maxRetries))
}

/** 便捷函数：检查合规性 */
export async function checkStandardCompliance(
  content: string,
  type: StandardElementType,
  context?: Record<string, unknown>
): Promise<ComplianceCheckResult> {
  const client = getStandardElementsClient()
  return Effect.runPromise(client.checkCompliance(content, type, context))
}