# 技术路线：微信 ClawBot + Hermes Agent + OpenCode Zen + Obsidian

> 整理时间：2026-07-16
> 梳理来源：当日与谷工的多轮技术路线复盘对话
> 关联文档：[[ECP与ERP区别]] / [[DAP-S应用架构学习要点]]

---

## 一、完整技术路线架构

```
┌─────────────────────────────────────────────────────────────┐
│  入口层                                                       │
│  微信(iLink ClawBot)  ←→  Hermes 网关  ←→  Obsidian(vault)   │
└──────────────┬──────────────────────────┬──────────────────┘
               │ 指令/消息                  │ 双向链接/图谱
               ▼                           ▼
        Hermes Agent(本地运行) ────── 知识库(E:\谷勇成的知识库)
               │ 模型调用                 (Obsidian vault)
               ▼
        OpenCode Zen (deepseek-v4-flash-free)
        + OpenRouter 自动切换(备用)
```

**各层职责：**
| 层 | 组件 | 职责 |
|----|------|------|
| 入口 | 微信 iLink ClawBot | 手机端发指令、收结果（个人微信 Bot，官方 API） |
| 运行时 | Hermes Agent | 工具调用、记忆、技能、定时任务、网关 |
| 知识层 | Obsidian + 本地 vault | 知识沉淀、双向链接、图谱阅读 |
| 模型 | OpenCode Zen（主）+ OpenRouter（备） | 推理能力 |

---

## 二、各组件选型理由

| 组件 | 选型理由 | 局限 |
|------|---------|------|
| **微信 ClawBot (iLink)** | 官方 Bot API，个人微信直接用，移动可达 | 单点依赖白名单/会话存活 |
| **Hermes Agent** | 本地运行、技能/记忆/Cron 全有、数据自主 | v0.18.2 快速迭代偶有 bug |
| **OpenCode Zen** | 免费模型 deepseek-v4-flash-free | 单点依赖，接口变更即瘫 |
| **Obsidian** | 本地优先、双向链接、图谱、零成本 | 不原生渲染 HTML（需浏览器/插件） |

---

## 三、模型冗余链路（2026-07-16 配置）

主用 + 三级 fallback（已在 config.yaml 落地）：
```
主用：OpenCode Zen (deepseek-v4-flash-free)
  ↓ 挂了
备用1：OpenRouter (tencent/hy3:free，免费，实测 cost:0)
  ↓ 还挂
备用2：SiliconFlow (DeepSeek-V4-Flash)
  ↓ 还挂
备用3：DashScope (deepseek-v4-flash)
```

配置要点：
- OpenRouter Key 已配（sk-or-v1-...b019），账号零 credits
- `openrouter/auto` 需付费 → 暂用免费模型 `tencent/hy3:free`
- fallback 顺序：`["openrouter","siliconflow","dashscope"]`
- 若后续 OpenRouter 充值，改 `default_model: openrouter/auto` 启用自动选优

---

## 四、长任务异步化（2026-07-16 落地）

**原则：** 耗时 >1 分钟的任务改为后台跑，不阻塞微信实时对话。

**已落地：**
1. 技能 `async-long-task` — 沉淀异步执行规范（delegate_task / cronjob 两方式）
2. Cron 任务「每日知识库体检」(job_id: 805e906cc696)
   - 每天 09:00 自动扫描断链 + 依赖完整性
   - 完成微信通知（deliver=origin）
   - 模型已 pin（hy3-free + opencode），防配置漂移
   - 验证：手动 run 一次，status=ok

**两种方式：**
- `delegate_task`：当前会话触发、后台跑、返回摘要（子代理无记忆，context 写全）
- `cronjob`：周期任务、自包含 prompt、完成发微信（必须 pin 模型防 skip）

---

## 五、已评估但未采用的方案

| 方案 | 结论 |
|------|------|
| 微信公众号双通道 | ❌ 个人无法注册（需企业资质+公网服务器），保持 ClawBot 现状 |
| Telegram 双入口 | ⏸ 未做，未来可选（与 iLink 互补） |
| OpenRouter 自动切换(付费) | ⏸ 待充值后启用 `openrouter/auto` |

---

## 六、待办 / 演进方向

- [ ] OpenRouter 充值后切 `openrouter/auto`（真正自动选优模型）
- [ ] Obsidian 自动索引脚本（固化今天手动做的索引登记）
- [ ] 长任务进度反馈（微信侧显示进行中状态）
- [ ] 可选：Telegram 作为第二入口冗余

---

## 七、一句话总结

**微信 ClawBot 发令 → Hermes 本地智能体执行 → OpenCode Zen/OpenRouter 提供推理 → 结果回微信 + 沉淀进 Obsidian 知识库；长任务走 Cron 异步不阻塞；模型三层 fallback 防单点。**
