# 推理档位（Reasoning Effort）研究 — 原文精读 + Hermes 落地指南

> 来源1：小红书笔记《Codex、Claude Code的推理档位，其实就是一句提示词》（智见AI，2026-07）
> 来源2：Sebastian Raschka《Controlling Reasoning Effort in LLMs》（2026-07-18 原文）
> 原文地址：https://magazine.sebastianraschka.com/p/controlling-reasoning-effort-in-llms
> 研究日期：2026-07-31

---

## 一、原文核心知识（精读版）

### 1. 推理模型的定义
- "推理模型"不是说模型真的像人一样推理，而是：**输出最终答案前，先输出一段中间思考过程（reasoning trace）**，相当于把草稿纸一并交上来
- 普通LLM直接给答案，推理LLM先"绕一段"再作答

### 2. 训练与推理两种扩展（两个旋钮）
| 维度 | 换模型（训练scaling） | 调档位（推理scaling） |
|------|---------------------|---------------------|
| 本质 | 换权重，不同训练算力产出的模型 | 同一模型，多花/少花token思考 |
| 操作 | 选Luna/Terra/Sol | 调Light→Ultra |
| 效果 | 换基座能力 | 调推理深度 |
| 成本 | 训练时投入 | 推理时投入 |

**关键发现**：两条曲线会重叠——小模型开高档有时能追平大模型开低档。

### 3. RLVR训练法（DeepSeek-R1开创）
- RLVR = Reinforcement Learning with Verifiable Rewards（可验证奖励强化学习）
- 答对给1、答错给0，**不评判中间推理过程**
- 只靠这个，模型就自己学会了推理（Aha时刻：模型发现自己错了并自我纠正）
- 数学用SymPy/WolframAlpha验算，代码用编译器/单元测试/LeetCode验证
- 训练管线：预训练基座 → SFT → 推理RL(RLVR) → 更多SFT → RLHF

### 4. `<think>`标签是装饰性的
- 对推理能力零贡献，只是标记草稿起止，方便UI折叠隐藏
- R1总奖励 = R_accuracy（准确率）+ R_format（格式规则，纯规则检查）
- 换成任意别的符号效果一样

### 5. 第一代推理模型（R1）的缺陷
- 不管问什么都长篇大论（问1+1也啰嗦一大段）
- **没有关闭推理的开关** → 催生后来的"档位"设计

### 6. 档位的本质：就是一句system prompt
- GPT-5.6六档（Light/Medium/High/XHigh/Max/Ultra）= 请求前加 `Reasoning effort: low/medium/high`
- 界面选择器只是把选择映射成这句话
- 但这句话要模型"听得懂"，训练时必须配合

### 7. 让模型听懂档位指令的两种训练配方
- **路线一（RLVR阶段）**：不同system prompt配不同**长度惩罚**——说low罚长文逼它写短，说high几乎不罚放它写长
- **路线二（SFT阶段）**：RLVR后再补一轮SFT，喂"这个prompt对应这么长推理"的样本
- 两条路可组合（gpt-oss和GPT-5.6疑似组合使用）

### 8. 六大开源旗舰的真实配方（原文第六章）
| 模型 | 做法 | 特色 |
|------|------|------|
| **DeepSeek V4** | 训3个专家（Non-think/Think High/Think Max），各自独立上下文窗口+长度惩罚，蒸馏进同一checkpoint | "Reasoning Effort: 绝对最大，不允许走捷径"有专门训练支撑 |
| **Nemotron 3 Ultra** | 推理预算（硬性停止机制）+学习档位双轨 | 超预算自动闭合思考块继续回答 |
| **Kimi K2.5** | Toggle方法：预算阶段与无约束阶段交替RL | 省25-30% token，性能几乎不变 |
| **Kimi K3** | 9个专家（3档×3领域）多教师蒸馏 | 超预算奖励设为-1强激励 |
| **GLM-5** | 三种思考模式（interleaved/preserved/turn-level） | 多轮工具调用场景 |
| **Qwen3** | Thinking Mode Fusion（SFT混合思考/不思考样本） | enable_thinking=True/False开关 |

### 9. 档位不是越高越好
- 档位→输出长度→精度，正相关但**边际递减明显**
- GPT-5.6 Sol最高档：成本暴涨、收益趋平
- **中间档才是精度、成本、延迟三者的甜点区**
- 一句话："拨到max不等于答得更对"

### 10. API参数速查
```python
# OpenAI SDK 风格（DeepSeek V4示例）
response = client.chat.completions.create(
    model="deepseek-v4-pro",
    reasoning_effort="high",  # low/medium/high/max
    extra_body={"thinking": {"type": "enabled"}}
)
```
- OpenAI格式：`{"reasoning_effort": "high/max"}`
- Anthropic格式：`{"output_config": {"effort": "high/max"}}`
- 兼容性：thinking模式下low/medium映射为high，xhigh映射为max
- **复杂agent请求（Claude Code、OpenCode）默认自动max**

### 11. 未来方向
- 圣杯：**自动档位选择**（GPT-5的Auto模式失败被移除）
- 近期：档位仍是显式模型输入，通过system prompt传递
- 中期：agent wrapper/harness或内部router根据任务状态自动推断档位
- 应保留用户override能力（优化延迟/成本/性能）

---

## 二、Hermes 落地用法

### 核心结论
**Hermes就是文中所说的"agent wrapper/harness"——正是自动推断档位的理想位置。** 我们跑在 deepseek-v4-flash-free 上，这个"flash"很可能就是低档位/快思考变体。当前架构下有几件事可以直接做：

### 1. 系统提示词声明推理需求（立即可用）
文中证实：档位=system prompt一句话，背后有RLVR训练支撑。可以在Hermes提示词里按任务声明：
- 日常闲聊：无需声明（默认快速）
- 复杂任务：在prompt中明确"请深入分析，逐步推理，给出完整论证过程"
- 关键：**声明要具体到输出长度**（"不少于500字论证"），因为长度就是精度代理

### 2. 模型选型策略（成本优化）
| 任务类型 | 建议档位/模型 | 理由 |
|---------|-------------|------|
| 闲聊/微信回复 | flash（低档） | 快、便宜，无需深推理 |
| 文件操作/工具调用 | 中档 | 工具调用不需要长思考 |
| 研究报告/PRD撰写 | 高档或pro模型 | 需要完整推理链 |
| 代码审查/调试 | 高档 | 边际收益最大 |

### 3. 多模型切换机制（推荐实践）
利用Hermes的 `/model` 切换 + fallback链：
- 日常默认 deepseek-v4-flash-free（低成本）
- 复杂任务切 deepseek-v4-pro 或 MoA 预设（多模型视角）
- 注意：**换模型和调档位是两个独立动作**，可组合

### 4. 认知校准（最重要的收获）
- **"贵模型不一定更准"**：评估是否升级模型前，先确认当前模型是否已到甜点区
- 边际递减规律适用于所有模型族：追求最高档不如找甜点档
- 评估标准：看任务类型是否在模型能力饱和区

### 5. 未来展望（可监控）
- 关注 deepseek-v4 的 reasoning_effort 参数暴露情况
- 若 Hermes 未来支持按任务自动调档，就是文中"自动档位选择"的实现
- 目前 opencode-zen 的 deepseek-v4-flash-free 未暴露档位参数（免费版限制），但可先按此框架规划

---

## 三、实用建议

1. **短期**：在系统提示词中为复杂任务声明推理深度，观察输出质量变化
2. **中期**：考虑为研究报告类任务配置 pro 模型或 MoA，对比质量/成本
3. **长期**：若国产模型（deepseek/kimi/glm）在 Hermes 可用，优先选支持 reasoning_effort 参数的

---

*整理人：小翎 | 2026-07-31*
