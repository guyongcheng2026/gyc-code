# 本机 Agent 组件全景评估报告

> 评估日期：2026-08-05
> 对象：pi agent + opencode cli + hermes cli + mimo code cli + codex cli + codebuddy ide + obsidian
> 类型：本机工具链配置评估（P0→P1→P2 分层建议）

---

## 一、当前配置（7件分类）

| 类别 | 组件 | 版本 | 状态 |
|------|------|------|------|
| 终端编码 Agent | Pi | 0.83.0 | ✅ 在用 |
| 终端编码 Agent | opencode | 1.18.13 | ✅ 在用 |
| 终端编码 Agent | Codex | 0.146.0 | ✅ 已跑通 DeepSeek |
| 终端编码 Agent | mimo (MiMo Code) | 0.1.10 | 🆕 2026-08-05 新装 |
| Agent 平台/网关 | **Hermes** | 0.20.0 | ⭐ 系统中枢 |
| IDE | **CodeBuddy CN** | — | 🆕 桌面 IDE |
| 知识库 | **Obsidian** | — | ⭐ 研究归宿 |

---

## 二、横向盘点与评价

| 组件 | 定位 | 我的评价 |
|------|------|---------|
| Pi 0.83 | 终端编码 Agent, MIT | ✅ 轻量、稳定,会话分支树是亮点 |
| opencode 1.18 | 终端编码 Agent, MIT | ✅ 最流行(192K⭐),生态最大 |
| Codex 0.146 | OpenAI 官方终端 Agent | ✅ 已跑通 DeepSeek,推理强 |
| mimo 0.1.10 | 终端编码 Agent(通义) | 🆕 刚装,需观察 |
| Hermes 0.20 | Agent 平台/网关 | ⭐ 系统"中枢"(微信网关+调度+记忆) |
| CodeBuddy | 腾讯 IDE(桌面) | 🆕 可视化编辑器 |
| Obsidian | 知识管理 | ⭐ 所有研究的归宿 |

---

## 三、优势分析

### 1. 互补性强,分层清晰
```
Obsidian（沉淀层）
   ↑
Hermes（中枢层：网关+调度+记忆）
   ↑            ↑
CodeBuddy（IDE可视化）
Pi/opencode/Codex/mimo（执行层,4个终端能力）
```

### 2. 冗余 → 容错
- 4 个终端 Agent 即使一两个失效,主力(Codex+DeepSeek)仍可用
- 切换成本低

### 3. Hermes 是"粘合剂"
- 关键不在"更多 CLI",而在 Hermes 这个**统一调度中枢**:连微信、管 cron、存记忆、调度 delegate

---

## 四、不足 / 风险（重点）

### 1. ⚠️ 终端 Agent 严重冗余（最大问题）
- Pi / opencode / Codex / mimo 功能**高度重叠**——都是"终端里的编码 Agent",行为几乎一样
- 理性建议:留 2 个主力(Codex-DeepSeek 深度推理 + opencode 通用),Pi/mimo 作备用
- 装太多:选择成本 + 占用磁盘/内存

### 2. ⚠️ 内存压力（已知痛点）
- 系统仅 3.9G 内存,opencode.exe 曾占 650M
- 多个 Agent 常驻会进一步挤压 → 建议同一时间只开 1-2 个终端 Agent

### 3. ⚠️ Provider 配置分散
- Codex 用 DeepSeek、Gemini 用 OpenRouter、mimo 用通义……**每个 CLI 各配各的 key/provider**
- 这正是 TokenRouter(统一网关)能解决的——若要装,这是主要动机

### 4. ⚠️ CodeBuddy + Obsidian 偏"工具位"
- CodeBuddy 是 IDE,跟 VS Code 功能重叠
- Obsidian 很稳但**纯本地**,无自动同步/云备份 → 建议定期备份 E盘知识库

### 5. 缺一块:没有 Claude Code（不装是合理的,省钱）

---

## 五、建议（P0→P1→P2）

| 优先级 | 动作 |
|--------|------|
| **P0** | 收紧 Agent 冗余:主力=Codex-DeepSeek + opencode,把 mimo/Pi 设为可命令切换的备用,不同时开 |
| **P1** | 统一 provider:若要多个 Agent 共享多 provider,评估装 TokenRouter(收敛成 1 个端点)|
| **P1** | Obsidian 备份:E盘知识库无备份机制,建议定期增量备份 |
| **P2** | 内存治理:关注 常驻进程,必要时 关浏览器/懒加载 Agent |

---

## 六、一句话总结

> 组合"深度够、广度全、有中枢",最大短板是**终端 Agent 冗余 + Provider 分散 + 内存偏紧**。
> 现在像 工具箱,什么都有但有些重复;建议**收拢主线**(Codex-DeepSeek + opencode 主力,Hermes 中枢,Obsidian 沉淀),别继续堆新 Agent。

---

*评估：小翎 | 2026-08-05*