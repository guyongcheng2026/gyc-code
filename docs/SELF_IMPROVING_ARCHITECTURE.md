# gyc-code 自我进化架构文档

## 概述

本文档描述了 gyc-code 的自我进化机制，包括技能系统、分层记忆存储、梦境合成验证、MCP标准化集成、子智能体编排、技能归档自动化等核心组件。

---

## 架构总览

```
┌─────────────────────────────────────────────────────────────────┐
│                        gyc-code 核心                             │
├─────────────────────────────────────────────────────────────────┤
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │  Skills      │  │  Memory      │  │  Orchestrator│          │
│  │  System      │  │  System      │  │  (Sub-agent) │          │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘          │
│         │                 │                 │                  │
│         ▼                 ▼                 ▼                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    MCP Integration                        │  │
│  │  Standard Elements │ Compliance Check │ Enforcement       │  │
│  └──────────────────────────────────────────────────────────┘  │
│                              │                                  │
│                              ▼                                  │
│  ┌──────────────────────────────────────────────────────────┐  │
│  │                    Archive System                         │  │
│  │  Version History │ Diff Comparison │ Restore              │  │
│  └──────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

---

## 1. 技能系统

### 1.1 目录结构

```
src/gyccode/skills/
├── agent-schema.ts          # Agent JSON Schema 定义
├── skill-loader.ts          # 技能加载器
├── skill-registry.ts        # 技能注册表 (Effect Service)
├── index.ts                 # 统一导出
├── code-review/             # 代码审查技能
│   ├── agent.json           # 技能元数据
│   ├── agent.md             # 技能主逻辑
│   ├── KNOWLEDGE/
│   │   ├── PUBLIC/          # 通用最佳实践
│   │   └── PRIVATE/         # 项目私有知识
│   ├── RULE/
│   │   ├── PUBLIC/          # 硬性规范
│   │   └── PRIVATE/         # 项目特定规则
│   ├── MODEL/               # 数据模型定义
│   ├── SUBAGENT/            # 子智能体
│   └── TEMPLATES/           # 代码模板
├── test-generation/         # 测试生成技能
├── doc-generation/          # 文档生成技能
└── ...                      # 更多技能
```

### 1.2 Agent JSON Schema

每个技能必须包含 `agent.json` 元数据文件：

```json
{
  "id": "gyc-code-review",
  "name": "代码审查智能体",
  "main": "agent.md",
  "description": "基于 clean-code、design-patterns、security 最佳实践的深度代码审查",
  "version": "1.0.0",
  "author": "gyc-code",
  "category": "development",
  "dependencies": ["clean-code", "design-patterns", "security-framework"],
  "mcp_servers": ["mempalace", "github"],
  "usage": [...],
  "status": "active",
  "tags": ["code-review", "quality", "security"],
  "homepage": "https://github.com/gyc-code/skills/tree/main/code-review",
  "repository": "https://github.com/gyc-code/skills",
  "license": "MIT"
}
```

### 1.3 技能加载与注册

```typescript
import { SkillRegistryService, loadAllSkills } from "@gyccode/skills"

// 加载所有技能
const result = await loadAllSkills()
result.skills.forEach(skill => console.log(skill.name, skill.version))

// 通过 Effect Service 使用
const registry = yield* SkillRegistryService
const activeSkills = yield* registry.getActiveSkills()
const codeReviewSkill = yield* registry.getSkill("gyc-code-review")
```

### 1.4 依赖解析

技能支持依赖声明，注册表提供拓扑排序：

```typescript
const { ordered, missing, circular } = yield* registry.resolveDependencies([
  "gyc-code-review",
  "gyc-test-generation"
])
```

---

## 2. 分层记忆存储

### 2.1 存储架构

采用 Hermes 风格的分层存储，按技能隔离：

```
~/.gyc/memory/layered/
├── gyc-code-review/
│   ├── public/public_memory.md      # 通用知识 (上限 500)
│   ├── private/private_memory.md    # 私有知识 (上限 200)
│   ├── rule/rule_memory.md          # 规范记忆 (上限 100)
│   ├── model/model_memory.md        # 模型定义 (上限 100)
│   └── template/template_memory.md  # 模板记忆 (上限 50)
├── gyc-test-generation/
│   └── ...
└── ...
```

### 2.2 核心 API

```typescript
import {
  writeLayeredMemory,
  readLayeredMemories,
  searchLayeredMemories,
  syncLayeredMemories,
  formatLayeredMemoriesForPrompt
} from "@gyccode/memory"

// 写入记忆
await writeLayeredMemory("gyc-code-review", "rule", {
  key: "no-any-type",
  value: "TypeScript 代码中禁止使用 any 类型",
  tags: ["typescript", "rule"]
})

// 读取记忆
const memories = await readLayeredMemories("gyc-code-review", "rule")

// 搜索记忆 (跨层，带权重)
const results = await searchLayeredMemories("gyc-code-review", "typescript any type", {
  layers: ["rule", "public", "private"],
  limit: 10,
  layerWeights: { rule: 2.0, public: 1.0, private: 1.2 }
})

// 格式化用于提示词注入
const promptSegment = formatLayeredMemoriesForPrompt(results)
```

### 2.3 记忆去重与上限

- **去重**: 基于内容归一化（小写、折叠空白）的精确去重
- **上限**: 每层独立上限，FIFO 淘汰最旧条目
- **同步**: `syncLayeredMemories` 可手动触发去重和上限执行

---

## 3. 梦境合成与验证闭环

### 3.1 概念

"梦境"是周期性的记忆合成过程，将碎片化记忆合成为结构化知识摘要。

### 3.2 触发条件

```typescript
const DEFAULT_DREAM_CONFIG = {
  minHoursBetween: 24,        // 最小小时间隔
  minSessionsBetween: 5,      // 最小会话间隔
  minMemories: 10,            // 最小记忆数
  maxRetries: 3,              // 最大重试次数
  minQualityScore: 70,        // 最小质量分数
  requiredSections: [         // 必需章节
    "Key Learnings",
    "Patterns & Preferences",
    "Action Items",
    "Topic Clusters"
  ]
}
```

### 3.3 验证闭环

梦境输出必须通过验证才能持久化：

1. **结构验证**: 必须包含所有必需章节
2. **内容质量**: 每章节最小长度、要点数量检查
3. **可执行性**: Action Items 至少 2 条
4. **幻觉检测**: 识别不确定语言（"maybe"、"possibly" 等）
5. **重试机制**: 验证失败自动重试，最多 3 次

```typescript
const { validatedMaybeDream } = await import("@gyccode/memory")

const nextState = yield* validatedMaybeDream({
  state: currentDreamState,
  memoryCount: memories.length,
  memories: joinedMemories,
  synthesizer: llmSynthesizer,
  writeMemory: persistSummary,
  config: dreamConfig
})
```

---

## 4. MCP 标准化元素集成

### 4.1 标准元素类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `api` | API 规范 | 统一响应格式、认证头 |
| `model` | 数据模型 | User、Order 实体定义 |
| `component` | 前端组件 | ProTable、Form 组件规范 |
| `rule` | 编码规范 | 禁用 any、SQLite-only |
| `pattern` | 架构模式 | Repository、Factory |
| `template` | 代码模板 | CRUD 标准模板 |
| `config` | 配置标准 | JWT、Database 配置 |

### 4.2 合规检查与强制

```typescript
import {
  enforceStandardCompliance,
  checkStandardCompliance,
  getStandardElementsClient
} from "@gyccode/mcp"

// 强制合规 (自动重试修复)
const compliantCode = await enforceStandardCompliance(
  generatedCode,
  "rule",  // 规范类型
  3        // 最大重试次数
)

// 检查合规性
const result = await checkStandardCompliance(code, "api")
if (!result.compliant) {
  console.log("违规:", result.violations)
  console.log("建议:", result.suggestions)
}
```

### 4.3 自动修复规则

| 规则 | 检测模式 | 自动修复 |
|------|----------|----------|
| `no-any-type` | `: any`、 `any[]` | 替换为 `unknown` |
| `sqlite-only-local` | `mysql2`、`pg` import | 注释掉并提示替换 |
| `api-response-format` | 缺少 code/msg/data | 注入标准格式 |

---

## 5. 子智能体编排

### 5.1 任务分解示例

完整 CRUD 生成分解为 5 个子任务：

```
fullCrudGeneration(entityName, fields)
├── generate-model (无依赖)
├── generate-repository (依赖 model)
├── generate-service (依赖 repository)
├── generate-controller (依赖 service)
└── generate-tests (依赖 controller)
```

### 5.2 编排 API

```typescript
import { OrchestratorService, PREDEFINED_PLANS } from "@gyccode/orchestrator"

const orchestrator = yield* OrchestratorService

// 使用预定义计划
const plan = PREDEFINED_PLANS.fullCrudGeneration("User", {
  name: "string",
  email: "string",
  age: "number"
})

// 执行计划
const result = yield* orchestrator.executePlan(plan, { projectPath: "/my/project" })

if (result.success) {
  console.log("生成文件:", result.aggregatedOutput)
} else {
  console.error("失败:", result.errors)
}
```

### 5.3 并行与串行执行

- **并行**: 同层级无依赖任务并行执行
- **串行**: 有依赖关系的任务按拓扑顺序串行执行
- **超时控制**: 每任务可配置超时和重试

---

## 6. 技能归档自动化

### 6.1 归档触发

```bash
# 版本升级归档
bun scripts/archive-skills.ts archive gyc-code-review --reason version-upgrade --version 1.1.0

# 大重构归档
bun scripts/archive-skills.ts archive --reason major-refactor

# 预览模式
bun scripts/archive-skills.ts archive --dry-run
```

### 6.2 归档结构

```
skills_archived/
├── 2026-09-02T10-30-00-code-review-v1.0.0-version-upgrade/
│   ├── agent.json
│   ├── agent.md
│   ├── KNOWLEDGE/
│   ├── RULE/
│   ├── MODEL/
│   ├── SUBAGENT/
│   ├── TEMPLATES/
│   ├── archive-meta.json    # 归档元数据
│   └── ARCHIVE_README.md    # 归档说明
└── ...
```

### 6.3 归档管理命令

```bash
# 列出所有归档
bun scripts/archive-skills.ts list

# 恢复归档
bun scripts/archive-skills.ts restore 2026-09-02T10-30-00-code-review-v1.0.0-version-upgrade

# 对比两个版本
bun scripts/archive-skills.ts compare archive1 archive2

# 清理旧归档 (保留最新 5 个)
bun scripts/archive-skills.ts cleanup 5
```

---

## 7. 集成测试

### 7.1 测试覆盖范围

| 模块 | 测试类型 | 覆盖场景 |
|------|----------|----------|
| Skills | 单元测试 | 加载、依赖解析、知识读取 |
| Memory | 单元/集成 | 写入、去重、搜索、分层 |
| Dream | 单元测试 | 触发条件、验证、重试 |
| MCP | 单元测试 | 合规检查、自动修复 |
| Orchestrator | 集成测试 | 计划执行、并行/串行、错误处理 |
| Archive | 集成测试 | 归档、恢复、对比、清理 |

### 7.2 运行测试

```bash
# 运行所有测试
bun test

# 运行特定模块测试
bun test src/gyccode/skills/
bun test src/gyccode/memory/
bun test src/gyccode/orchestrator/
bun test scripts/archive-skills.ts
```

---

## 8. 配置参考

### 8.1 环境变量

```bash
# 记忆存储根目录
GYCCODE_MEMORY_HOME=/custom/path/to/memory

# MemPalace MCP 服务
MEMPALACE_PALACE=E:\myAI\open code\mempalace

# Hermes 兼容性
HERMES_HOME=/path/to/hermes
```

### 8.2 梦境配置

```typescript
const customDreamConfig = {
  minHoursBetween: 12,        // 更频繁
  minSessionsBetween: 3,
  minMemories: 5,
  maxRetries: 5,              // 更多重试
  minQualityScore: 80,        // 更高标准
  requiredSections: [
    "Key Learnings",
    "Patterns & Preferences",
    "Action Items",
    "Topic Clusters",
    "Open Questions"          // 额外章节
  ]
}
```

### 8.3 记忆层配置

```typescript
const customLayerConfigs = {
  public: { maxEntries: 1000 },
  private: { maxEntries: 500 },
  rule: { maxEntries: 200 },
  model: { maxEntries: 200 },
  template: { maxEntries: 100 }
}
```

---

## 9. 最佳实践

### 9.1 技能开发

1. **单一职责**: 每个技能专注一个领域
2. **显式依赖**: 在 agent.json 中声明依赖
3. **知识分层**: PUBLIC 存通用最佳实践，PRIVATE 存项目特有
4. **规范先行**: RULE 目录存硬性规范，自动化检查
5. **模板驱动**: TEMPLATES 存代码模板，保证输出一致性

### 9.2 记忆管理

1. **及时写入**: 关键决策、学习即时写入对应层
2. **定期同步**: 定期运行 `syncLayeredMemories` 清理去重
3. **分层检索**: 搜索时指定层和权重，提高相关性
4. **新鲜度检查**: 使用 `formatLayeredMemoriesForPrompt` 自动标记陈旧记忆

### 9.3 梦境优化

1. **调整阈值**: 根据项目活跃度调整触发条件
2. **提示词工程**: 优化 `formatDreamPrompt` 提高输出质量
3. **验证规则**: 根据项目需求自定义验证逻辑

---

## 10. 故障排查

### 10.1 常见问题

| 问题 | 可能原因 | 解决方案 |
|------|----------|----------|
| 技能加载失败 | agent.json 格式错误 | 验证 JSON 格式，检查必填字段 |
| 记忆搜索无结果 | 分层不匹配 | 检查 layer 参数，尝试跨层搜索 |
| 梦境不触发 | 阈值未达标 | 检查 memoryCount、sessionsSinceDream |
| 合规检查误报 | 规则过严 | 调整标准元素或添加例外 |
| 子任务超时 | 复杂度过高 | 增加 timeoutMs 或拆分任务 |

### 10.2 调试技巧

```typescript
// 开启详细日志
process.env.DEBUG = "gyccode:skills,gyccode:memory,gyccode:orchestrator"

// 手动触发梦境
const result = await dreamRunner.maybeDream({
  state: await readDreamState(),
  memoryCount: 100,
  memories: "...",
  synthesizer: llmCall,
  writeMemory: persist,
  config: { ...DEFAULT_DREAM_CONFIG, minMemories: 1 }
})
```

---

## 11. 技能市场与依赖解析

### 11.1 市场注册表

```
skills/marketplace/
└── index.json    # 本地技能注册表
```

### 11.2 市场操作

```bash
# 列出所有技能
bun scripts/marketplace.ts list

# 发布技能
bun scripts/marketplace.ts publish gyc-code-review

# 搜索技能
bun scripts/marketplace.ts search code-review
bun scripts/marketplace.ts search --category testing --tags tdd

# 安装技能
bun scripts/marketplace.ts install gyc-code-review --force

# 检查更新
bun scripts/marketplace.ts check

# 解析依赖
bun scripts/marketplace.ts deps gyc-code-review
```

### 11.3 市场客户端 API

```typescript
import {
  publishSkill,
  searchSkills,
  installSkill,
  listSkills,
  checkForUpdates,
  resolveDependencies,
} from "@gyccode/skills"

// 发布
const result = await publishSkill("/path/to/skill-dir")

// 搜索
const results = await searchSkills("code-review", {
  category: "development",
  tags: ["security"],
  limit: 10,
})

// 安装
const install = await installSkill("gyc-code-review", { force: true })

// 依赖解析
const { ordered, missing, circular } = await resolveDependencies(["gyc-code-review"])
```

---

## 12. 训练数据飞轮

### 12.1 概念

从任务完成日志中提取成功模式，构建高质量训练数据集，用于优化提示词和技能行为。

### 12.2 训练集构建

```bash
# 创建示例日志
bun scripts/build-training-set.ts create-sample-log

# 构建训练集
bun scripts/build-training-set.ts build

# 自定义参数构建
bun scripts/build-training-set.ts build --min-quality 80 --categories code-generation,testing --max-samples 5000

# 查看统计
bun scripts/build-training-set.ts stats

# 查看样本
bun scripts/build-training-set.ts sample 10

# 按类别过滤
bun scripts/build-training-set.ts filter debugging
```

### 12.3 训练数据格式 (JSONL)

```json
{
  "instruction": "为 User 实体生成 CRUD 接口",
  "output": "from flask import Blueprint...",
  "category": "code-generation",
  "quality_score": 85,
  "tags": ["flask", "crud", "jwt"]
}
```

### 12.4 训练管道 API

```typescript
import {
  buildTrainingDataset,
  exportToJsonl,
  exportToJson,
  computeQualityScore,
} from "@gyccode/memory"

// 构建数据集
const dataset = await buildTrainingDataset({
  minQualityScore: 70,
  categories: ["code-generation", "testing"],
  maxSamples: 5000,
})

// 导出
await exportToJsonl(dataset, "training-set.jsonl")
await exportToJson(dataset, "training-set.json")

// 质量评估
const score = computeQualityScore(taskLogEntry)
```

---

## 13. 多模态知识支持

### 13.1 支持的媒体类型

| 类型 | 说明 | 示例 |
|------|------|------|
| `image` | 图片 | UI 截图、架构图 |
| `video` | 视频 | 操作演示 |
| `code` | 代码片段 | 示例代码 |
| `diagram` | 图表 | 流程图、ER图 |
| `screenshot` | 截图 | 界面截图 |
| `document` | 文档 | PDF、Word |

### 13.2 多模态记忆 API

```typescript
import {
  writeMultimodalMemory,
  readMultimodalMemories,
  searchMultimodalMemories,
  formatMultimodalForPrompt,
  textToEmbedding,
} from "@gyccode/memory"

// 写入带图片的记忆
await writeMultimodalMemory({
  text: "用户管理页面的 UI 设计",
  attachments: [{
    type: "image",
    source: "/path/to/screenshot.png",
    mimeType: "image/png",
    sizeBytes: 102400,
    description: "用户列表页面截图",
    extractedText: "用户管理 - 显示 10 条记录",
  }],
  tags: ["ui", "user-management"],
  skillId: "gyc-code-review",
  layer: "visual",
})

// 多模态搜索
const results = await searchMultimodalMemories("gyc-code-review", {
  query: "用户管理界面",
  visualEmbedding: textToEmbedding("用户管理界面"),
  textWeight: 0.6,
  visualWeight: 0.4,
})

// 格式化用于提示词
const prompt = formatMultimodalForPrompt(results)
```

### 13.3 向量索引

内置简易向量索引（TF-based，无外部依赖），支持：
- 文本→向量转换 (`textToEmbedding`)
- 余弦相似度计算 (`cosineSimilarity`)
- 文本+视觉联合检索

---

## 14. 版本历史

| 版本 | 日期 | 变更 |
|------|------|------|
| 1.1.0 | 2026-09-03 | 新增：技能市场、训练数据飞轮、多模态知识支持 |
| 1.0.0 | 2026-09-03 | 初始版本：技能系统、分层记忆、梦境验证、MCP集成、子智能体编排、归档自动化 |

---

## 15. 相关资源

- [Hermes Agent 架构参考](https://github.com/hermes-agent/hermes)
- [Effect 文档](https://effect.website/)
- [MCP 协议规范](https://modelcontextprotocol.io/)
- [gyc-code 核心规范](AGENTS.md)