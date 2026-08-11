# Pi Agent — 终端编码 Agent 安装使用指南

> 研究日期：2026-08-01
> 来源：https://github.com/earendil-works/pi | https://pi.dev
> 说明：实际安装与新版本可能与下文略有出入，以 pi.dev/docs 为准

---

## 一、是什么

**Pi Agent** 是极简风格的**终端交互式编码 Agent harness**（AI agent 工具箱），⭐82,182，MIT 协议，TypeScript 编写。

- 核心定位：**"适应你的工作流，而不是让你适应它"**
- 三个子包：
  - `@earendil-works/pi-coding-agent` — 交互式编码 Agent CLI
  - `@earendil-works/pi-agent-core` — Agent 运行时（工具调用+状态管理）
  - `@earendil-works/pi-ai` — 统一多提供商 LLM API（OpenAI/Anthropic/Google等）
- 四种子包构成单测harness；可扩展：TypeScript Extensions / Skills / Prompt Templates / Themes

## 二、安装（两种方式）

```bash
# 方式1：npm 全局安装（推荐）
npm install -g --ignore-scripts @earendil-works/pi-coding-agent

# 方式2：官方脚本
curl -fsSL https://pi.dev/install.sh | sh
```

> `--ignore-scripts` 禁用依赖生命周期脚本（Pi 正常安装不需要安装脚本）

## 三、认证（二选一）

```bash
# 方式1：环境变量 API Key
export ANTHROPIC_API_KEY=sk-ant-...
pi

# 方式2：订阅登录
pi
/login   # 然后选择提供商
```

**支持的认证：**
- 订阅：Anthropic Claude Pro/Max、OpenAI ChatGPT Plus/Pro(Codex)、GitHub Copilot
- API Key：Anthropic 等多家

**支持的提供商：** Anthropic、OpenAI、Google、以及 OpenRouter/Cloudflare/NVIDIA NIM 等（`/model` 切换模型）

## 四、怎么用（四种模式）

### 1. 交互模式（默认）
```bash
pi
```
- 默认给模型四个工具：`read`、`write`、`edit`、`bash`
- 输入即对话，直接说需求，Pi 用工具帮你完成
- 界面：顶部快捷热键 → 消息区 → 编辑器（边框色=思考档位）→ 底部状态栏（工作目录/token用量/成本/当前模型）

### 2. 打印/JSON 模式（脚本调用）
```bash
pi -p "修复这个bug"          # print 模式，一次问答
pi --mode json "任务"        # JSON 输出，适合程序化
```

### 3. RPC 模式（进程集成）
```bash
pi --mode rpc
```

### 4. SDK 模式（嵌入自己的应用）

## 五、常用命令

| 命令 | 作用 |
|------|------|
| `/login` | 登录提供商 |
| `/model` (Ctrl+L) | 切换模型 |
| `/session` | 查看会话 ID |
| `/tree` | 会话树导航（分支管理，回溯任意点） |
| `/hotkeys` | 查看快捷键 |
| `/settings` | 修改设置 |
| `/trust` | 保存项目信任决策 |
| `pi update --models` | 刷新模型列表 |
| `pi update --self` | 升级 Pi |
| `--offline` | 禁用所有网络操作 |

## 六、关键概念

### 项目信任（Project Trust）
启动时若项目含 `.pi/settings.json` 等项目本地设置，Pi 会询问是否信任。可设置 `defaultProjectTrust: ask/always/never`。

### 扩展机制
- **Extensions**：TS 插件、Skills、Prompt Templates、Themes
- **Pi Packages**：打包分享，npm 或 git 分发
- 支持社区安装缺失包

### 会话分支（Branching）
`/tree` 可视化会话决策树——回溯到任意历史点继续，相当强大。

### 安全/容器化
Pi **没有内置权限系统**（文件/进程/网络/凭据），默认以启动它的用户权限运行。需要强隔离时用 Gondolin/Docker/OpenShell 容器化。

## 六、供应商相关（对你环境的参考）

- Pi 的统一 LLM API 支持：OpenAI、Anthropic、Google、OpenRouter、Cloudflare、NVIDIA NIM 直连
- 你已配置的提供商（openrouter/nvidia/siliconflow 等）理论可通过 OpenRouter/NVIDIA 接入

## 七、适用性小结

- **适合**：想用一个轻量终端 Agent 替代/补充 Claude Code、Codex 的场景；会话分支功能强
- **注意**：无内置权限沙箱，需自己控制风险；Windows 有专门文档（docs/windows.md）
- **与 Hermes**：两者定位不同（Hermes=消息网关+全平台 Agent，Pi=专注编码终端），可互补

---

*研究：小翎 | 2026-08-01*