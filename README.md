# gyc-code

gyc-code：高效、安全、全栈的编码智能体 CLI。

## 特性

- **完整编码智能体**: Session / Tool / Agent / MCP / Plugin 全系统
- **记忆桥**: 跨会话记忆持久化与检索
- **Compose 编排**: Plan→TDD→Execute→Review→Debug→Verify→Merge 工作流
- **多提供商支持**: DeepSeek / OpenRouter / SiliconFlow / 商汤 等 6+ 提供商
- **20 项能力基准**: 通过 `bun test` 20/20 验证

## 环境要求

- Bun 1.3.14+ (`bun --version`)
- Windows / macOS / Linux

## 安装

```bash
# 源码运行
bun run --conditions=browser src/gyccode/index.ts --help

# 或使用启动器
node bin/gyc --help
```

## 配置 API Key

在 `~/.gyc/.env` 中配置：

```env
DEEPSEEK_API_KEY=sk-xxx
OPENROUTER_API_KEY=sk-or-xxx
SILICONFLOW_API_KEY=sk-xxx
```

gyc 启动时自动加载该文件。

## 用法

```bash
# 查看命令
gyc --help

# 直接对话
gyc run --model deepseek/deepseek-chat "你好"

# 查看模型
gyc models deepseek

# 生成 compose 计划
gyc compose plan "实现用户登录功能"
```

## 支持的命令

```
gyc completion          generate shell completion script
gyc acp                 start ACP (Agent Client Protocol) server
gyc mcp                 manage MCP servers
gyc [project]           start TUI
gyc attach <url>        attach to a running server
gyc run [message..]     run with a message
gyc debug               debugging and troubleshooting tools
gyc providers           manage AI providers and credentials
gyc agent               manage agents
gyc models [provider]   list available models
gyc serve               starts a headless server
gyc web                 start server and open web interface
gyc compose plan        generate a compose workflow plan
gyc memory read         read memories
gyc memory write        write to memory
```

## 测试

```bash
bun test --timeout 60000 src/gyccode/benchmark/benchmark.test.ts
```

## 构建

```bash
bun build.mjs
```

## 项目结构

```
src/
  gyccode/     CLI 入口、命令、session、provider、skill、agent
    memory/    记忆桥
    composer/  Compose 工作流编排
    benchmark/ 能力基准测试
  core/        @gyccode/core — 核心库 (config/database/effect/filesystem/...)
  server/      HTTP API 服务
  tui/         Terminal UI
  llm/         LLM 协议与提供商适配
  ui/          UI 组件与资源
```

## 出身与许可（开源合规声明）

gyc-code 基于 **opencode 1.18（MIT）** 派生：

- **承继内核**：`src/core`、`src/tui`、`src/llm`、`src/schema`、`src/protocol`、`src/server`、`src/codemode` 等目录来自 opencode，版权归 opencode（2025），许可见 **LICENSE**（MIT，依法保留不得删除）。
- **自研层**：`src/gyccode/` 及 gyc-code 贡献者新增代码为 gyc-code 原创，版权归 gyc-code（2026），许可见 **LICENSE-gyc**（MIT）。
- **依赖本地化**：原 `@opencode-ai/sdk` / `@opencode-ai/plugin` 已本地化为 `@gyccode/protocol/v1|v2|plugin`（零外部依赖）；`bun.lock` 无 opencode 依赖包。
- **品牌**：类名 `GyccodeClient`、请求头 `x-gyccode-*`、配置 schema `gyccode.ai`；代码中残留的 `opencode.ai` 外部 URL 为功能性第三方服务调用（模型目录/账号控制台/升级页等），非品牌展示。
- **去 opencode 化路线**：Web UI 可配置（`GYCCODE_UI_UPSTREAM`）、安装链路已自持（`scripts/install.sh`）、GitHub App 检测已本地化；自建后端三项（账号/分享/额度）已落地 `services/`（设备码 OAuth + 分享渲染页，bun:sqlite 零依赖），客户端环境变量 `GYCCODE_ACCOUNT_URL` / `GYCCODE_SHARE_URL` / `GYCCODE_UPGRADE_URL` 可指向自建服务；详见 **docs/ROADMAP-2026-08-12.md** 与 **services/README.md**。
- **生态兼容**：`.opencode` skill 目录用于兼容 opencode 4 生态的 skill 格式，属功能特性。

## License

双许可结构：

- **LICENSE** — opencode MIT（覆盖承继内核，Copyright (c) 2025 opencode）
- **LICENSE-gyc** — gyc-code MIT（覆盖自研层，Copyright (c) 2026 gyc-code contributors）

## 编码策略（Windows 中文环境）

- 所有生成/写入的文件统一 **UTF-8 无 BOM**（日志、快照、配置、工具输出落盘）。
- 修改用户既有文件时**保留原 BOM**：write/edit/apply-patch 均按源文件 BOM 状态写回。
- `read` 工具自动探测文件编码：UTF-8 BOM → UTF-8；无 BOM 时 UTF-8 严格解码失败 → 按 GB18030 解码（兼容 GBK 存量文件），探测结果记入会话缓存供后续写回还原。
- 子进程输出（shell/hook/git/ripgrep）自适应解码：UTF-8 严格失败自动回退 GB18030，Windows 下兼容 GBK 程序输出。
- 配置解析统一剥离 BOM（JSONC/JSON 入口），避免带 BOM 配置被静默跳过或解析失败。