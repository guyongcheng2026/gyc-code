# TokenRouter — LLM Provider 统一网关 使用指南

> 研究日期：2026-08-04
> 来源：https://github.com/lkarlslund/tokenrouter（⭐20，MIT，Go 语言）
> 关键词：**一个 OpenAI 兼容端点接所有 AI provider**，路由/安全/监控/临时key

---

## 一、是什么

**TokenRouter** 是一个本地运行的 LLM API 网关/路由器，让你用**一个 `/v1` OpenAI 兼容端点** 接所有 AI provider（OpenRouter、DeepSeek、SiliconFlow、Groq、Google 等），统一管理 key、路由、配额、使用量。

**解决痛点**：不用再在 Codex/opencode/Pi 等工具里硬编码各自的 endpoint 和 key，全部指向 TokenRouter 一个端点，由它按 `provider/model` 路由。

## 二、核心能力

- **OpenAI 兼容 API 面**：chat、completions、embeddings、model 列表、responses
- **多 provider 聚合 + 模型发现**
- **按 `provider/model` 路由**：如 `groq/llama-3.3-70b-versatile`
- **可选自动启用公共免费模型 provider**
- **访问令牌分级**：`admin` / `keymaster` / `inferrer`（管理/发key/只用）
- **令牌过期 + 配额**（请求数和 token 数）
- **持久用量分析**（延迟、TPS、按 provider/model/key/IP）
- **provider 配额检查与告警**
- **会话与请求日志查看器**
- **TLS**：Let's Encrypt / 自签名 / PEM

## 三、安装

### 方式A：Go 源码（需 Go 环境）
```bash
go install github.com/lkarlslund/tokenrouter/cmd/torod@latest
go install github.com/lkarlslund/tokenrouter/cmd/toro@latest
```

### 方式B：预编译二进制（无需 Go）
从 <https://github.com/lkarlslund/tokenrouter/releases> 下载：
- 含 `torod`（服务端）和 `toro`（CLI 工具）
- **支持 Windows / macOS / Linux**（Windows 版无需装 Go）
- Linux 还有 deb/rpm/archlinux 包

## 四、快速开始

### 1) 配置服务端
```bash
torod config
```

### 2) 启动服务
```bash
torod serve
# 若无配置，首次启动自动进入配置向导
```

### 3) 打开管理后台
```
http://127.0.0.1:7050/admin
```
> 首次运行直接打开 admin，弹出创建 admin key 的对话框

## 五、统一端点使用

任意 OpenAI 兼容客户端指向 TokenRouter：
```bash
export OPENAI_BASE_URL="http://127.0.0.1:7050/v1"
export OPENAI_API_KEY="<tokenrouter_incoming_token>"
```

直接路由到某 provider/model：
```json
{
  "model": "groq/llama-3.3-70b-versatile",
  "messages": [{"role":"user","content":"Hello"}]
}
```

**路由规则：**
- model 写作 `provider/model` → 走该 provider
- model 无前缀 → 用 `default_provider`（若配置）
- 否则 → 回退到第一个启用的 provider

## 六、临时下级 key（真实工作流利器）

用 `toro` 创建短期副 key，安全运行工具：
```bash
toro connect
toro --ttl 8h --name "Codex session" codex
toro --ttl 8h --name "Opencode session" opencode
toro --ttl 8h --name "My script run" wrap -- my-command
```

**好处：**
- 长期父 key 不暴露给日常工具会话
- 每个工具运行有独立临时 key 身份
- 后台按 key 名归因用量

## 七、Admin 后台模块

| 模块 | 功能 |
|------|------|
| Status | 实时用量、延迟、TPS、provider/model 分解 |
| Quota | provider 配额可见性 + 告警 |
| Providers | 增删改查 provider、连接测试、刷新模型 |
| Access | 管理 key、角色、过期、配额 |
| Network | 监听端口 + TLS 控制 |
| Models | 跨 provider 聚合模型目录 |
| Conversations | 查看存储的会话 |
| Log | 可检索运维日志 |

## 八、本机适配评估（谷工）

| 项 | 状态 |
|----|------|
| Go 环境 | ❌ 未装（需绕行或装 Go）|
| 预编译 Windows 二进制 | ✅ 可用（releases 页有）|
| 需要 | 下载 Windows 版 `torod` + `toro` 到本地 |
| 价值 | **非常适合**——你有 OpenRouter/DeepSeek/SiliconFlow 等5家 provider，用 TokenRouter 统一管理 key/配额/路由 |

## 九、与你的需求契合度

**强烈推荐考虑**，理由：
1. 你同时管 **5 家 provider**（OpenRouter/DeepSeek/SiliconFlow/nvidia/sensetime…）——TokenRouter 正好做统一网关
2. **`toro codex` 临时 key** 机制完美契合你已跑通的 Codex+DeepSeek 场景（8h 临时 key 跑 Codex，安全+可归因）
3. 符合你"单提供商直连"偏好——但 TokenRouter 是**本地一层**，不是中转云，把多 provider 收敛成本地一个端

**取舍**：
- 如果你倾向"Codex 直接配 DeepSeek 一家"（你现在的做法）→ 简单直接，用不上 TokenRouter
- 如果你想"一个密钥/端点统管所有 provider + 用量可视化 + 临时key安全" → 值得装

---

*研究：小翎 | 2026-08-05*