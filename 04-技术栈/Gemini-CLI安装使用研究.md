# Gemini CLI — 安装使用方案 & 免费 LLM 研究

> 研究日期：2026-08-03
> 结论先行：**Gemini CLI 有默认免费 LLM（无需付费），且本机已可安装。**
> 来源：https://github.com/google-gemini/gemini-cli | https://geminicli.com/docs

---

## 一、是什么

**Gemini CLI** 是 Google 官方的开源终端 AI Agent（⭐106K，Apache-2.0，TypeScript，2026-08-03 仍在更新），把 Gemini 大模型能力带进终端，功能对标 Claude Code / Codex / Pi / opencode。

**核心卖点（官方 README 明示）：**
- 🎯 **免费档**：60 次请求/分钟 + **1,000 次请求/天**（个人 Google 账号）
- 🧠 **Gemini 3 模型**：增强推理 + **1M token 上下文窗口**
- 🔧 内置工具：Google Search 联网、文件操作、shell 命令、网页抓取
- 🔌 可扩展：MCP 支持自定义集成
- 🛡️ 完全开源 Apache 2.0

## 二、⚠️ 关键：默认免费 LLM（你的核心问题）

**答案：有！Gemini CLI 默认免费可达，且有两种免费方式。**

### 免费方式1：Google 账号 OAuth 登录（无需 API key）
```
✨ 免费档：60 次/分钟 + 1,000 次/天
✨ 用个人 Google 账号直接登录，不用管理 API key
✨ 自动更新到最新 Gemini 3 模型
```
```bash
gemini
# 首次启动选择 "Sign in with Google"，浏览器认证
```

### 免费方式2：Gemini API Key
```
✨ 免费档：1,000 次/天（Gemini 3，flash 和 pro 混合配额）
✨ 可从 https://aistudio.google.com/apikey 免费申请
✨ 可选择具体模型
```
```bash
export GEMINI_API_KEY="YOUR_API_KEY"
gemini
```

**对比其他免费档：**

| 工具 | 免费额度 | 要不要 API key |
|------|---------|:---:|
| **Gemini CLI** | **1000次/天 + 60次/分钟** | 可选（OAuth免key） |
| OpenRouter 免费 | 50次/天 | 要 key |
| DeepSeek 直连 | 按余额 | 要 key |
| Kimi CLI | 需订阅/API | 要 key |

**Gemini 的免费额度是这批里最慷慨的（比 OpenRouter 的 50 次/天高了 20 倍）。**

## 三、安装（Windows）

```bash
# 推荐：npm 全局安装
npm install -g @google/gemini-cli

# npx 免安装（临时用）
npx @google/gemini-cli
```
> 本机实测已安装成功 v0.53.1（npm 11.16）

其他方式：Homebrew(mac)、MacPorts(mac)、Anaconda(受限环境)

发行渠道：`latest`（每周二稳定版）/ `preview` / `nightly`

## 四、使用方案

### 基本使用
```bash
gemini                          # 当前目录启动交互式
gemini --include-directories ../lib,../docs   # 多目录
gemini -m gemini-2.5-flash      # 指定模型
```

### 非交互（脚本/自动化）
```bash
gemini -p "解释这个代码库的架构"                    # 简单文本返回
gemini -p "..." --output-format json               # 结构化 JSON
gemini -p "跑测试" --output-format stream-json     # 实时流式
```

### 核心能力
- **代码理解/生成**：查改大代码库、从 PDF/图/草稿生成应用（多模态）
- **自动化**：查 PR、处理复杂 rebase、脚本工作流
- **联网 Grounding**：内置 Google Search 实时信息
- **会话检查点**：保存/恢复复杂会话
- **GEMINI.md**：项目级上下文文件（类似 AGENTS.md）
- **GitHub Actions**：PR 审查、issue 分类、`@gemini-cli` 按需协助

## 五、认证方式对比

| 方式 | 用途 | 免费额度 | 命令 |
|------|------|:---:|------|
| **OAuth 登录 Google** | 个人开发 | 60/min + 1000/天 | `gemini` 选 Sign in with Google |
| **Gemini API Key** | 需具体模型控制 | 1000/天 | `export GEMINI_API_KEY` |
| **Vertex AI** | 企业/生产 | 按需计费 | `export GOOGLE_GENAI_USE_VERTEXAI=true` |

## 六、扩展与工具

- **MCP 服务器**：`~/.gemini/settings.json` 配置，`gemini mcp` 管理
- **Extensions**：`gemini extensions` 管理
- **Skills**：`gemini skills` 管理
- **本地 Gemma**：`gemini gemma` 管理本地模型路由
- **沙箱**：`--sandbox` / `--yolo` / `--approval-mode`

## 7 7、本机适配结论

| 项 | 状态 |
|----|------|
| npm | ✅ 11.16 |
| 已装 | ✅ **v0.53.1（2026-08-03）** |
| GEMINI key | ❌ 尚未配置（如需 API Key 模式需从 aistudio 申请）|
| 使用建议 | 首选 **OAuth 登录**（免 key，最适合个人使用）|

## 8、总结

**Gemini CLI 有默认免费 LLM，免费额度（1000次/天）在同类工具中最高，是本机最值得免费用的终端 Agent。** 只需 Google 账号登录即可，无需 API key。

安装已在本机完成（`@google/gemini-cli` 0.53.1），首次运行 `gemini` + 登录 Google 账号即可开始使用。

---

*研究：小翎 | 2026-08-03*