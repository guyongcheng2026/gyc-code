# LLM Token 节省全攻略

> 研究日期：2026-07-31
> 适用对象：LLM API 调用方（含 Hermes Agent / 自研 Flask 应用 / 批量脚本）
> 核心结论：**缓存 > 压缩 > 推理控制 > 架构路由 > Agent 设计**。同一件事，用对杠杆可以省 10~50 倍。

---

## 一、本体：token 到底花在哪里

一次 LLM 调用 = 输入 token + 输出 token。Agent 场景下，费用大头往往是**输入侧**：

| 消耗来源 | 占比（典型 Agent 会话） | 说明 |
|---------|----------------------|------|
| 系统提示（System Prompt） | 15~30% | 角色设定、规则、环境信息，每轮都全额计费 |
| 工具定义（Tool Schemas） | 10~25% | 每个工具的 JSON Schema 都会被序列化进每轮请求 |
| 对话历史 | 30~50% | 多轮工具调用后，历史被反复重发 |
| 检索上下文（RAG） | 0~20% | 检索出的文档块，喂多少算多少 |
| 输出 | 20~40% | 最终答案 + 思考 token（reasoning_content） |

**关键认知**：
1. **输入 token 是隐藏的大头**——对话每多一轮，前面所有历史都要重新计费一次。10 轮对话的累计输入费用 ≈ 单轮输入的 10 倍以上（若无缓存）。
2. **思考 token 常被忽略**——推理模型（如 DeepSeek 思考模式）先输出一段 reasoning_content，再输出正式答案。思考部分按输出价计费，占输出 token 的 30~70%。
3. **缓存是唯一能打断"重复计费"的机制**——只有命中了 prompt cache，重复的历史才不算钱。

---

## 二、核心机制：五大杠杆

### 杠杆 1：Prompt Caching（KV 缓存复用）—— 性价比之王

**原理**：LLM 推理时对每个 token 计算 KV（Key-Value）缓存。如果本次请求的前缀与之前完全一致，前缀部分直接复用缓存，不用重新计算，也**不再按原价计费**。

**DeepSeek 官方机制（2026-07 抓取 api-docs.deepseek.com/guides/kv_cache）**：
- 磁盘缓存默认开启，无需改代码
- 缓存命中规则：**前缀完整匹配**一个"缓存前缀单元"才算命中
  - 请求边界持久化：每次请求在「用户输入末尾」和「模型输出末尾」各生成一个缓存单元
  - 公共前缀检测：系统发现多个请求共享前缀时，把公共前缀单独持久化
  - 固定 token 间隔：长输入/长输出按固定间隔切缓存单元，避免长前缀永远无法命中
- 配合滑动窗口注意力（Sliding Window Attention）存储匹配

**定价对比（DeepSeek V4 官方，2026-07）：**

| 项目 | deepseek-v4-flash | deepseek-v4-pro |
|------|-------------------|-----------------|
| 输入（缓存命中） | $0.0028 / 1M | $0.003625 / 1M |
| 输入（未命中） | $0.14 / 1M | $0.435 / 1M |
| 输出 | $0.28 / 1M | $0.87 / 1M |
| **命中/未命中比** | **1 : 50** | 1 : 120 |

> 缓存命中时输入价格仅为未命中的 **1/50**（flash 档）。这意味着把稳定前缀设计好，输入费用直接省 98%。

**应用规则**：
1. **稳定内容放前面**：System Prompt、工具定义、静态规则永远放在 messages 最前面，且保持字节级一致。
2. **变化内容放后面**：用户消息、检索结果追加在尾部。
3. **不要中途改前缀**：会话中任何对 System Prompt / 工具集的改动都会使此前所有缓存失效。这也是 Hermes 内部铁律 *"Never break prompt caching — don't change context, tools, or system prompt mid-conversation"* 的由来（工具变更要 `/reset` 新会话生效）。
4. **多轮对话天然受益**：同一会话内，每轮请求都包含完整历史，前缀命中率随轮次上升而升高。

**Anthropic 对照**（行业标准）：5 分钟 TTL 内缓存命中价 0.1x，缓存写入价 1.25x。各家缓存机制类似，DeepSeek 的折扣最深（0.02x）。

---

### 杠杆 2：上下文压缩（Context Compression）

**原理**：上下文快撑满时，把历史压缩成摘要，只保留关键信息。

**技术路线**：
| 方法 | 机制 | 压缩比 | 代价 |
|------|------|--------|------|
| 摘要式压缩 | LLM 把旧对话总结成一段 | 5~10x | 压缩本身花一次输出 token；细节丢失 |
| LLMLingua 系（微软，EMNLP'23/ACL'24） | 小模型评估 token 重要性，删掉冗余词 | **最高 20x** | 需要额外模型；中文效果依赖小模型质量 |
| 选择性丢弃 | 只保留首 N 条 + 尾 N 条，中间截断 | 视长度 | 中间信息全丢 |
| KV-Cache 压缩 | 直接压缩注意力层的 KV 缓存 | 最高 20x | 工程实现复杂 |

**实践要点**：
- 摘要压缩的**时机**比**频率**重要：过早压缩丢细节，过晚压缩可能已超限。建议在上下文用到 50~70% 时触发。
- 保护首尾：开头（任务目标）和结尾（当前进度）信息密度最高，压缩时应保留。
- 一次压缩不如结构化管理：**长任务拆短会话 + 中间结论落盘**（写文件），比硬塞在一个会话里更省 token 也更可靠。

---

### 杠杆 3：推理侧控制（Output & Reasoning）

**思考模式（Thinking Mode）**——DeepSeek V4 官方：
- 默认**开启**，先输出 chain-of-thought（经 `reasoning_content` 字段返回），再输出正式答案
- effort 参数：`low/medium` 会映射到 `high`，`xhigh` 映射到 `max`，实际可控档位是 **high / max**
- 复杂 agent 请求（Claude Code、OpenCode 等）会自动用 **max**
- 思考模式不支持 temperature/top_p 等采样参数（设置了也无效）

**控制手段**：
1. `reasoning_effort` 降档：xhigh→high 可砍掉大量思考 token（Hermes 实测冷启动+首响应缩短 40~50%）
2. `max_tokens` 上限：给输出设硬顶，防跑飞
3. 简单任务关思考模式（DeepSeek 支持 thinking disabled），复杂任务才开
4. **只取最终答案**：下游只消费 `content`，不要把 `reasoning_content` 拼回历史（DeepSeek 官方多轮对话指南明确：拼接后续轮次时可选择只拼 content）

---

### 杠杆 4：架构侧（Architecture）

1. **模型路由（Model Routing）**：简单任务（分类、抽取、格式化）用小模型，复杂任务（推理、写作）用大模型。省 50~90% 单价。
2. **RAG 检索质量 > 数量**：检索 3 个高相关 chunk 远优于检索 20 个泛泛而谈的 chunk。用 reranker 重排，控制 top_k。
3. **批处理**：可以合并的请求合并（batch API 通常还有折扣），避免每请求重复的固定开销。
4. **结构化输出**：要求 JSON/固定格式，避免模型用自然语言绕圈。但注意：JSON mode 有时反而产生更多 token（花括号和缩进），简单场景直接约束"一句话回答"更省。
5. **函数调用 vs 长文本**：需要"执行动作"用 function calling（输出短 JSON），需要"给内容"才让模型写长文。

---

### 杠杆 5：Agent 框架侧（Agent Design）

Agent 场景的 token 消耗有放大器效应（每轮工具调用 = 历史重发 + 工具结果追加），专门手段：

1. **工具集裁剪（Toolset Pruning）**：只挂载当前任务需要的工具。每多一个工具 = 每轮多一份 Schema token。Hermes 用 `enabled_toolsets` 按任务限定工具集，能显著压缩系统提示。
2. **子代理隔离（Delegation）**：把子任务丢给子代理，子代理的上下文不进父代理。父代理只收最终摘要。Hermes `delegate_task` 默认即此模式。
3. **技能按需加载（Skill Lazy Loading）**：技能列表只显示名字（一行），内容在 `skill_view` 时才进上下文。避免全量技能常驻。
4. **记忆紧凑（Memory Discipline）**：持久记忆（MEMORY.md）每轮都注入系统提示，必须保持精简。Hermes 默认 2200 字符上限。
5. **免 LLM 路径**：纯脚本能做的事不要过模型。Hermes cron 的 `no_agent=true` 模式直接跑脚本、零 token。
6. **工具输出截断**：工具返回大结果时按字节/行数截断（Hermes `tool_output.max_bytes`），防止日志型输出灌爆上下文。
7. **免费检索历史**：用本地 FTS 检索（Hermes `session_search`）代替"让模型回忆过去"，零 token 成本。

---

## 三、量化对照总表

| 手段 | 节省幅度 | 难度 | 生效范围 |
|------|---------|------|---------|
| Prompt Caching 命中（DeepSeek） | 输入费用 **-98%** | 零（默认开启） | 所有多轮会话 |
| 思考模式 effort 降档 | 输出 token **-30~70%** | 一行参数 | 推理模型 |
| 工具集裁剪 | 系统提示 **-20~50%** | 低 | Agent 框架 |
| LLMLingua 压缩 | 上下文 **最高 20x** | 中 | 长上下文场景 |
| 摘要式压缩 | 历史 **5~10x** | 低 | 超长会话 |
| 模型路由 | 单价 **-50~90%** | 中 | 混合负载 |
| RAG top_k 控制 | 检索输入 **-50~90%** | 低 | 知识问答 |
| 免 LLM 脚本路径 | **-100%**（该部分） | 低 | 可脚本化任务 |
| 对话历史结构化落盘 | 长会话 **-30~60%** | 低 | 长任务 |

> 量级排序（从高到低）：**缓存命中 > 思考控制 > 工具裁剪 ≈ 模型路由 > 压缩 > 杂项**。

---

## 四、时间线：token 优化技术演进

| 时期 | 里程碑 | 影响 |
|------|--------|------|
| 2022~2023 | Prompt Engineering 黄金期（少样本、思维链、角色设定） | 提示词层面的省法，收益有限（通常 <30%） |
| 2023 | 微软 LLMLingua 系列论文（EMNLP'23 / ACL'24） | 压缩正式成为研究方向，最高 20x |
| 2024 | Anthropic 商用 Prompt Caching（5min TTL，命中 0.1x） | 缓存成为省 token 第一杠杆 |
| 2024~2025 | 各家跟进：OpenAI / Google / DeepSeek 缓存；Agent 框架（Claude Code、Codex）普及上下文压缩 + 子代理 | Agent 场景的框架级优化成为主流 |
| 2025 | 推理模型爆发（DeepSeek-R1 等），思考 token 成为新开销 | effort 控制成为必做项 |
| 2026 | DeepSeek V4：磁盘缓存默认开启、1M 上下文、命中价 1/50；Hermes 等框架内置 compression/delegation 全套 | 缓存+框架优化成为默认，无需自研 |

趋势判断：**省 token 的重心从"提示词技巧"转移到"系统级机制"**——缓存、压缩、路由都由平台和框架内建，个人能做的增量集中在：稳定前缀设计、思考档位控制、工具集纪律。

---

## 五、Hermes 本机落地清单（谷总环境实测盘点）

当前环境：Hermes v0.19.1 / deepseek-v4-flash-free / OpenCode Zen / Windows。

### 已生效的配置（2026-07-31 读取 config.yaml 验证）

| 配置项 | 当前值 | 评价 |
|--------|--------|------|
| `compression.enabled` | true | ✅ 自动压缩已开 |
| `compression.threshold` | 0.3 | ✅ 30% 就触发，偏激进但省 token（质量敏感可放宽到 0.4~0.5） |
| `compression.target_ratio` | 0.2 | ✅ 压缩到 20% |
| `compression.protect_last_n` | 20 | ✅ 保护最近 20 条 |
| `compression.protect_first_n` | 3 | ✅ 保护开头 3 条 |
| `tool_output.max_bytes` | 30000 | ✅ 工具输出截断 |
| `agent.reasoning_effort` | high | ✅ 平衡档（deepseek 档位实际是 high/max 二选一） |
| `agent.environment_probe` | false | ✅ 省环境探测 token |
| `agent.max_turns` | 50 | ✅ 防死循环 |
| `checkpoints.enabled` | false | ✅ 关闭省内存 |

### 可继续深挖的动作（按收益排序）

1. **利用 DeepSeek 缓存红利（收益最大，零成本）**
   - 保持会话前缀稳定：同一会话内不要中途 `hermes tools` 改工具、不要改 system prompt；工具变更走 `/reset` 开新会话
   - 长任务拆分会话时，把"稳定背景"（项目规则、技术栈说明）写进 `.hermes.md` / `AGENTS.md`，让它成为每个新会话的稳定前缀
   - 实测验证：`/usage` 命令可看每轮 token 消耗；若想量化缓存命中率，可在 `.env` 开启调试日志或用 provider 后台统计

2. **免费模型的限流保护（deepseek-v4-flash-free）**
   - 免费档有 RPM/TPM 限制，token 省 = 限流少触发 = 任务更快完成
   - `reasoning_effort` 保持 high（不要升 max 除非复杂编码任务）；简单问答任务可临时 `/reasoning low`（注意 DeepSeek 会把 low/medium 映射回 high，实际降无可降，真正省思考 token 只能靠关思考模式，而 free 档通常锁定思考模式）

3. **会话纪律（长期收益）**
   - 单个会话任务完成后 `/new`，不要让一个会话无限膨胀
   - 中间产物落盘（写文件）比留在对话历史里便宜——文件读取是按需的，历史是每轮全量重发的
   - 长对话主动 `/compress` 或让它自动触发（threshold 0.3 已足够灵敏）

4. **工具集纪律**
   - 当前启用了 browser/terminal/file 等全套，都是常用项，保留
   - 若某阶段任务纯文本处理，可用 `hermes chat -t <toolsets>` 限定工具集，省系统提示 token
   - cron 任务能用 `no_agent=true`（纯脚本）就不要过 LLM

5. **自研 Flask 应用接入 LLM 时**
   - 请求体把 system prompt 放最前，保持每次调用字节一致 → 命中 DeepSeek 磁盘缓存
   - 多轮对话服务端保存完整 messages，客户端只传 delta → 前缀天然稳定
   - 用 `extra_body={"thinking":{"type":"disabled"}}` 在简单接口关思考模式
   - 输出设 `max_tokens` 硬顶

### 不建议做的事
- ❌ 自研 LLMLingua 压缩管道——框架已内置压缩，自研收益边际
- ❌ 为省 token 把关键上下文裁掉——省了 token 赔了质量，得不偿失
- ❌ 频繁切换模型/提供方——每切换一次缓存全失效，且 Free 模型切换有冷启动成本

---

## 附：关键官方来源

- DeepSeek Context Caching：https://api-docs.deepseek.com/guides/kv_cache
- DeepSeek Pricing（V4 flash/pro 缓存价）：https://api-docs.deepseek.com/quick_start/pricing
- DeepSeek Thinking Mode：https://api-docs.deepseek.com/guides/thinking_mode
- LLMLingua（微软）：https://github.com/microsoft/LLMLingua
- Anthropic Prompt Caching：https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching
