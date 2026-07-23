# TencentDB Agent Memory — Hermes 长期记忆系统

> 腾讯云开源的 AI Agent 长期记忆系统，Hermes Agent 首款完整四层记忆 MemoryProvider。
> 来源：微信公众号「丁卯生人」· 2026.07
> GitHub: 8.4k Stars · MIT 许可

---

## 一、背景

在实际使用 AI Agent 的过程中，我们往往需要反复告诉它固定的 **SOP、项目背景、工具习惯和输出格式**。Hermes 内置的 memory 基于简单的 Markdown 文件，跨会话能力有限。

TencentDB Agent Memory 正是为解决这一矛盾而生——它是 Hermes Agent 的**首款完整四层记忆 MemoryProvider**，也是一套工程级的长期记忆解决方案。

## 二、核心架构：四层记忆金字塔

```
L3 Persona  ── 用户画像（宏观偏好、风格、长期目标）
    ↑ 合成
L2 Scenario ── 场景块（结构化情景归纳，Markdown 文件）
    ↑ 归纳
L1 Atom     ── 原子化事实（结构化记忆，向量化存储）
    ↑ 萃取
L0 ──────── 原始对话（完整记录，SQLite 持久化）
```

| 层级 | 名称 | 存储方式 | 作用 |
|------|------|---------|------|
| L0 | Conversation | SQLite 持久化 | 原始对话完整记录 |
| L1 | Atom | SQLite + sqlite-vec 向量化 | 原子化事实，支持语义检索 |
| L2 | Scenario | Markdown 文件（人类可读） | 结构化情景归纳 |
| L3 | Persona | Markdown 文件（人类可读） | 用户画像（偏好、风格、长期目标） |

**设计原则**：
1. 下层保留证据：L0/L1 存入数据库，支持全文和语义检索
2. 上层保留结构：L2/L3 存入人类可读的 Markdown，支持白盒调试
3. 全链路可追溯：Persona → Scenario → Atom → Conversation，逐层下钻，永不丢失

## 三、短期记忆压缩（Context Offload）

当上下文快要被日志撑爆时，系统自动将完整的工具日志卸载到外部文件，仅在上下文中保留 **Mermaid 符号图谱**。

```
Verbose Logs ──①──→ External FS (refs/*.md)
(几十万 Token) ──②──→ Mermaid Symbol Graph (带 node_id)
                         │
                         ③ 轻量注入 Agent Context
                         │
Agent ◄──── ④ 按 node_id 随时 grep 召回原文
```

Agent 推理时按 `node_id` 下钻即可恢复完整细节，既**大幅降低 Token 消耗**，又保全了 100% 的可追溯性。

## 四、通信架构

```
Hermes Agent (Python)
  └─ MemoryManager
      └─ MemoryTencentdbProvider (Python 插件)
          ├─ GatewaySupervisor
          └─ MemoryTencentdbSdkClient
              │────────── HTTP ──────────→
              memory-tencentdb Gateway (Node.js)
                └─ Core Engine
                    ├─ L0 Conversation
                    ├─ L1 Episodic extraction
                    ├─ L2 Scene blocks
                    ├─ L3 Persona synthesis
                    └─ Storage: SQLite / Tencent VectorDB
```

Hermes Agent 运行一个轻量 MemoryProvider 插件，将每轮对话通过 HTTP 发送到 Node.js Gateway。Gateway 运行完整的核心引擎：捕捉对话 → 提取记忆 → 归纳场景 → 合成画像，每轮对话前自动执行 **Recall**，将相关记忆注入 Hermes 上下文。

## 五、优势对比

| 维度 | Hermes 内置 memory | + TencentDB Agent Memory |
|------|-------------------|--------------------------|
| 存储方式 | 简单的 Markdown | 四层金字塔：SQLite + 向量 + Markdown |
| 跨会话 | 有限 | 完整的 L0→L3 流水线 |
| 上下文压缩 | 无 | Mermaid 符号图谱 + 上下文卸载 |
| 白盒可调试 | 直接看 Markdown | L2/L3 也是 Markdown，可逐层追踪 |
| LLM 工具 | 无 | `memory_search` / `conversation_search` |
| 存储后端 | 文件系统 | SQLite / Tencent 向量数据库 |

### Benchmark 数据

| 指标 | 原生 | +插件 | 提升 |
|------|------|-------|------|
| WideSearch 通过率 | 33% | 50% | **+51.52%** |
| WideSearch Token | 221.31M | 85.64M | **−61.38%** |
| SWE-bench 通过率 | 58.4% | 64.2% | **+9.93%** |
| AA-LCR 通过率 | 44.0% | 47.5% | **+7.95%** |
| PersonaMem 准确率 | 48% | 76% | **+59%** |

## 六、部署方式

### 方式一：Docker 一键启动

```bash
git clone https://github.com/TencentCloud/TencentDB-Agent-Memory.git
cd TencentDB-Agent-Memory/docker/open-source
docker build -f Dockerfile.hermes -t hermes-memory .
docker run -d --name hermes-memory --restart unless-stopped \
  -p 8420:8420 \
  -e MODEL_API_KEY="***" \
  -v hermes_data:/opt/data \
  hermes-memory
```

### 方式二：手动接入现有 Hermes

5 步完成：

1. **安装 Gateway 插件包**：`npm install @tencentdb-agent-memory/memory-tencentdb@latest`
2. **安装 Gateway 依赖**：`npm install tsx`
3. **链接到 Hermes 插件目录**：符号链接到 `~/.hermes/plugins/memory/memory_tencentdb/`
4. **配置 config.yaml**：设置 `memory.provider: memory_tencentdb`
5. **配置 .env**：设置 Gateway 启动命令和 LLM 凭证

## 七、LLM 工具

集成后 Hermes 自动获得两个记忆搜索工具：

| 工具 | 作用 | 示例 |
|------|------|------|
| `memory_tencentdb_memory_search` | 搜索长期记忆（L1 结构化） | `{"query": "用户的编程语言偏好", "limit": 5}` |
| `memory_tencentdb_conversation_search` | 搜索原始对话（L0 记录） | `{"query": "关于 Docker 部署的讨论", "limit": 5}` |

## 八、工程可靠性设计

| 机制 | 说明 |
|------|------|
| 熔断器 | 连续 5 次 Gateway 失败后自动熔断 60 秒，防止雪崩 |
| 背压保护 | 最多 4 个并发 sync_turn，第 5 个等待最长 5 秒 |
| 自愈看门狗 | 每 10 秒检查健康状态，崩溃时自动重启 |
| 后台初始化 | `initialize()` 不阻塞 Hermes 启动，工具 schema 先注册 |

## 九、与我当前环境的适配评估

| 维度 | 评估 |
|------|------|
| 对我是否有用 | ✅ 极高。我多个项目（ECP/HR/E-Learning）需要 Agent 记住项目背景和编码习惯 |
| 部署成本 | ⚠️ 中等。需确认 Docker 或 Node.js 环境，需要维护一个后台 Gateway 进程 |
| 额外费用 | ⚠️ Gateway 需要调用 LLM（GPT-4o 或 DeepSeek）做记忆提取，有额外 API 开销 |
| Windows 兼容 | ⚠️ 文章中部署步骤以 Linux/macOS 为主，Windows 需要适配 |
| 替代方案 | Hermes 内置 memory + Markdown 已可用，但跨会话能力有限 |

**建议**：先确认环境（Node.js/Docker），用手动接入方式试跑，用默认配置观察几天的 Token 消耗和记忆效果。

## 🔗 相关链接

- [[AI-CLI工具命令参考]]
- [[CLI-TUI-IDE模式详解]]
- [GitHub: TencentDB-Agent-Memory](https://github.com/TencentCloud/TencentDB-Agent-Memory)
- [NousResearch Hermes Agent](https://github.com/NousResearch/hermes-agent)

---

*创建日期: 2026-07-12*
*来源: 微信公众号「丁卯生人」· Hermes Agent × TencentDB Agent Memory 集成指南*
*类型: 外部技术文章*
*状态: 初版*
