# Codex CLI + OpenRouter 免费模型 — 本机环境适配评估

> 评估日期：2026-08-02
> 结论先行：**本机环境完全具备安装 Codex CLI 的条件；配 OpenRouter 及其免费 LLM 可行，但免费额度有硬限制（日限50次，需注意）**

---

## 一、本机环境检查结果

| 项 | 状态 | 详情 |
|----|:---:|------|
| 操作系统 | ✅ | Windows 10 (MINGW64, x86_64) |
| Node.js | ✅ | **v25.9.0**（远超 Codex 要求的 Node 18+） |
| npm | ✅ | 11.16.0 |
| Python | ✅ | 3.13.2 / 3.11.9（Codex 需要 Python 3.8+，但通常不强制） |
| uv | ✅ | 0.12.1（Codex 可选依赖） |
| 磁盘 | ✅ | C盘 39G 可用（52%占用） |
| 内存 | ✅ | 4GB 总/约400MB 空闲（偏紧但够用） |
| 已有编码CLI | ✅ | opencode 1.18.11、pi 0.83.0（尚未装 codex） |

**结论：安装 Codex CLI 的条件完全满足。**

## 二、Codex CLI 安装方式

```bash
# 方式1：npm（推荐，最贴合本机）
npm install -g @openai/codex        # 当前版本 0.146.0

# 方式2：官方脚本（Windows PowerShell）
powershell -ExecutionPolicy ByPass -c "irm https://chatgpt.com/codex/install.ps1 | iex"

# 方式3：Homebrew（仅 Mac）
brew install --cask codex

# 方式4：GitHub Release 二进制
#   最新版下载对应平台的 codex-aarch64-*/-x86_64-* 包
```

## 三、OpenRouter 兼容性

**Codex 内置 OpenAI-compatible provider 实现（源码 `provider.rs` 明确标注"default OpenAI-compatible implementation"）**，OpenRouter 恰好是 OpenAI 兼容 API 网关，因此可以配置为 Codex 的 provider。

配置位置：`~/.codex/config.toml`（Windows: `%USERPROFILE%\.codex\config.toml`）
```toml
[model_providers.openrouter]
name = "OpenRouter"
base_url = "https://openrouter.ai/api/v1"
env_key = "OPENROUTER_API_KEY"

[model_providers.authed_openrouter]
name = "OpenRouter"
requires_openai_auth = false
base_url = "https://openrouter.ai/api/v1"
wire_api = "chat"
httpx.Client.tls_https_default_certs = "requests"
```

## 四、OpenRouter 免费模型（实测）

**本地 OPENROUTER_API_KEY 已存在于 `~/.env`，key 有效。**

当前免费模型（共14个，适合编码的）：

| 模型 | 上下文 | 亮点 |
|------|:---:|------|
| `openai/gpt-oss-20b:free` | 131K | OpenAI 开源模型，编码强 |
| `cohere/north-mini-code:free` | 256K | 专为代码设计 |
| `nvidia/nemotron-3-super-120b-a12b:free` | 262K | 120B 大模型 MoE |
| `google/gemma-4-31b-it:free` | 262K | Google 新模型 |
| `google/gemma-4-26b-a4b-it:free` | 262K | 高性价比 |
| `inclusionai/ling-3.0-flash:free` | 262K | Flash 快速 |

> 全部 `prompt=0.0` 完全免费，但受**免费档每日限额**约束。

## 五、⚠️ 关键限制：免费额度

实测发现（2026-08-01，本机 key）：

```
手误：free tier 日限 50 次请求，当天已用光
X-RateLimit-Reset: 2026-08-03T00:00:00+00:00  → 每天 UTC 0 点重置
```

**含义：**
1. **免费模型每天最多约 50 次请求**（X-RateLimit-Limit: 50），用 `:free` 后缀的模型共享这个额度
2. 想突破 → OpenRouter 充值 10 credits，可解锁每天 1000 次免费模型请求
3. 用付费模型（如 `deepseek-v4-flash`）则走余额，不受这个限制

## 五、适配性总结

| 维度 | 评估 |
|------|------|
| 本机环境装 Codex | ✅ 完全满足（Node 25） |
| Codex 配 OpenRouter | ✅ 官方支持 OpenAI-compatible |
| 免费 LLM 可用 | ✅ 可用但日限 50 次（编程任务消耗快） |
| 免费模型质量 | 中等——够做轻量任务，重度开发建议付费模型 |

### 建议

- **体验/轻量任务**：Codex + `gpt-oss-20b:free` 完全够，适合试水
- **日常开发**：如果每天 50 次不够，建议 OpenRouter 充 10 credits 解锁 1000 次/日，或用已有付费模型（如 deepseek-v4-flash）
- **参考**：你已有 opencode 1.18 + pi 0.83，Codex 是第三个终端 Agent，三者功能重叠较大——**建议先试 Codex 看是否真的优于 opencode/pi，不必全装**

## 附：注意事项

- Codex CLI 默认设计的认证是 ChatGPT 账号（Plus/Pro）或 OpenAI API key；配 OpenRouter 属于自定义 provider 用法，需要额外配置 `config.toml`
- OpenRouter 免费模型面向的是"长尾分发"，免费档位权益可能随时调整
- Windows 下如遇沙箱问题，参考 codex 官方 sandbox 文档

---

*评估：小翎 | 2026-08-01*
---

## 附：实测验证通过的真实配置（2026-08-03 谷工本机）

> **此项最终确认：Codex CLI 直连 DeepSeek 已完美运行**（无需 openrouter，无需 cc-switch）

**`~/.codex/config.toml` 完整可用配置（已实测）：**

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

**实测关键要点（比初版研究更准确的修正）：**
1. **base_url 用 `https://api.deepseek.com/v1`**（带 /v1）
2. **`wire_api = "responses"` 是能跑通的决定性配置**（DeepSeek 支持 OpenAI Responses API 格式，不是 chat）
3. `model_reasoning_effort = "high"`（v4-flash 推理档位 high）
4. 模型名 `deepseek-v4-flash`（官方 0731 版，调用方式不变）

**验证状态：** ✅ Codex CLI 0.146.0 + deepseek-v4-flash 完美运行（2026-08-03）
