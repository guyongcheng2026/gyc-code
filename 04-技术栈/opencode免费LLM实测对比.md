# opencode 平台免费 LLM 实测对比报告

> 实测日期：2026-08-05
> 测试方式：`opencode run --format json -m opencode/<模型>` 同一 prompt 实测
> 测试 prompt：`用一句话解释什么是依赖注入，并用Python写一个3行的示例函数。`
> 结论先行：**7 个免费模型全部可用，deepseek-v4-flash-free 仍是综合最佳主力；按场景各有特色**

---

## 一、免费模型全览（7个）

| 模型 | 厂商 | 定位 |
|------|------|------|
| deepseek-v4-flash-free | DeepSeek | 日常主力,编码强 |
| nemotron-3-ultra-free | NVIDIA | 大模型推理(550B MoE) |
| north-mini-code-free | NorthAI | 专为代码设计 |
| ling-3.0-flash-free | InclusionAI | 快速低延迟 |
| mimo-v2.5-free | MiMo/通义系 | 通用 |
| laguna-s-2.1-free | Laguna | 轻量 |
| longcat-2.0-free | Longcat | 长上下文 |

## 二、实测结果（速度+质量）

| 模型 | 耗时 | 中文 | 代码质量 | 点评 |
|------|:---:|:---:|:---:|------|
| **deepseek-v4-flash-free** | 18.9s | ✅ | ⭐⭐⭐ | 定义准确+示例完整,主力首选 |
| **nemotron-3-ultra-free** | 16.1s | ✅ | ⭐⭐ | 简洁,示例偏短 |
| **north-mini-code-free** | 21.1s | ❌ | ⭐⭐⭐ | **英文回答**,代码专用,中文弱 |
| **ling-3.0-flash-free** | **12.2s** | ✅ | ⭐⭐⭐ | **最快**,示例优雅(lambda) |
| **mimo-v2.5-free** | 18.9s | ✅ | ⭐⭐ | 中等 |
| **laguna-s-2.1-free** | 19.7s | ✅ | ⭐⭐⭐⭐ | **示例最完整**(双类+注入) |
| **longcat-2.0-free** | 16.1s | ✅ | ⭐⭐⭐⭐ | **解释最规范**(加粗+完整类) |

## 三、分场景推荐

| 场景 | 推荐模型 | 理由 |
|------|---------|------|
| **日常主力** | deepseek-v4-flash-free | 中文+代码均衡,血统熟悉 |
| **复杂推理/大模型** | nemotron-3-ultra-free | 550B 参数,推理力最强 |
| **纯代码生成(可英文)** | north-mini-code-free | 代码专用模型 |
| **快速低延迟** | ling-3.0-flash-free | 12.2s 最快 |
| **长文档分析** | longcat-2.0-free | 长上下文专注 |
| **示例最完整** | laguna-s-2.1-free | 输出最完整 |

## 四、使用命令

```bash
opencode -m opencode/deepseek-v4-flash-free    # 主力
opencode -m opencode/nemotron-3-ultra-free     # 需要强推理
opencode -m opencode/ling-3.0-flash-free       # 要快
```

## 五、注意事项

1. **免费档有日限额**（类似 OpenRouter 50次/天,具体以平台为准）
2. **重度使用建议走 DeepSeek 官方付费 key**（已配 Codex 直连）
3. north-mini-code 中文支持弱,中文场景慎用
4. 速度受网络影响,本测为单次样本（2026-08-05）

## 六、结论

> **7 个免费模型全部可用、全部实测通过。综合最佳仍是 deepseek-v4-flash-free（中文+代码+速度均衡）；要快用 ling、要强用 nemotron、要规范用 longcat、要代码用 laguna。**

---

*实测：小翎 | 2026-08-05*