# src/ 目录结构对标映射（参考实现 → gyc-code）

> 目的：说明 gyc-code 的 `src/` 与 参考实现 v2.1.88 源码结构的能力对应关系。
> 说明：gyc-code 基于 opencode 架构（Effect v4 + SolidJS TUI），参考实现 基于 React/Ink，
> 技术栈不同，因此不做物理搬移，采用「能力映射」对齐（顶层门面对齐层已于 2026-08-13 移除，
> 等价实现直接承载能力）。

## 一、顶层文件映射

| 参考实现 | gyc-code 等价实现 | 状态 |
|---|---|---|
| `main.tsx`（CLI 入口） | `src/gyccode/index.ts`（bin/gyc 加载） | 等价 |
| `context.ts`（系统上下文/Git） | `src/gyccode/session/system.ts` | 等价 |
| `history.ts`（历史记录） | `src/gyccode/session/message-v2.ts` + `cli/cmd/run/prompt.shared.ts` | 等价 |
| `commands.ts`（斜杠命令注册） | `src/gyccode/command/` | 等价 |
| `Tool.ts`（工具抽象基类） | `src/gyccode/tool/tool.ts` | 等价 |
| `Task.ts`（任务抽象基类） | `src/gyccode/tool/task.ts` | 等价 |
| `QueryEngine.ts`（查询引擎） | `src/gyccode/session/prompt.ts` | 等价 |
| `tools.ts`（工具注册表） | `src/gyccode/tool/registry.ts` | 等价 |
| `setup.ts`（会话初始化） | `src/gyccode/project/bootstrap.ts` | 等价 |

## 二、子目录能力映射

| 参考实现 目录 | gyc-code 等价实现 | 状态 |
|---|---|---|
| `assistant/`（AI 助手模式） | 无独立目录 | 待建 |
| `bootstrap/`（启动状态） | `src/gyccode/project/bootstrap.ts` | 等价 |
| `bridge/`（远程/IDE 桥接） | `src/gyccode/cli/tui/`（worker.ts Rpc 桥，TUI↔server）+ `src/gyccode/ide/`（IDE 集成） | 等价 |
| `buddy/`（伙伴伴随） | `src/gyccode/skill/bundled/`（部分） | 待建 |
| `cli/`（CLI 框架） | `src/gyccode/cli/` | 等价 |
| `commands/`（100+ 斜杠命令） | `src/gyccode/command/` | 等价 |
| `components/`（React/Ink UI） | `src/tui/component/`（SolidJS） | 等价（技术栈不同） |
| `constants/`（提示词/常量） | `src/gyccode/session/system.ts` + `src/core/` 各常量 | 等价 |
| `context/`（React 上下文） | `src/tui/context/` | 等价 |
| `coordinator/`（多 Agent 协调） | `src/gyccode/agent/swarm/` + `tool/swarm.ts` | 等价 |
| `entrypoints/`（SDK 入口） | `src/gyccode/index.ts` + `src/sdk/` | 等价 |
| `hooks/`（React Hooks） | `src/tui/` 内 hooks（SolidJS signals） | 等价（技术栈不同） |
| `ink/`（终端渲染引擎） | `src/ui/`（渲染层）+ `src/tui/` | 等价（技术栈不同） |
| `keybindings/`（键位绑定） | `src/tui/` 键位绑定（vim 支持） | 等价 |
| `memdir/`（Memory 目录） | `src/gyccode/memory/` | 等价 |
| `migrations/`（设置迁移） | `src/core/database/migration/` | 等价 |
| `native-ts/`（原生绑定） | `src/gyccode/` wasm/native 相关（tree-sitter 等） | 等价 |
| `plugins/`（插件系统） | `src/gyccode/plugin/` + `src/core/plugin/` | 等价 |
| `query/`（查询子系统） | `src/gyccode/session/`（token-budget.ts/overflow.ts） | 等价 |
| `remote/`（远程会话） | `src/gyccode/cli/cmd/attach.ts`（--attach 客户端）+ `src/gyccode/server/routes/instance/httpapi/`（服务端会话路由与 WebSocketTracker） | 等价 |
| `schemas/`（Zod Schema） | `src/schema/` + `src/core/v1/` | 等价 |
| `screens/`（屏幕/页面） | `src/tui/`（screen 组件） | 等价 |
| `server/`（直接连接服务器） | `src/gyccode/server/` + `src/server/` | 等价 |
| `services/api/`（Claude API 封装） | `src/gyccode/session/llm/` + `src/llm/`（多 provider 协议层） | 等价（多模型） |
| `services/analytics/`（遥测） | `src/gyccode/` analytics 相关 | 等价 |
| `services/autoDream/`（自动记忆） | `src/gyccode/memory/`（dream 整合） | 等价 |
| `services/compact/`（上下文压缩） | `src/core/session/compaction.ts` + `src/gyccode/session/compaction.ts` | 等价 |
| `services/extractMemories/` | `src/gyccode/memory/` | 等价 |
| `services/mcp/`（MCP 协议） | `src/gyccode/mcp/` | 等价 |
| `services/oauth/`（OAuth） | `src/gyccode/mcp/auth.ts` + `src/gyccode/provider/auth.ts` | 等价 |
| `services/SessionMemory/` | `src/gyccode/session/` + `src/gyccode/memory/` | 等价 |
| `skills/`（技能系统） | `src/gyccode/skill/` + `src/core/skill/` | 等价 |
| `state/`（Zustand 状态） | `src/tui/context/`（SolidJS signals） | 等价（技术栈不同） |
| `tasks/`（任务类型实现） | `src/gyccode/tool/task.ts` + `src/gyccode/agent/` | 等价 |
| `tools/`（工具实现 43 子目录） | `src/gyccode/tool/`（shell/read/write/glob/grep/webfetch/websearch/mcp/skill/task/todo） | 等价 |
| `types/`（类型定义） | `src/core/v1/` + `src/schema/` | 等价 |
| `utils/`（工具函数库） | `src/core/util/` + `src/gyccode/util/` | 等价 |
| `vim/`（Vim 模式） | `src/tui/` 键位绑定（vim 支持） | 等价 |
| `voice/`（语音模式） | `src/gyccode/audio`（audio-capture 绑定） | 等价 |

## 三、待建能力（参考实现 有、gyc 暂无独立模块）

1. `assistant/` — KAIROS 助手模式（可基于 session 主动循环扩展）
2. `buddy/` — 伙伴伴随模式（可基于 skill/brief 扩展）
3. `services/api/claude.ts` — 单 provider API 封装（gyc 为多 provider 协议层，无需单列）
4. `systemPromptSections.ts` 分片缓存 — gyc 已有 `src/gyccode/session/prompt-shard.ts`（ShardCache/ShardTier）

## 四、命名空间说明（同名目录消歧）

| 命名空间 | 含义 | 与之并存的同名 |
|---|---|---|
| `src/gyccode/auth/` | 用户/凭证管理（登录态、API key） | `src/gyccode/provider/auth.ts`（LLM provider OAuth 授权，语义不同） |
| `src/gyccode/session/` | V1 会话服务层（业务编排） | `src/core/session/`（V2 数据模型/存储层） |
| `src/gyccode/server/` | 生产路由 + `shared/` 共享服务模块 | （2026-08-31 起 `src/server/` 包已退役并入 `shared/`） |

## 五、维护约定

- 新增模块优先落到上表对应 gyc 路径，保持能力映射稳定。
- 等价实现直接承载能力，不设门面对齐层。