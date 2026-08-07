# gyc-code 项目架构

> 更新：2026-08-07
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
| `scripts/` | 构建与补丁（`bun-solid-plugin.ts`、`apply-opentui-patch.cjs`） |
| `build.mjs` | Bun.build 打包脚本（entrypoints: index + tui worker） |
| `dist/` | 构建产物（`index.js` + 分包 + WASM 资产） |

## 三、Provider 与 LLM 架构

| Provider | 数据源 | 状态 |
|----------|--------|------|
| opencode（显示名 GYCCODE） | `models.opencode.ai` | 默认 provider；免费模型 26 个（cost=0），当前 429 限流 |
| openrouter | OpenRouter API | 339 个模型；免费额度当日用尽（429） |
| nvidia | NVIDIA NIM API | 96 个模型；key 可用，验证通过 |

- 启用开关：`gyccode.json` → `enabled_providers: ["opencode","openrouter","nvidia"]`
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
| 会话数据 | `~/.local/share/gyccode`（会话 SQLite 等） |

## 五、构建与运行

```bash
bun run build          # 构建 dist（含 tui worker 与 WASM 资产）
bun start              # bun dist/index.js
gyc                    # TUI 启动（全局命令，junction 指向项目）
gyc run "<问题>" -m <provider>/<model>   # 非交互运行
```

- 全局 `gyc` 是 bun 安装的 shim，指向本地仓库源码目录；**改源码后必须 rebuild 才生效**
- 构建产物为 ESM 分包；WASM 通过相对路径解析（`resolveWasm` 基于 `import.meta.url`）

## 六、命令清单

`gyc`（TUI）、`gyc run`、`gyc models`、`gyc serve`、`gyc tui`、`gyc account`、`gyc providers`、`gyc compose`、`gyc memory`、`gyc github`、`gyc debug`、`gyc stats`、`gyc session`、`gyc mcp`、`gyc agent` 等

## 七、已知限制

- opencode zen 免费额度超限：`Free usage exceeded, subscribe to Go`，自动重试 10h
- openrouter 免费模型每日额度用尽（429）
- NVIDIA 正常（本次全流程验证用 `nvidia/meta/llama-3.1-8b-instruct`）
- GitHub 直连被墙，需经 `https://gh-proxy.com/` 代理；push 靠 `.githooks/post-commit` 自动执行

---

*记录：Codex | 2026-08-07*
