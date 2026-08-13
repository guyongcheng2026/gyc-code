# gyc-code 项目架构

> 更新：2026-08-13
> 项目：gyc-code（AI 编码 CLI，品牌 gyc / GYCCODE / GycCode）
> 本地仓库：`C:\Users\谷勇成\gyc-cli`
> GitHub：`guyongcheng2026/gyc-code`（经 gh-proxy.com 代理同步）
> 全局命令：`gyc`（bun shim，junction 指向本地仓库，改源码需 rebuild）

---

## 一、技术栈

| 层 | 技术 |
|----|------|
| 运行时 | Bun（`target=bun`，构建产物 `dist/index.js`） |
| 语言 | TypeScript（ESM） |
| TUI | OpenTUI（`@opentui/core`、`@opentui/solid`，SolidJS 渲染） |
| 后端架构 | Effect（`effect`、`@effect/platform-node`、`@effect/sql-sqlite-bun`） |
| LLM | AI SDK（`ai` + `@ai-sdk/*`，统一 `ai-sdk` 运行时） |
| 数据库 | SQLite（Drizzle ORM 蛇形命名） |
| 终端 PTY | `@lydell/node-pty` |
| 代码解析 | `web-tree-sitter` + `tree-sitter-bash` / `tree-sitter-powershell`（WASM） |

## 二、目录结构

| 路径 | 职责 |
|------|------|
| `src/gyccode/index.ts` | CLI 入口，注册全部命令 |
| `src/gyccode/cli/cmd/` | 各子命令（run / models / serve / tui / compose / memory / github / providers / account / debug 等） |
| `src/gyccode/session/llm/` | LLM 运行时（`request.ts` 请求构造、`ai-sdk.ts` AI SDK 适配、`native-request.ts` 原生请求） |
| `src/gyccode/session/llm.ts` | 会话级 LLM 流式调用（`allowSystemInMessages` 开关） |
| `src/gyccode/tool/` | 工具（bash/shell 含 tree-sitter 解析、webfetch 含 SSRF 防护、read） |
| `src/tui/` | TUI 界面（`app.tsx` 入口、`component/dialog-*` 对话框、`routes/session` 会话视图） |
| `src/gyccode/effect/` | Effect 服务（`instance-state.ts` 实例上下文回退） |
| `src/gyccode/memory/` | 记忆系统（`hermes-bridge.ts` 桥接本地记忆文件） |
| `src/core/` | 核心框架层（v1 config / flag / v1 config 解析） |
| `src/protocol/` | 协议层：`v1`/`v2` 自研协议客户端 + `plugin` 插件类型（原 opencode SDK/plugin 本地化，2026-08-12 起零外部依赖） |
| `scripts/` | 构建与补丁（`bun-solid-plugin.ts`、`apply-opentui-patch.cjs`、`gen-compose-bundle.mjs`） |
| `build.mjs` | Bun.build 打包脚本（entrypoints: index + tui worker） |
| `dist/` | 构建产物（`index.js` + 分包 + WASM 资产） |

## 三、Provider 与 LLM 架构

| Provider | 数据源 | 状态 |
|----------|--------|------|
| opencode（显示名 GYCCODE） | `models.opencode.ai` | 默认 provider；免费模型 26 个（cost=0），当前 429 限流 |
| openrouter | OpenRouter API | 339 个模型；免费额度当日用尽（429） |
| nvidia | NVIDIA NIM API | 96 个模型；key 可用，验证通过 |

- 启用开关：`gyccode.json` → `enabled_providers: ["opencode","openrouter","nvidia"]`
- 可用性判定：auth.json 已认证的 provider（alibaba / openai / openrouter / deepseek 等）自动可用，不受 `enabled_providers` 限制；`Auth.set/remove` 同步写 SQLite `credential` 表（catalog.available 据此判定）
- 模型目录缓存：`C:\Users\谷勇成\.cache\gyccode\models.json`（禁用拉取：`GYCCODE_DISABLE_MODELS_FETCH=1`）
- 默认模型：`opencode/deepseek-v4-flash-free`（`gyccode.json` 的 `model` 字段）
- 认证：OpenCode Zen 拒绝 system role → opencode provider 开启 `options.useInstructions: true`，system 走 `instructions` 顶层字段
- 流式调用：`streamText` 开启 `allowSystemInMessages: true`（AI SDK 默认 false）

## 四、配置与数据位置

| 项 | 路径 |
|----|------|
| 用户配置 | `C:\Users\谷勇成\.config\gyccode\gyccode.json`（model / language: zh-CN / enabled_providers / provider options） |
| 环境变量 | `C:\Users\谷勇成\.gyc\.env`（12 个变量：OPENCODE/OPENROUTER/NVIDIA key 等） |
| 模型缓存 | `C:\Users\谷勇成\.cache\gyccode\models.json` |
| 会话数据 | `~/.local/share/gyccode`（会话 SQLite：session / message / todo / credential 凭据表） |

## 五、构建与运行

```bash
bun run build          # 构建 dist（含 tui worker 与 WASM 资产）
bun start              # bun dist/index.js
gyc                    # TUI 启动（全局命令，junction 指向项目）
gyc run "<问题>" -m <provider>/<model>   # 非交互运行
```

- 全局 `gyc` 是 bun 安装的 shim，指向本地仓库源码目录；**改源码后必须 rebuild 才生效**
- 构建产物为 ESM 分包；WASM 通过相对路径解析（`resolveWasm` 基于 `import.meta.url`）

## 五·五、目录结构对齐 Claude Code（2026-08-08 → 2026-08-13 移除门面层）

对标 Claude Code v2.1.88 的 src/ 结构，2026-08-08 曾落地 9 个顶层门面文件（re-export 对齐层）；**2026-08-13 清理删除**（全项目 0 引用，纯结构锚点；bin/gyc 实际加载 dist 或 `src/gyccode/index.ts`）：
- 已删：`src/main.tsx`、`src/context.ts`、`src/history.ts`、`src/commands.ts`、`src/Tool.ts`、`src/Task.ts`、`src/QueryEngine.ts`、`src/tools.ts`、`src/setup.ts`
- 能力映射文档保留：`src/STRUCTURE.md`（Claude Code 目录 → gyc-code 实际路径，已同步改为「等价」状态）
- 技术栈差异：Claude Code 用 React/Ink，gyc 用 SolidJS/OpenTUI + Effect v4；等价实现直接承载能力，不设门面对齐层

## 六、命令清单

`gyc`（TUI）、`gyc run`、`gyc models`、`gyc serve`、`gyc tui`、`gyc account`、`gyc providers`、`gyc compose`、`gyc memory`、`gyc github`、`gyc debug`、`gyc stats`、`gyc session`、`gyc mcp`、`gyc agent` 等

## 七、已知限制

- opencode zen 免费额度超限：`Free usage exceeded, subscribe to Go`；retry-after 超 5 分钟直接放弃重试报错（不再挂死 13 小时，commit ec47d6b）
- openrouter 免费模型每日额度用尽（429）
- NVIDIA 正常（本次全流程验证用 `nvidia/meta/llama-3.1-8b-instruct`）
- GitHub 直连被墙，需经 `https://gh-proxy.com/` 代理；push 靠 `.githooks/post-commit` 自动执行

## 七·五、opencode 派生关系与本地化（2026-08-12）

- **出身**：gyc-cli 为 opencode 1.18 monorepo 派生（vendored 内核约 8.7 万行：core/tui/llm/schema/protocol/server）+ 自研 gyccode 层（约 8.9 万行）
- **许可**：保留原 MIT 版权声明（LICENSE 归 opencode 2025），自研层属 gyc-code 定制，采用双 LICENSE 思路
- **依赖本地化**（commit `c8e4dad`）：原 `@opencode-ai/sdk`/`@opencode-ai/plugin` 已 vendored 为 `@gyccode/protocol/v1|v2|plugin`，自研 `createGyccodeClient` 客户端；bun.lock 已无 opencode；源码仅 v1/v2 入口注释披露来源
- **品牌清理**（commit `43cd794`）：Referer/`$schema`/插件脚手架/注释文案 30 处 → gyccode；类名 `GyccodeClient`、header `x-gyccode-*`；仅剩 13 处功能性第三方服务 URL（models/console/api/app/install/go）属 API 调用，非品牌展示
- **纯自研边界**：L1 品牌 ✓、L2 依赖 ✓ 已完成；L3 内核重写不划算（否决）；L4 法律层不可行（MIT 铁律保留版权）
- **自主化 P0→P2**（2026-08-13，commits `9160bab`/`d808025`/`190353e`/`85ad116`）：
  - P0 第三方服务默认值切自建：账号→`localhost:8787`（services/account）、分享→`localhost:8788`（services/share）、Web UI→`localhost:8789` 占位（内嵌 UI 首选）、OIDC 去默认（未配置报错）；仅剩 `models.opencode.ai`（公共中立模型数据源，可 env 镜像）
  - P1 自研层做厚：插件市场接线（`PluginEntry` 改名 + `gyc plugin search/list` 子命令，registry `plugins.gyc-code.dev`）；debug 工作区内置化（`GYCCODE_ENABLE_DEBUG_WORKSPACE` 开关默认关）
  - P2 协议自有演进：`src/protocol/README.md` 确立自有协议基线（v2 为演进方向、x-gyccode-* 专属扩展、不跟随上游）
  - 自研层规模：src/gyccode 99,310 行/545 文件（占 src 44%）；services/ 自建后端 502 行（bun:sqlite 零依赖）
  - 剩余第三方引用：仅模型数据源 + 传递依赖 `@gitlab/opencode-gitlab-auth`（GitLab 官方认证插件，触发面极小）
- **自主化收尾四项**（2026-08-13，commits `a263c59`/`ae03556`/`88350c1`）：
  - 插件市场：自研插件 gyc-hello / gyc-workspace-stats，`marketplace/` 静态目录 + build/serve 脚本，`GYCCODE_PLUGIN_REGISTRY` 可覆盖，`gyc plugin search/list` 可用
  - 发布链路：npm files/prepack 就绪，`.github/workflows/ci.yml` + `publish.yml`（NPM_TOKEN），npm pack 327 文件/5.4MB
  - 服务补厚：账号服务用户体系（注册/登录/登出 + argon2id 口令 + 等保审计日志 + admin 权限控制）
  - 模型镜像：`scripts/sync-models.mjs` 同步中立模型清单（184 供应商/6291 模型），serve 支持 `/models`，`GYCCODE_MODELS_URL` 指向镜像后第三方 URL 清零
- **市场上线 GitHub Pages + 模型快照兜底**（2026-08-13，commits `b4714fd`/`a351ab5`）：
  - `.github/workflows/deploy-pages.yml`：push main 自动构建市场+同步模型镜像+部署 Pages（`guyongcheng2026.github.io/gyc-code/`），默认 registry 已指向 Pages（`GYCCODE_PLUGIN_REGISTRY` 可覆盖）
  - `scripts/gen-models-snapshot.mjs` → `src/core/models-dev-snapshot.ts`（796KB 入库）：32 主流供应商/1427 模型内置快照，models-dev fallback 链 disk → snapshot → fetch（无网络也可用）
- **纯自研三项落地**（2026-08-13，commits `6e87383`/`9e2b7df`/`2eb0db6`）：
  - P1 依赖裁剪：AI SDK provider 21→11（企业向 8+3），依赖 160→150，删 10 插件文件 + 30 处引用
  - P0 模型网关：`services/gateway/server.ts` 统一 OpenAI 兼容入口 + 额度/限流/审计/多供应商路由（等保三级）
  - P2 协议固化：`src/protocol/CAPABILITIES.md` 能力矩阵，session 持久化端到端验证（serve 重启 5/5 恢复）

---

*记录：Codex | 2026-08-07*
