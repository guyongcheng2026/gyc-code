# Claude Code CLI — 本机环境适配评估

> 评估日期：2026-08-03
> 结论先行：**本机硬件完全够装 Claude Code，但它是"唯一不免费"的终端 Agent——需要 Anthropic 付费订阅（Pro/Max）或 API key，本机当前无任何 Anthropic 凭据。**

---

## 一、Claude Code 是什么

**Claude Code**（Anthropic 官方）是终端里的 agentic 编码工具，⭐140K+，理解代码库、执行常规任务、解释复杂代码、处理 git 工作流。对标 Codex / Gemini CLI / Pi / opencode，但**定位是 Anthropic 旗舰商业化工具**。

- 当前版本：**2.1.220**（npm 包）
- Node 要求：**18+**
- 形态：终端 CLI + IDE 集成 + GitHub (@claude) 集成

## 二、本机环境检查

| 项 | 状态 | 说明 |
|----|:---:|------|
| 操作系统 | ✅ | Windows 10 |
| Node.js | ✅ | **v25.9.0**（远超要求的 18+）|
| npm | ✅ | 11.16.0 |
| 磁盘 | ✅ | C盘 39G 可用 |
| 内存 | ⚠️ | 4GB 总，当前约 590MB 空闲（偏紧但可用）|
| **Anthropic 凭据** | ❌ | **无任何 ANTHROPIC/CLAUDE key** |
| Claude Code | ❌ | 尚未安装 |
| winget | ⚠️ | msys 内不可用（需用官方 PS 脚本）|

## 三、采样安装方式

**⚠️ 官方重要提示：npm 安装已弃用！**

```powershell
# Windows 推荐（官方脚本）
irm https://claude.ai/install.ps1 | iex

# Windows (WinGet)
winget install Anthropic.ClaudeCode

# MacOS/Linux
curl -fsSL https://claude.ai/install.sh | bash
```

## 四、⚠️ 关键：认证 = 必须付费（最大障碍）

Claude Code 的登录认证需要**至少满足一种**：

1. **Anthropic 账号订阅**（推荐）
   - Claude **Pro**：约 **$20/月**
   - Claude **Max**：约 **$100/月**（更大量配额）
   - 浏览器登录 `claude login`

2. **Anthropic API key**（按用量计费）
   - Console 申请，按 token 付费

**与免费工具的关键区别：**

| 工具 | 是否免费 | 认证门槛 |
|------|:---:|------|
| **Gemini CLI** | 🆓 免费 | Google 账号 OAuth（免 key）|
| **Pi CLI** | 🆓 免费 | 自带 key / openrouter |
| **Qoder CLI** | 🆓 免费档 | 浏览器登录 |
| **Codex CLI** | 部分 | ChatGPT 订阅或自配 provider |
| **Claude Code** | **💰 付费** | **必须 Anthropic 订阅或 API key** |

**Claude Code 是这群工具里唯一需要付费的。**

## 五、结论与建议

### 本机是否适合？
- **技术上完全适合**：Node 25、磁盘、Windows 支持全部满足
- **但成本上不划算**：要付 $20-100/月，才能用上

### 建议
1. **如果你已有 Claude 订阅**（Pro/Max）→ 装，趁订阅用起来
2. **如果目前没有任何 Anthropic 订阅** → **不建议先花钱**，因为：
   - 你能拿到的 **Pi 已装**（免费 MIT）
   - **Gemini CLI 已装**（免费 1000/天）
   - **openode 已装**（免费）
   - 免费工具已覆盖 90% 场景，Claude Code 的增量价值不足以支撑月费

### 何时值得装
- 需要 **Claude 专属模型**（如 Claude Opus 最强推理）做复杂任务
- 已有企业 Anthropic 订阅 / 团队 license
- 想体验 Claude 的生态插件

## 附：实测验证通过的真实配置（2026-08-03 谷工本机）

**`~/.codex/config.toml` 完整可用配置（已实测运行成功）：**

```toml
model_provider = "deepseek"
model_reasoning_effort = "high"
model = "deepseek-v4-flash"

[model_providers.deepseek]
name = "deepseek"
base_url = "https://api.deepseek.com/v1"
experimental_bearer_token = "sk-你的key"
wire_api = "responses"

[projects.'c:\users\谷勇成']
trust_level = "trusted"
```

**实测关键要点（比初版配置更准确的修正）：**
1. **base_url 用 `https://api.deepseek.com/v1`**（不是裸的 `api.deepseek.com`）
2. **`wire_api = "responses"`**（DeepSeek 支持 OpenAI Responses API 格式，不是 chat！这是能跑通的关键）
3. **`model_reasoning_effort = "high"`**（v4-flash 的推理档位设为 high）
4. token 可直接嵌 provider 或用 env key
5. 模型名 `deepseek-v4-flash`（官方更新的 0731 版，调用方式不变）

**验证状态：** ✅ Codex CLI 0.146.0 + deepseek-v4-flash 完美运行（2026-08-03 实测）

## 六、给谷工的话

你现在的终端 Agent 组合（**Pi + opencode + Gemini CLI**）已经覆盖主流需求且全免费。Claude Code 的**唯一决定性优势是 Claude 模型本身**——除非你确定需要 Opus/Sonnet 的推理能力且愿意付费，否则**暂不推荐安装**。

如果真的想试，可以：**先把免费工具用熟，等有 Claude 订阅需求再说**——装起来只要一条命令，随时可加。

---

*评估：小翎 | 2026-08-03*