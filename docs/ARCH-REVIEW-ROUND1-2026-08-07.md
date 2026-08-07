# gyc-code 架构审查报告（第一轮 — Claude Code 驱动）

日期：2026-08-07
审查引擎：Claude Code CLI 2.1.223，后端 = DeepSeek Anthropic 兼容端点（api.deepseek.com/anthropic，零额外成本）
范围：src/opencode 核心层（session/plugin/tool/acp/provider）+ 静态初检
对标基准：Pi Agent(性能)、Hermes(记忆)、MiMo Code(功能)、Claude Code(编码能力)

## 一、问题清单汇总（按模块）

| 模块 | P0 | P1 | 关键发现 |
|------|----|----|----------|
| session 核心(3文件) | 0 | 8 | 重试回放致工具二次执行；tokens覆盖不累加；failToolCall对pending不结算；共享options别名污染 |
| plugin | 2 | 11 | 单插件hook失败阻断全链路trigger；server工厂异常被吞无反馈；OAuth端口毒化；设备码无限轮询 |
| tool | 1 | 15 | apply_patch移动自指删文件(数据丢失)；SSRF无内网防护；符号链接逃逸；TOCTOU并发覆盖；edit全量读无上限 |
| acp | 0 | 9 | 错误信息被抹平；目录快照永久陈旧；未知命令静默吞；runUntilIdle无超时；分页同刻跳会话 |
| provider | 0 | 7 | budgetTokens负数；authorize空引用；error.message短路死代码；枚举顺序依赖 |
| **合计** | **3** | **50** | |

## 二、最严重问题（优先处理）

1. **P0 tool** apply_patch:235-244 「move」自指 → 先写再删同路径 = 静默删文件（数据丢失）
2. **P0 plugin** index.ts:289 单个第三方hook抛错即阻断所有chat/工具调用
3. **P0 plugin** index.ts:222 插件server()启动异常被吞，用户零反馈
4. **P1 tool** webfetch:35 SSRF（无内网/回环防护）、external-directory 符号链接逃逸
5. **P1 session** processor:660 重试回放 → 工具二次执行（shell跑两遍）
6. **P1 session** processor:443 tokens覆盖 → 多步调用token统计少算

## 三、对标差距

- **性能（Pi）**：acp usage每轮全量拉历史消息算cost，O(会话长度)；run链路瓶颈是opencode架构固有初始化
- **记忆（Hermes）**：无跨会话记忆系统/上下文压缩触发后无rebase（需接入compact以后评估）
- **功能（MiMo）**：websearch在非opencode provider被整体移除(P1-13)；ACP currentValue可能不在options内
- **编码能力（Claude）**：edit.ts 9个模糊replacer重叠复杂逻辑、any滥用55处（copilot/plugin/provider集中）

## 四、静态初检信号（P2级）

- any类型：55处（src/opencode/lsp、plugin、provider、tool、util）
- console.*：112处（多在CLI debug输出，合理）
- TODO/FIXME：13处
- 巨型文件(>1000行)：17个（最大 codemode/interpreter/runtime.ts=3465；provider.ts=2011；lsp 1944；prompt.ts 1631）
- core 无分层违例（依赖为@opencode-ai内部包）；UI/TUI无反向依赖cli ✓

## 五、审查管线（可复用）

- 引擎：claude -p（print mode），ANTHROPIC_BASE_URL=https://api.deepseek.com/anthropic + DEEPSEEK_API_KEY
- 幂等打包：scripts/claude-review.sh <目标目录> <输出md> <聚焦>
- 纪律：每页分模块审，P0/P1带文件+行号+锚点+建议；未检明确标注
- 已知坑：DeepSeek审查大目录(>4k行)易超max-turns，需拆小；config目录两次触发依赖解析致超turn

## 六、待覆盖

server(7707)、llm其余、session其余(20文件)、core/、ui/、tui/、cli/cmd(21000行)、schema/

报告文件分布：hermes/cache/g-review-{session,plugin,tool,acp-quick,provider}.md