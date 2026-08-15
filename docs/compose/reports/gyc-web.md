---
feature: gyc-web
status: delivered
specs:
  - docs/compose/specs/2026-08-15-gyc-web-design.md
  - docs/compose/specs/2026-08-15-gyc-web-p4-cloud-ready.md
plans:
  - docs/compose/plans/2026-08-15-gyc-web.md
branch: main
commits: ad1e721..5fc44e5
---

# gyc web — 最终报告

## What Was Built

将 gyc 从终端交互（`gyc --mini`）向 Web IDE 版本（`gyc web`）的完整改造：仓库内一等 workspace 包 `src/webapp`（React 19 + Vite + TS），复用现有 server 与内嵌 Web UI 托管机制，实现浏览器内的**完整编码智能体 Web IDE**（对齐 Claude Code web / Codex web）：聊天面板（流式 + 工具审批）、文件树（git 状态）、monaco 文件查看器、会话 Diff 视图、xterm 集成终端。`gyc web` 一键启动并在浏览器打开；`gyc --mini` 已废弃（迁移提示 + 兼容）。

已交付（P0–P4 + 视觉与功能增强）：
- **P0 地基**：webapp 脚手架、workspace 接线、内嵌 UI 清单生成与托管、生成 SDK 接入。
- **P1 核心对话**：会话管理、SSE 流式消息、输入发送、工具审批卡片；真实 LLM 对话闭环验证。
- **P2 IDE 四件套**：文件树、monaco 查看器、会话 Diff、xterm 终端 + 集成布局。
- **P3 命令与打磨**：`gyc --mini` 废弃提示、README、消息虚拟化（react-virtuoso）、monaco 懒加载（主包 2.8MB→590KB）。
- **P4 云就绪**：agent runtime 云就绪抽象边界文档化（v2 远程沙箱扩展点，不实现沙箱）。
- **视觉**：Claude Code 明暗主题（默认**亮色**，取自 reference `theme.ts` lightTheme/darkTheme）+ Codex app 布局（左侧栏项目/线程、居中聊天列、底部圆角输入框）；`useTheme` 切换并持久化。
- **功能覆盖**（对齐 Claude Code）：斜杠命令菜单（`session.command` + `command.list`，覆盖 /model /compact /clear /status /permissions /memory 等）、会话操作（Fork/停止/摘要）、状态栏（cost/tokens/todo）、`#sessionId` 深链导航。
- **PTY 修复**：externalize `@lydell/node-pty`，修复打包后原生二进制解析失败（pty.create 500）→ 200 且进程运行。

## Architecture

```
浏览器 (React 19 + Vite)  ← SSE 事件流 + REST + WS →  gyc server (Node dist)
┌────────────────────────────────────────────────────┐
│ app/   SessionList · ChatPanel · FileTree · FileViewer(monaco)
│        DiffView(monaco) · TerminalPanel(xterm) · PermissionCard
│ client/  sdk · useSessions · useChatSession · useSendPrompt
│          usePermissions · useFileTree · useFileContent · useSessionDiff · usePty · useEvents
│ state/   chatReducer · permissionReducer · fileTreeReducer
│ monaco/  setup（懒加载 worker + loader 配置）
└────────────────────────────────────────────────────┘
```

- **协议**：前端复用 `@gyccode/protocol/v1` 生成 SDK（hey-api），REST/SSE/WS 零手写客户端；`directory` 走 `x-gyccode-directory` header。
- **聊天**：`useChatSession` 用 `session.messages` hydrate（`{info, parts}`），`useEvents` 订阅 `GET /global/event`（SSE）增量更新；流式文本经 `message.part.updated` 累积；发送走 `session.promptAsync`（非阻塞），回合以 `session.idle` 判定。
- **工具审批**：`permission.updated` 事件入队 → `PermissionCard` 允许/拒绝走 `postSessionIdPermissionsPermissionId`（`{response: "once"|"reject"}`）。
- **文件**：`file.list`（懒加载目录）+ `file.status`（git 角标）→ 树；`file.read` → monaco 只读（`<pre>` 兜底）。
- **Diff**：`session.diff` → `FileDiff[]`（before/after 全文）→ monaco DiffEditor。
- **终端**：`pty.create` → WS `/pty/{id}/connect?cursor=-1`；出站 raw UTF-8 + `0x00` 元帧（跳过）；入站 raw 文本；`pty.update` 传尺寸。
- **托管**：`scripts/build-webapp.mjs`（Vite JS API）构建 → 生成内嵌清单 `opencode-web-ui.gen.ts`；server `serveUIEffect` 按清单读盘 + CSP，dev 回退 `GYCCODE_UI_UPSTREAM`。
- **云就绪（P4）**：`WorkspaceRoutingMiddleware` 支持 `local`/`remote` 目标路由（`HttpApiProxy` 远端转发）；`InstanceContextMiddleware` 按目录加载实例；v2 沙箱 = 实现 `WorkspaceAdapter`（create 远端工作区 → `Target.remote`），前端零改动。

### Design Decisions

- **新建 `src/webapp` 而非复用第三方前端**：贴合"去 opencode 化 / 自持"；根 tsconfig `exclude` webapp，独立 tsconfig（react-jsx）避免 Solid 污染。
- **webapp 单测用 vitest（jsdom）**：与 bun test 隔离（`--path-ignore-patterns=src/webapp`；bun 的 `--ignore` 语义不符）。
- **monaco 懒加载**：从 main.tsx 移除静态导入，FileViewer/DiffView 挂载时 `import("../monaco/setup")`；主包 2.8MB→590KB（gzip 720→162KB）。
- **SSE 主动迭代流**：hey-api SSE 客户端是惰性 AsyncGenerator，必须 `for await` 消费。
- **清单提交占位**：真实清单含本机绝对路径，提交 `export default {}` 占位，构建时生成。
- **`--mini` 保留兼容**：废弃但短期仍可用（stderr 提示 + 继续启动），后续版本移除。

## Usage

```bash
gyc web                     # 启动 server 并自动打开浏览器 Web IDE
gyc web --port 4100         # 指定端口
gyc web --password xxx      # 启用鉴权
gyc tui                     # 终端全屏 TUI（保留）
gyc --mini                  # 已废弃：提示迁移到 gyc web / gyc tui，兼容启动
bun build.mjs               # 构建 CLI 双目标 + webapp + 内嵌清单
```

浏览器交互：左栏会话列表（Fork/删除）+ 文件树（git 角标）→ 主区聊天（流式 + 斜杠命令菜单 `/`、停止/Fork/摘要、状态栏 cost/tokens/todo）/改动/文件（monaco）→ 底部终端（主题联动）；工具请求弹出审批卡片。右上角切换明暗主题（默认亮色）。

## Verification

- **根 tsc**：`bun tsc --noEmit` → 0 错误。
- **后端回归**：`bun test --preload ./scripts/bun-solid-preload.ts --path-ignore-patterns=src/webapp` → 463 pass / 0 fail。
- **webapp 单测**：vitest → 8 文件 14 用例全过（reducer/hooks/组件/审批/文件树/发送）。
- **webapp typecheck**：`bun tsc -p src/webapp/tsconfig.json --noEmit` → 0 错误。
- **托管 E2E**：`gyc web` 后 `/` 内嵌 HTML（CSP）、`/assets/*` 200、`/session`/`/file`/`/file/status` 200。
- **对话闭环 E2E**：生成 SDK 走 webapp 同链路——创建会话 → SSE → `promptAsync` → busy/part.updated/idle → LLM 回复（DeepSeek）PASS。
- **PTY E2E**：`pty.create` → 200（进程 running）；`/command` → 200（命令列表）；斜杠命令菜单基于服务端命令引擎。
- **构建**：`bun build.mjs` 全绿；monaco 代码分割生效（主 590KB + 惰性 2.2MB chunk 均入清单）。

### 已知限制

- **PTY server 500 已修复**：`@lydell/node-pty` external 化后 `pty.create` 200 且进程运行；但 server 在 WS 客户端**异常断开**（ECONNRESET）时仍可能因未处理的 socket error 崩溃——此为独立的 server 鲁棒性缺口，待修复（浏览器正常关闭连接时不受影响）。

## Journey Log

> 供后续设计者参考的弯路记录，非必读。

- [lesson] hey-api SSE 客户端是惰性 AsyncGenerator：必须主动 `for await` 迭代 `result.stream` 才消费事件。
- [lesson] 协议真实形状：消息为 `{info, parts}`，文本经 `message.part.updated` 流式到达；SSE 数据 `{"payload":{...}}` 且 `/global/event` 无 query（directory 走 header）。以 `types.gen.d.ts` 为准。
- [pivot] `bun test --ignore` 语义不符，改用 `--path-ignore-patterns=src/webapp`。
- [lesson] monaco-editor 无 `main` 字段且与 Vite 冲突：精确正则别名 `monaco-editor`→ESM 入口（避免前缀递归）；`?worker` 静态导入在 vitest 无法转换，移到 `main.tsx`/动态导入。
- [dead end] vite CLI 经 `require.resolve("vite/bin/vite.js")` 因 exports 限制失败，改用 Vite JS API。
- [lesson] node-pty 是原生二进制（optional 依赖）：bun build 打包后其内部 `requireBinary` 无法解析，external 化（对齐 koffi）即可让 dist 运行时从 node_modules 解析。
- [pivot] 视觉方向经用户确认：Claude Code 配色（reference `theme.ts` 精确提取）+ Codex app 布局；默认亮色。
- [lesson] Claude Code 功能覆盖的核心是**服务端斜杠命令引擎**（`session.command` + `command.list`）：无需为每个命令自建 UI，暴露命令菜单即可复用 /model /compact /clear /status 等全部能力。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-08-15-gyc-web-design.md` | 设计文档 | P0–P4 全阶段设计 |
| `docs/compose/specs/2026-08-15-gyc-web-p4-cloud-ready.md` | P4 云就绪文档 | v2 沙箱扩展点契约 |
| `docs/compose/plans/2026-08-15-gyc-web.md` | 实施计划 | P0–P4 已执行 |
| `src/webapp/` | 前端实现 | React + Vite 工作区包 |
| `scripts/build-webapp.mjs` | 构建脚本 | Vite 构建 + 内嵌清单生成 |
| `src/gyccode/server/shared/ui.ts` | 托管管道 | `serveUIEffect`/`embeddedUI` |
| `src/gyccode/control-plane/` | 云就绪抽象 | Target/WorkspaceAdapter 等 |
