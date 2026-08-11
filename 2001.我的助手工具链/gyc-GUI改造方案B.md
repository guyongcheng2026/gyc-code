# gyc GUI 改造方案 B

> 状态：已评审待实施（2026-08-11 存档）
> 触发词：谷总说「调用方案B进行gyc GUI版本改造」或「方案B」时，列出实施计划并确认后执行
> 与方案 A 关系：独立改造方向（A = 终端 REPL，B = GUI），可先后实施、互不阻塞

## 目标
- 为 gyc 提供本地 GUI（参照主流桌面编程助手形态：聊天主窗口 + 会话列表 + 设置面板 + 实时流式输出 + 权限确认弹窗）
- 分两阶段：P0 Web GUI（浏览器 / PWA）→ P2 桌面壳（Tauri）

## 现状（已核实，2026-08-11）
1. `gyc web` 已存在：启动 server + 自动打开浏览器
2. Server HTTP API 完整：session / message / event(SSE) / permission / provider / model / agent / command / pty / fs 等 handlers，effect HttpApi + OpenAPI
3. 事件推送已就绪：SSE + WebSocketTracker
4. Web UI 当前依赖上游：server/shared/ui.ts 加载构建产物 opencode-web-ui.gen.ts（现无该生成物），回退代理上游站点——依赖网络且界面为上游品牌，不符合品牌铁律，需白标替换
5. 自研 UI 资产已存在：src/ui（@gyccode/ui）完整 React 组件库（components / hooks / context / theme / i18n / storybook / tailwind）
6. 浏览器 SDK 已有：@opencode-ai/sdk 支持 fetch + 事件订阅

## 技术选型对比
| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| A. Web GUI（React + Vite + @gyccode/ui） | 零新增运行时，复用 server 与组件资产 | 非原生桌面体验 | P0 选定 |
| B. Tauri 壳 | 体积小 ~10MB、内存低、托盘/自启 | 需 Rust 工具链 | P2 选定 |
| C. Electron 壳 | 生态成熟 | 体积大 ~150MB、内存高 | 不推荐 |

## 分阶段实施计划
### P0（Web GUI MVP，约 0.5–1 周）
1. 新建 web/ 前端工程：React + Vite + @gyccode/ui + @opencode-ai/sdk
2. 核心页面：聊天主界面（流式输出）、会话列表、权限确认弹窗（permission.asked → 弹窗 → reply）
3. 构建接入：build.mjs 生成白标 gyc-web-ui.gen.ts 嵌入 server，替换上游代理
4. gyc web 默认打开自研 UI；CSP 沿用现有逻辑；全界面白标 gyc

### P1（功能补齐，约 0.5 周）
1. 设置页：provider / API key / 模型选择（复用 Auth 与 credential 表）
2. 多会话切换、新建 / 续聊、项目目录切换（x-gyccode-directory 头）
3. 斜杠命令面板（SDK command.list）

### P2（桌面化，约 1–2 周）
1. Tauri 壳：src-tauri/ 承载 Web GUI，gyc gui 启动桌面应用
2. 系统集成：托盘、开机自启、单实例锁、窗口记忆
3. 打包：Windows 安装包（NSIS / Wix）

### 收尾
- 品牌合规检查 + 安全复核（loopback token、CSP、密码校验）
- 验证：bun run build.mjs + 真机 GUI 联调 + 与 TUI / REPL 并行可用

## 风险与对策
- 上游 UI 替换后功能完整性需逐项对照（流式 / 权限 / 工具状态），P0 验收清单兜底
- permission.asked → 弹窗 → reply 链路是 GUI 核心交互，P0 优先实现
- GUI 走本地 server 的 ServerAuth（token / password），CSP 已内置，不开放非回环地址
- 内存：Web GUI server 进程约 30MB 量级（低于 TUI 89MB）；Tauri 壳额外 ~30–50MB

## 工作量估算
- P0 + P1 ≈ 1–1.5 周（一人）；P2 桌面壳 ≈ 1–2 周；仅 Web GUI ≈ 1.5 周

## 实施流程（触发时执行）
1. 列出实施计划给谷总确认
2. 按阶段实施 + 每阶段验证
3. 自动同步（GitHub + 知识库）