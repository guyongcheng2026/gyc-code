---
feature: gyc-web
status: delivered
specs:
  - docs/compose/specs/2026-08-15-gyc-web-design.md
plans:
  - docs/compose/plans/2026-08-15-gyc-web.md
branch: main
commits: ad1e721..afa30d0
---

# gyc web（P0+P1）— 最终报告

## What Was Built

将 gyc 从终端交互（`gyc --mini`）向 Web IDE 版本（`gyc web`）推进的第一阶段成果：仓库内新建一等 workspace 包 `src/webapp`（React + Vite + TypeScript），复用现有 `gyc web` 的 server 与内嵌 Web UI 托管机制，实现了浏览器端的**可对话式编码**闭环——新建/选择会话、流式消息渲染、输入发送、工具权限审批卡片。

已交付（P0+P1）：
- **P0 地基**：webapp 脚手架、根 package.json/tsconfig 接线、构建链路生成内嵌 UI 清单（`opencode-web-ui.gen.ts`）、`gyc web` 直接托管浏览器页面。
- **P1 核心对话**：`useSessions`/`useChatSession`/`useSendPrompt`/`usePermissions` hooks、`chatReducer`/`permissionReducer`、聊天 UI（会话列表 + 流式消息 + 输入框 + 审批卡片），并端到端验证了真实 LLM 对话闭环。

未交付（规划为后续独立计划）：P2 文件树/编辑器/Diff/终端、P3 `--mini` 废弃与命令打磨、P4 云就绪抽象。

## Architecture

```
浏览器 (React 19 + Vite)  ← SSE 事件流 + REST →  gyc server (Node 目标 dist)
┌──────────────────────────────────────────┐
│ app/  SessionList · ChatPanel · MessageList · PromptInput · PermissionCard
│ client/  sdk · useSessions · useChatSession · useSendPrompt · usePermissions · useEvents
│ state/   chatReducer · permissionReducer
└──────────────────────────────────────────┘
```

- **协议客户端**：前端直接复用 `@gyccode/protocol/v1` 生成的 hey-api 浏览器 SDK（`createGyccodeClient`），REST/SSE 零手写客户端；`directory` 经 `x-gyccode-directory` header 传递。
- **会话数据流**：`useChatSession(sessionID)` 用 `session.messages` hydrate 历史（`{info, parts}`），随后 `useEvents` 订阅 `GET /global/event`（SSE）做增量更新。流式文本经 `message.part.updated` 事件按 `part.messageID` 累积到对应消息。
- **发送**：`useSendPrompt` 调 `session.promptAsync`（非阻塞，204 受理），回合结束以 `session.idle` 事件判定。
- **工具审批**：`usePermissions` 订阅 `permission.updated` 维护队列，`PermissionCard` 允许/拒绝走 `postSessionIdPermissionsPermissionId`（`POST /session/{id}/permissions/{permissionID}`，body `{response: "once"|"reject"}`）。
- **托管**：构建脚本 `scripts/build-webapp.mjs` 用 Vite JS API 构建 webapp → `dist`，再生成内嵌清单 `opencode-web-ui.gen.ts`（URL 路径 → 磁盘绝对路径）；server 的 `serveUIEffect` 按清单从磁盘读取并加 CSP，未命中清单的路径回退到 `GYCCODE_UI_UPSTREAM`（vite dev 代理）。提交的清单为占位空对象（可移植），真实清单仅在构建时生成。

### Design Decisions

- **新建 `src/webapp` 而非复用第三方前端**：贴合"去 opencode 化 / 自持"方向；根 tsconfig `exclude` 掉 webapp，避免 SolidJS 的 `jsxImportSource: @opentui/solid` 污染 React 编译，webapp 用独立 tsconfig（react-jsx）。
- **webapp 单测用 vitest（jsdom）而非 bun test**：与仓库既有 solid 预载测试隔离；后端 `bun test` 用 `--path-ignore-patterns=src/webapp` 排除 webapp（bun 的 `--ignore` 语义不符预期）。
- **SSE 需主动迭代流**：hey-api 生成的 SSE 客户端返回惰性 AsyncGenerator，`onSseEvent` 只在流被迭代时触发；`useEvents` 用 `for await` 消费 `result.stream` 并解包 `data.payload`。
- **清单提交占位**：真实清单含本机绝对路径，提交会破坏可移植性；提交 `export default {}` 占位，构建时覆盖。

## Usage

```bash
# 开发模式（vite dev 在 8789，server 代理热更新）
node bin/gyc web --port 4100      # server 启动并托管 UI；开发期另起 `bun run dev -C src/webapp`

# 生产构建
bun build.mjs                      # 构建 CLI 双目标 + webapp + 内嵌清单
node bin/gyc web --port 4100       # 浏览器打开 http://127.0.0.1:4100
```

浏览器交互：左侧会话列表（+ 新建会话）→ 选中会话 → 底部输入框输入消息 → Enter 发送 → 消息流式渲染 → 工具请求时出现审批卡片（允许/拒绝）。

## Verification

- **根 tsc**：`bun tsc --noEmit` → 0 错误。
- **后端回归**：`bun test --preload ./scripts/bun-solid-preload.ts --path-ignore-patterns=src/webapp` → 463 pass / 0 fail。
- **webapp 单测**：`npx vitest run --config src/webapp/vitest.config.ts src/webapp` → 7 文件 10 用例全过（reducer、hooks、组件、审批）。
- **webapp typecheck**：`bun tsc -p src/webapp/tsconfig.json --noEmit` → 0 错误。
- **托管 E2E**：`gyc web` 启动后 `/` 返回内嵌 HTML（正确 CSP）、`/assets/*` 200、`/session` 200。
- **对话闭环 E2E**：用生成 SDK 走 webapp 同链路——创建会话 → 订阅事件 → `promptAsync`（204）→ 收到 `session.status busy`/`message.part.updated`/`session.idle` → LLM 回复 "pong"（DeepSeek）→ PASS。

## Journey Log

> 供后续设计者参考的弯路记录，非必读。

- [lesson] hey-api SSE 客户端是惰性 AsyncGenerator：必须主动 `for await` 迭代 `result.stream` 才会消费事件，仅传 `onSseEvent` 收不到任何事件。
- [lesson] 协议真实形状与初版假设不同：消息列表返回 `{info, parts}`，文本经 `message.part.updated` 事件流式到达；SSE 数据为 `{"payload":{...}}` 且 `/global/event` 无 query（directory 走 header）。以 `types.gen.d.ts` 为准。
- [pivot] `bun test --ignore` 语义不符预期（反成过滤），改用 `--path-ignore-patterns=src/webapp` 排除 webapp 的 vitest 测试。
- [pivot] 提交内嵌 UI 清单改为提交占位空对象（真实清单含机器绝对路径，不可移植），构建时再生成。
- [dead end] vite CLI 经 `require.resolve("vite/bin/vite.js")` 因 exports 字段限制失败，改用 Vite JS API 程序化构建。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-08-15-gyc-web-design.md` | 设计文档 | 已批准，含 P0–P4 全阶段设计 |
| `docs/compose/plans/2026-08-15-gyc-web.md` | 实施计划 | P0+P1 已执行完成；P2–P4 为后续独立计划 |
| `src/webapp/` | 前端实现 | React + Vite 工作区包 |
| `scripts/build-webapp.mjs` | 构建脚本 | Vite 构建 + 内嵌清单生成 |
| `src/gyccode/server/shared/ui.ts` | 托管管道 | `serveUIEffect`/`embeddedUI` 复用 |
