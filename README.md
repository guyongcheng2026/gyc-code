# gyc-code

基于 opencode (MIT) fork 的编码智能体 CLI —— 融合 MiMo-Code 开发工作流与 Hermes 记忆系统，对标 Claude Code / Codex 的完整编码能力。

## 特性

- **完整编码智能体**: 基于 opencode 成熟架构（Session/Tool/Agent/MCP/Plugin 全系统）
- **Memory Bridge**: 双向打通 Hermes 记忆系统 (`~/.codex/memory/hermes_opencode_memory.md`)
- **Compose 编排**: MiMo-Code 完整开发工作流 (Plan→TDD→Execute→Review→Debug→Verify→Merge)
- **多提供商支持**: DeepSeek / OpenRouter / SiliconFlow / 商汤 / OpenClaw 等 6+ 提供商
- **20 项能力基准**: 通过 `bun test` 20/20 验证 (对标 mimo-code)

## 环境要求

- Bun 1.3.14+ (`bun --version`)
- Windows / macOS / Linux

## 安装

```bash
# 源码运行
bun run --conditions=browser src/opencode/index.ts --help

# 或使用启动器
node bin/opencode --help
```

## 配置 API Key

在 `~/.codex/.env` 中配置：

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
gyc compose plan        generate a compose workflow plan (MiMo-Code)
gyc memory read         read Hermes memories
gyc memory write        write to Hermes memory
```

## 测试

```bash
bun test --timeout 60000 src/opencode/benchmark/benchmark.test.ts
```

## 构建

```bash
bun build.mjs
```

## 项目结构

```
src/
  opencode/      CLI 入口、命令、session、provider、skill、agent
    memory/      Hermes 记忆桥 (hermes-bridge.ts)
    composer/    Compose 工作流编排 (index.ts)
    benchmark/   能力基准测试 (benchmark.test.ts)
  core/          @opencode-ai/core — 核心库 (config/database/effect/filesystem/...)
  server/        HTTP API 服务
  tui/           Terminal UI
  llm/           LLM 协议与提供商适配
  ui/            UI 组件与资源
```

## License

MIT — 继承自 [sst/opencode](https://github.com/sst/opencode)
