# gyc web 设计文档（gyc mini → gyc web）

> 日期：2026-08-15
> 背景：将当前 gyc 的轻量交互版本（`gyc --mini`）改造为 Web IDE 版本（`gyc web`）。
> 参考：Claude Code web / Codex web 的架构与交互设计（Web IDE 四件套）。
> 状态：设计已获用户批准（2026-08-15），待进入 compose:plan 实施。

## 一、目标与边界

### 目标
- 以 `gyc web` 为新的主交互入口，提供浏览器内的完整编码智能体 Web IDE（聊天 + 终端 + 文件树 + 编辑器）。
- 原 `gyc --mini` 命令废弃（迁移提示 + 短暂兼容警告，后续版本移除）。
- 架构先本地后云端：v1 为本地 Web IDE（agent 在本机 server 内运行），为 v2 云端沙箱预留抽象边界。

### 非目标（本期不做）
- 云端沙箱 SaaS（账号/沙箱/存储/网关）——v2 预留，本期不实现。
- 复用/引入第三方 agent Web IDE 前端（与"去 opencode 化 / 自持"方向冲突）。
- 编辑器/终端的全部 IDE 级能力（如多文件 diff 三栏、AI 补全等）——按需收敛到 MVP 四件套。

## 二、可行性结论（已评估）

**可行性：高。** server 后端能力已覆盖约 90%，主要缺口是浏览器端 Web UI。

| 能力 | 现状 | 复用度 |
|---|---|---|
| HTTP API（19 组） | 完整：session(prompt/promptAsync/messages/abort/fork/diff/share/revert)、file(list/read/status/find)、pty(shells/create/connect)、event(SSE)、question、permission、config、provider、workspace、instance、control、tui、mcp、global 等 | 高 |
| 浏览器端 SDK | `src/protocol/v1/gen/sdk.gen.*`（hey-api/openapi-ts 生成，含 SSE/WS 客户端）已存在 | 高 |
| 终端接入 | PTY WebSocket + 票据鉴权已实现 | 高 |
| 静态托管管道 | server 已内置嵌入式 Web UI 机制（`serveUIEffect` + `embeddedUI` + `opencode-web-ui.gen.ts` 清单 + CSP + dev 代理回退） | 高，仅需 webapp 构建产物 + 生成清单 |
| 鉴权/多工作区/CORS/错误处理 | middleware 层已完备 | 高 |
| **Web UI 前端** | **占位（未构建）** | **主要工作量** |

**主要风险**：
- monaco-editor 体积大 → 按需/懒加载。
- SSE 高频事件 → React 渲染需批量/去重/虚拟化。
- 工具审批/权限交互需与 permission/question 协议严格对齐。

## 三、总体架构

```
┌──────────── 浏览器 (React + Vite + TS) ────────────┐
│ 文件树/会话 │ 编辑器(monaco)/Diff │ 聊天面板 │ 终端(xterm) │
└──────────────────────┬──────────────────────────────┘
        HTTPS/WS —— SSE 事件流 + REST + PTY WebSocket
┌──────────────────────┴──────────────────────────────┐
│                gyc server（本机/未来沙箱）            │
│  HttpApi 19 组 + Event SSE + Pty WS + Auth + 工作区  │
│  ┌──────────────────────────────────────────────┐   │
│  │ Agent Runtime 抽象边界（v1=本机 in-process）    │   │
│  │ v2=远程沙箱（预留接口，本期不实现）              │   │
│  └──────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────┘
```

### 关键决策
1. **前端复用生成的 hey-api SDK**（`src/protocol/v1/gen`）：所有 REST/SSE/WS 调用直接引用，零手写客户端。
2. **复用现有嵌入式 Web UI 机制**：server 的 `serveUIEffect` 已支持「内嵌清单（`opencode-web-ui.gen.ts`）」或「dev 代理（`GYCCODE_UI_UPSTREAM`→8789 vite 热更新）」双模式。P0 只需：构建 webapp→dist，并新增 build 步骤生成 `opencode-web-ui.gen.ts` 清单（URL 路径→文件路径映射），即可让现有托管管道直接生效；dev 模式零改动走 vite 代理。
3. **云就绪**：前端只依赖 server 暴露的协议；agent 执行收敛到抽象边界（现有 InstanceContextMiddleware + workspace-routing 支撑），为 v2 远程沙箱留缝。

## 四、前端布局与组件（对齐 CC web / Codex web）

四件套 IDE：
- **左侧栏**：文件树（含 git 状态）+ 会话列表（新建/继续/重命名/删除）。
- **主区**：monaco 编辑器（只读/可编辑）+ agent 改动的 Diff 视图。
- **聊天面板**：流式消息、工具调用卡片、审批按钮、model 选择。
- **底部**：xterm.js 终端（多 tab，PTY WebSocket）。

组件树（`src/webapp/src`）：
```
app/            # 应用外壳、路由、三栏布局
  App.tsx
  Sidebar/      # 文件树 + 会话列表
  Editor/       # monaco + diff
  Chat/         # 聊天面板 + 消息流 + 工具卡片 + 审批
  Terminal/     # xterm 终端
  Settings/     # 模型/provider/配置
state/          # 轻量状态管理（zustand 或 context+reducer）
client/         # 基于生成 SDK 的类型化 hooks（useSession/useEvents/usePty）
components/     # 通用 UI（按钮、输入、toast、dialog）
```

## 五、数据流与协议（全复用现有协议）

- **聊天**：聊天输入 → `session.promptAsync`（非阻塞）→ SSE `event` 订阅 `message.updated` / `tool.*` / `session.idle` → 流式渲染。
- **工具审批**：agent 请求工具 → `permission.requested` / question 事件 → 前端渲染审批卡片 → 用户确认走 `permission.resolve` / `question` API → 事件继续。
- **文件**：文件树 = `file.list` / `file.read`；agent 改动 = `session.diff` + 事件里的文件变化 → 渲染 Diff。
- **终端**：`pty.create` → 拿 connect token → WebSocket 连接 `pty.connect`，xterm.js 渲染，输入经 WS 回传。
- **会话管理**：`session.list/create/fork/abort/revert/share` 全部已有。
- **状态同步**：SSE 高频事件 → 批量/去重入 store；消息列表虚拟化（react-virtuoso）。
- **历史**：页面刷新后从 `session.messages` 恢复，SSE 断线指数退避重连。

## 六、命令改造

- `gyc web`（新主入口）：启动 server（默认本机）+ 自动打开浏览器 Web IDE；`--port / --hostname / --password / --no-open` 等 network 选项沿用。
- `gyc --mini`：**废弃**——输出迁移提示（引导 `gyc web` / `gyc tui`），保留短暂兼容警告，后续版本移除。
- `gyc tui` 保留（终端内全屏 TUI 用户不受影响）。
- README / 帮助文本 / 文档同步更新。

## 七、错误处理与安全

- 沿用 server 现有：鉴权（密码/用户名）、工作区路由隔离、CORS 校验、schema-error 错误分类。
- 前端：API 错误统一 toast、会话级错误恢复（session-errors 已有）、SSE/WS 断线指数退避重连。
- 安全：编辑器/终端均在浏览器沙箱内运行；沿用现有 CSP（csp()/cspForHtml）；分享沿用 share 服务。

## 八、测试与验收

### 测试
- 前端单测：vitest + testing-library（store、事件 reducer、组件渲染）。
- 端到端：playwright（启动 `gyc web` → 打开页面 → 发消息 → 校验流式/审批/diff/终端）。
- 后端：现有 bun test 全绿 + 新增静态托管 / 命令改造用例。

### 验收标准
- `gyc web` 一键启动并自动打开浏览器。
- 聊天流式、工具审批、文件树/编辑器/Diff、终端 四件套全部可用。
- `gyc --mini` 给出迁移提示，不崩溃。
- `bun test` 全绿、`bun tsc --noEmit` 0 错误。

## 九、分期实施

- **P0 地基**：src/webapp 脚手架（Vite+React+TS workspace 包，**独立 tsconfig 与根 tsconfig 隔离**避免 `jsxImportSource: @opentui/solid` 冲突）、构建 webapp→dist、新增 build 步骤生成 `opencode-web-ui.gen.ts` 清单（接入现有 `serveUIEffect` 内嵌托管）、生成 SDK 接入验证（hello 页面拉到 session list）。
- **P1 核心**：聊天面板（流式消息 + promptAsync + SSE 渲染 + 虚拟化）+ 会话管理 + 工具审批卡片 → "对话式编码"跑通。
- **P2 IDE**：文件树 / 编辑器(monaco) / Diff 视图 + 终端(xterm + PTY WS)。
- **P3 命令与打磨**：`gyc web` 主入口改造、`--mini` 废弃提示、README/文档、错误恢复与重连、性能优化。
- **P4 云就绪**：agent runtime 抽象边界文档化（本期不实现远程沙箱，仅留接口）。

## 十、相关文档

- `src/STRUCTURE.md`：gyc-code 与参考实现的目录能力映射。
- `docs/ROADMAP-2026-08-12.md`：自建服务与 Web UI 占位背景（localhost:8789）。
- `src/protocol/README.md`：协议自有演进基线（v2 方向）。
