# 方案 E：gyc-code 内建 stdio MCP Server 实施计划

**目标**：让 Hermes Agent 通过 stdio 传输连接 gyc-code，将 gyc-code 作为 MCP Server 暴露其能力（工具、资源、提示词）。

**核心优势**：
- stdio 不走网络 = 无攻击面 + 不触发传输加密要求（等保三级合规）
- 复用 gyc-code 已有的权限/审计/快照 = 等保三项直接达标
- 自有源码内实现 = 数据主权与品牌合规（gyc-code / gyc / @gyccode）

---

## 架构总览

```
┌─────────────────┐     stdio      ┌──────────────────────────────────────┐
│  Hermes Agent   │ ──────────────▶ │  gyc-code (MCP Server Mode)          │
│  (MCP Client)   │ ◀────────────── │  - 暴露 gyc-code CLI 命令为 MCP Tools │
└─────────────────┘                 │  - 暴露技能/记忆/配置为 MCP Resources  │
                                    │  - 暴露工作流为 MCP Prompts            │
                                    └──────────────────────────────────────┘
```

**关键点**：gyc-code 以子进程方式被 Hermes 启动，通过 stdin/stdout 进行 JSON-RPC 通信。

---

## 实施阶段

### 阶段一：核心链路打通（半天，目标：Hermes 能连上、列出工具、调用工具）

#### 1.1 新增 MCP Server 入口文件
**文件**：`src/gyccode/mcp/server.ts` (新建)

```typescript
// 核心职责：
// - 使用 @modelcontextprotocol/sdk/server/stdio.js 创建 StdioServerTransport
// - 注册 gyc-code 的核心能力为 MCP Tools
// - 生命周期管理：初始化 → 监听请求 → 优雅关闭
```

**依赖**：已有 `@modelcontextprotocol/sdk` (v1.32.1)，包含 `Server`、`StdioServerTransport`、`ListToolsRequestSchema` 等。

#### 1.2 新增 CLI 命令：`gyccode mcp serve-stdio`
**文件**：`src/cli/cmd/mcp-serve-stdio.ts` (新建)

```typescript
// 命令签名：gyccode mcp serve-stdio
// 行为：启动 stdio MCP Server，不接受其他参数
// 用途：Hermes 配置中作为 command 直接调用
```

**注册位置**：`src/cli/cmd/mcp.ts` 中添加子命令。

#### 1.3 核心工具集最小集（Phase 1 交付）
| Tool Name | 描述 | 对应 gyc-code 能力 |
|-----------|------|-------------------|
| `gyccode.run` | 执行 gyc-code 任务（非交互） | `gyccode run` / `gyccode task` |
| `gyccode.read_file` | 读取文件 | `gyccode read` / 内部 Filesystem |
| `gyccode.write_file` | 写入文件 | `gyccode write` / 内部 Filesystem |
| `gyccode.search_files` | 搜索文件/内容 | `gyccode search` / 内部 ripgrep |
| `gyccode.terminal` | 执行 shell 命令 | `gyccode terminal` / 内部 Process |
| `gyccode.list_skills` | 列出已加载技能 | 技能系统 |
| `gyccode.load_skill` | 加载技能 | 技能系统 |
| `gyccode.get_config` | 获取配置 | Config Service |

**实现方式**：每个 tool 对应一个 Handler 函数，内部复用现有 Service（Config、Filesystem、Process、Skill 等）。

#### 1.4 Hermes 侧配置（用户手动添加）
```json
// Hermes 配置 (~/.config/hermes/mcp.json 或等价位置)
{
  "mcpServers": {
    "gyccode": {
      "command": "gyc",
      "args": ["mcp", "serve-stdio"],
      "env": {}
    }
  }
}
```

> 注意：`gyc` 必须在 PATH 中（`~/.bun/bin` 已加入），或使用绝对路径。

#### 1.5 验收标准（阶段一）
- [ ] `gyc mcp serve-stdio` 启动不报错，进程挂起等待 stdin
- [ ] Hermes 启动后 `mcp list` 显示 `gyccode` 状态为 `connected`
- [ ] Hermes `mcp tools gyccode` 列出上述 8 个工具
- [ ] 调用 `gyccode.run` / `gyccode.read_file` 返回正确结果
- [ ] 进程退出码 0，无内存泄漏

---

### 阶段二：完整能力暴露（1-2 天，目标：覆盖 gyc-code 核心价值场景）

#### 2.1 扩展工具集
| 分类 | Tools | 备注 |
|------|-------|------|
| **会话/任务** | `gyccode.session.create`, `gyccode.session.list`, `gyccode.session.resume`, `gyccode.task.create`, `gyccode.task.wait` | 复用 Session/Task Service |
| **技能系统** | `gyccode.skill.create`, `gyccode.skill.patch`, `gyccode.skill.view`, `gyccode.skill.list` | 复用 Skill Service |
| **记忆系统** | `gyccode.memory.add`, `gyccode.memory.search`, `gyccode.memory.patch` | 复用 Memory Service |
| **Git/版本控制** | `gyccode.git.status`, `gyccode.git.diff`, `gyccode.git.commit`, `gyccode.git.push` | 复用 Git Service |
| **代码生成** | `gyccode.generate.plan`, `gyccode.generate.code`, `gyccode.generate.test` | 复用 Compose/代码生成流程 |
| **项目感知** | `gyccode.project.scan`, `gyccode.project.tree`, `gyccode.project.symbols` | 复用 LSP/索引 |

#### 2.2 Resources（只读数据源）
| URI Scheme | 描述 |
|------------|------|
| `gyccode://config/{scope}` | 配置文件内容（global/project） |
| `gyccode://skills/{name}` | 技能元数据与内容 |
| `gyccode://memory/{target}/{key}` | 记忆条目 |
| `gyccode://session/{id}/transcript` | 会话记录 |
| `gyccode://workspace/tree` | 工作区目录树 |
| `gyccode://workspace/symbols` | 代码符号索引 |

#### 2.3 Prompts（可复用工作流）
| Prompt Name | 参数 | 用途 |
|-------------|------|------|
| `gyccode.plan_feature` | `requirements: string` | 需求 → 实施计划 |
| `gyccode.review_code` | `files: string[]`, `focus?: string` | 代码审查 |
| `gyccode.debug_failure` | `error: string`, `context: string` | 失败诊断 |
| `gyccode.write_spec` | `topic: string`, `template?: string` | 生成规格文档 |

#### 2.4 验收标准（阶段二）
- [ ] 所有 Tools/Resources/Prompts 在 Hermes `mcp list` / `mcp tools` / `mcp resources` / `mcp prompts` 中可见
- [ ] 端到端场景跑通：Hermes 调用 `gyccode.plan_feature` → 生成计划 → `gyccode.generate.code` → 写入文件 → `gyccode.git.commit`
- [ ] 并发调用无竞态、无资源泄漏
- [ ] 单工具调用 P99 延迟 < 2s（本地 stdio 无网络开销）

---

### 阶段三：生产级加固（按需，目标：企业级可靠性）

| 项目 | 方案 |
|------|------|
| **超时控制** | 每工具可配置 `timeout`（默认 30s），超时自动取消并返回错误 |
| **取消传播** | 支持 MCP `cancelled` notification，映射到 Effect `Interrupt` |
| **进程隔离** | 关键工具（terminal、git push）在子进程执行，主进程只做调度 |
| **审计日志** | 所有工具调用记录到 `~/.gyccode/logs/mcp-audit.log`（结构化 JSONL） |
| **权限模型** | 按工具分级：`read`/`write`/`execute`/`admin`，Hermes 侧可配置允许列表 |
| **健康检查** | 暴露 `gyccode.health` tool，返回进程/内存/连接状态 |
| **版本协商** | 初始化时返回 `serverInfo.version`，客户端可做兼容性判断 |

---

## 代码结构规划

```
src/gyccode/mcp/
├── index.ts              # 现有：MCP Client 实现
├── server.ts             # 【新建】MCP Server 核心实现
├── server-tools.ts       # 【新建】工具定义与 Handler 注册表
├── server-resources.ts   # 【新建】Resources 实现
├── server-prompts.ts     # 【新建】Prompts 实现
├── stdio-transport.ts    # 【新建】Stdio 传输封装（可选，直接用 SDK）
└── types.ts              # 【新建】Server 侧类型定义
```

```
src/cli/cmd/
├── mcp.ts                # 现有：mcp 子命令注册中心
├── mcp-serve-stdio.ts    # 【新建】serve-stdio 子命令
```

---

## 关键技术决策

### 1. 复用现有 Service vs 重新实现
**决策**：**完全复用**。gyc-code 已有完善的 Service 层（Config、Filesystem、Process、Skill、Memory、Git、Session、Task、LSP 等），MCP Server Handler 直接 `yield* Service.use(...)` 调用，避免重复实现。

### 2. 进程模型
**决策**：**单进程 stdio**。Hermes 启动 `gyc mcp serve-stdio` 作为子进程，通过 stdin/stdout 通信。不引入额外进程池、worker、socket 等复杂度。

### 3. 错误处理映射
| gyc-code 错误 | MCP Error Code | 说明 |
|---------------|----------------|------|
| `NotFoundError` | `-32602` (Invalid params) | 资源不存在 |
| `PermissionDenied` | `-32600` (Invalid request) | 权限不足 |
| `Effect.Interrupt` | `-32603` (Internal error) | 被取消 |
| 其他 `Error` | `-32603` (Internal error) | 内部错误，message 透传 |

### 4. 配置发现
**决策**：Server 启动时读取 **全局配置**（`Global.Path.config`），不依赖项目上下文。这样 Hermes 可在任意目录下启动 gyc-code。

### 5. 品牌合规（铁律）
- 包名、导出名、CLI 界面、日志、文档 **仅使用** `gyc-code` / `gyc` / `@gyccode`
- 禁止出现 `claude`、`codex`、`opencode`、`mimo`、`hermes` 等他品牌
- MCP 协议层面的 `serverInfo.name` 设为 `"gyccode"`，`version` 读取 `InstallationVersion`

---

## 依赖与构建

### 新增依赖（无）
`@modelcontextprotocol/sdk` 已包含 Server 所需全部 API：
- `Server`、`StdioServerTransport`
- `ListToolsRequestSchema`、`CallToolRequestSchema`
- `ListResourcesRequestSchema`、`ReadResourceRequestSchema`
- `ListPromptsRequestSchema`、`GetPromptRequestSchema`
- `InitializeRequestSchema`、`InitializedNotificationSchema`

### 构建产物
- `dist/index.js` 包含 server 代码（`bun build.mjs` 已打包所有 src）
- 启动器 `bin/gyc` 优先加载 `dist/index.js`（Node 目标），冷启动 ~50ms

---

## 测试策略

### 单元测试（`bun test`）
- 每个 Tool Handler 独立测试：输入 → 输出、错误分支
- Resources/Prompts 解析测试
- Schema 验证测试（Zod/Effect Schema）

### 集成测试（手工 + 脚本）
```bash
# 1. 启动 server（后台）
gyc mcp serve-stdio &
SERVER_PID=$!

# 2. 发送 initialize 请求（通过脚本模拟 MCP Client）
echo '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test","version":"1.0.0"}}}' | nc -U /dev/stdin  # 伪代码

# 3. 验证 tools/list、tools/call、resources/list、prompts/list

# 4. 清理
kill $SERVER_PID
```

### Hermes 实测
- 在 Hermes 中添加上述配置
- 执行完整工作流：需求 → 计划 → 代码 → 测试 → 提交

---

## 风险与对策

| 风险 | 概率 | 影响 | 对策 |
|------|------|------|------|
| stdio 通信死锁 | 低 | 高 | SDK 成熟；所有 I/O 走 Effect `Stream`，有超时保护 |
| 大文件传输阻塞 | 中 | 中 | 分块传输；`readResource` 支持 `offset`/`limit` |
| 并发调用冲突 | 中 | 中 | 关键区用 `Mutex`（`Effect.Mutex`）保护；文件操作原子写 |
| 配置不生效 | 低 | 高 | 启动时打印 resolved config 路径；`gyccode config path` 验证 |
| Windows 路径/编码 | 中 | 低 | 统一用 `path` 模块、UTF-8；已在 `bin/gyc` 处理代码页 |

---

## 里程碑与交付物

| 里程碑 | 时间箱 | 交付物 | 验收人 |
|--------|--------|--------|--------|
| **M1：链路打通** | Day 1 上午 | `gyc mcp serve-stdio` 可运行，Hermes 连通，基础 8 工具可调 | 谷总 |
| **M2：核心能力全覆盖** | Day 1 下午 - Day 2 | 30+ Tools、10+ Resources、5+ Prompts，端到端场景跑通 | 谷总 |
| **M3：生产加固** | Day 3-5（按需） | 审计、权限、健康检查、并发压测报告 | 谷总 |

---

## 立即可执行的第一步（复制粘贴即可跑）

```bash
cd C:/gyc-code

# 1. 创建 server 核心文件骨架
cat > src/gyccode/mcp/server.ts << 'EOF'
import { Server } from "@modelcontextprotocol/sdk/server/index.js"
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js"
import {
  ListToolsRequestSchema,
  CallToolRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
  InitializeRequestSchema,
} from "@modelcontextprotocol/sdk/types.js"
import { Effect, Layer, Context } from "effect"
import { InstallationVersion } from "@gyccode/core/installation/version"

export interface McpServerContext {
  server: Server
  transport: StdioServerTransport
}

export const McpServerContext = Context.GenericTag<McpServerContext>("@gyccode/McpServerContext")

export const McpServerLive = Layer.effect(
  McpServerContext,
  Effect.gen(function* () {
    const server = new Server(
      { name: "gyccode", version: InstallationVersion },
      { capabilities: { tools: {}, resources: {}, prompts: {} } }
    )

    const transport = new StdioServerTransport()

    // TODO: 注册 handlers
    // server.setRequestHandler(ListToolsRequestSchema, ...)
    // server.setRequestHandler(CallToolRequestSchema, ...)
    // ...

    yield* Effect.acquireRelease(
      Effect.promise(() => server.connect(transport)),
      () => Effect.promise(() => server.close()).pipe(Effect.orDie)
    )

    return { server, transport }
  })
)
EOF

# 2. 创建 CLI 命令骨架
cat > src/cli/cmd/mcp-serve-stdio.ts << 'EOF'
import { Effect } from "effect"
import { effectCmd } from "../effect-cmd"
import { McpServerLive } from "@/mcp/server"
import { McpServerContext } from "@/mcp/server"

export const McpServeStdioCommand = effectCmd({
  command: "serve-stdio",
  describe: "启动 stdio MCP Server（供 Hermes 等客户端连接）",
  instance: false, // 不需要项目上下文
  handler: Effect.fn("Cli.mcp.serveStdio")(function* () {
    yield* McpServerLive
    // 保持进程存活，直到 stdin 关闭
    yield* Effect.never
  }),
})
EOF

# 3. 在 mcp.ts 中注册新命令
# 手工编辑 src/cli/cmd/mcp.ts：
#   import { McpServeStdioCommand } from "./mcp-serve-stdio"
#   在 builder 中 .command(McpServeStdioCommand)

# 4. 构建并测试
bun run build
gyc mcp serve-stdio
# 应该挂起等待 stdin，Ctrl+C 退出
```

---

## 后续扩展（不在本计划范围，但可平行推进）

1. **ACP (Agent Client Protocol) Server** —— 让其他 ACP 兼容客户端也能接入
2. **HTTP/SSE 传输** —— 供远程连接（需 TLS + 认证，单独评估合规性）
3. **多实例隔离** —— 同一用户并行多个 gyc-code MCP Server（不同工作目录）
4. **工具市场** —— 动态发现/安装社区 MCP Tools（复用现有 `mcp catalog` 机制）

---

## 附录：MCP 协议关键点速查

| 方法 | 方向 | 用途 |
|------|------|------|
| `initialize` | Client→Server | 协商版本、能力 |
| `initialized` | Client→Server | 通知初始化完成 |
| `tools/list` | Client→Server | 获取工具列表 |
| `tools/call` | Client→Server | 调用工具 |
| `resources/list` | Client→Server | 获取资源列表 |
| `resources/read` | Client→Server | 读取资源 |
| `prompts/list` | Client→Server | 获取提示词列表 |
| `prompts/get` | Client→Server | 获取提示词 |
| `notifications/cancelled` | 双向 | 取消进行中请求 |
| `logging/message` | Server→Client | 结构化日志 |

---

**文档版本**：v1.0  
**创建时间**：2026-10-21  
**负责人**：Hermes Agent（按谷总指令生成）  
**审核**：待谷总确认后开始执行