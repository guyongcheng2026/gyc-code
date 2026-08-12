# 硬件性能审计报告：发热/噪音/幻觉/缓存/体积/存储 六问题深挖

> 日期：2026-08-12（已更新：记录内存专项与缓存闭环实施结论）
> 本机硬件：Intel Core i5-5250U（2015 超低电压双核四线程，15W TDP，1.6GHz，最大睿频 2.7GHz）
> 结论先行：该 CPU 极低功耗，发热/噪音对 CPU 占用极其敏感；所有优化以"降 CPU 占用 + 降内存 + 降 IO"为核心目标
> 对标基准：Claude Code（空闲近 0 CPU、内存 <500MB、冷启动 <2s、会话数据按需保留）

---

## [1] 发热/噪音（CPU 高占用）— 实测修正 + 已优化

### 实测（修正）
- 常驻 gyc CLI（`bun --smol dist/index.js`）空闲态 30s 采样：**CPU 平均 1% 单核**（此前单次 5s 采样 5.5% 为波动误判，已修正）
- 工作集：**756MB 稳定**（3min 采样 832→756，GC 回收，**无泄漏**）
- 结论：空闲 CPU 已低（1%），无需降帧；发热主因是**流式渲染峰值 + 内存换页**

### 已实施优化
1. **TUI 流式渲染 30ms 节流**（`617a687`）：scrollback commit 队列由 queueMicrotask 改 30ms 时间节流，突发 delta 合并为有界渲染批次（上限 ~33fps），降流式 tree-sitter 重解析与渲染开销
2. **事件写入节流**（`9997d77`）：v2 LLM Delta 事件改 publishLive 不落库，消除每 token DB 写（降 IO/CPU）
3. 确认 bg-pulse 动画默认关闭 + targetFps 30（已优化到位）

## [2] 幻觉率高 — 待实施（需产品/提示词决策）

### 现状
- 系统提示按模型分发 9 套，无强化"知识边界/不确定时明说"约束
- 记忆注入已做会话级 30min 缓存（前缀稳定）

### 方案
1. 审查各 prompt 的"幻觉防护"段落（不确定标注、工具结果验证、禁止臆造路径）
2. 关键事实输出要求引用证据（file:line/命令输出）
3. 降低 small model（summary/记忆提取）对主对话的干扰

## [3] 缓存命中率 — 闭环已建立 + 实测 0%

### 关键发现
- **usage 已持久化**到 `message.data.tokens`（v1/v2 均含 `cache.read`），闭环数据存在但此前无观测工具
- **实测命中率 0%**：`db cache` 显示最近 48 条消息共 **2319 万 input tokens**，cache.read 全为 0
- **根因**：当前模型 `opencode/deepseek-v4-flash-free`（免费模型）**不报告 prompt caching**

### 已实施
- 新增 `gyc db cache` 命令（`9d55434`）：查询最近 50 条消息命中率，0% 时提示原因（模型不支持/前缀不稳定）

### 提升路径（换模型后）
1. 换支持缓存的模型（Claude/GPT），系统提示已缓存友好（记忆 30min 缓存、environment 固定、`promptCacheKey`）
2. 换模型后跑 `gyc db cache` 验证

## [4] CLI 启动包较大 — 实测结论：209MB 合理，不强行瘦身

### 实测
- dist 209.87MB：4097 chunks；23 个 >=1MB（MD5 全唯一）；18 个 ~2.18MB 含 effect 等核心库
- 冷启动 3.0s（dist --help，达标 <3.5s）
- external 实验反增到 221MB（bun target:bun 不适用）→ 保持现状

## [5] 存储及数据库文件较大 — 已实施治本 + 清理

### 实测
- DB 172.52MB + WAL 8.25MB；event 表 101MB / 54336 行（v2 Delta 每 token 冗余 + v1 tool part 状态事件）

### 已实施
1. **事件写入节流**（`9997d77`）：v2 Text/Reasoning/Tool.Input.Delta 改 publishLive 不落库（零消费方冗余），DB 停止膨胀
2. **db cleanup**（`6d25c24`）：清理孤儿事件 + VACUUM + WAL checkpoint（实测 DB+WAL 186.6→174.5MB）

## [6] read/write 命令不能正常使用 — 已修复

### 根因
read 用 FSUtil.normalizePath（Windows `\`→`/`）作缓存 key，write/edit 用原始路径 → key 不匹配，read 后 write 被误拒

### 修复（`27ee45a`）
ReadCache 内部统一 key 归一化，read/write/edit 自动一致；新增回归测试

## [7] 内存专项：756MB → 500MB 评估与实施 — 已实施降级渲染

### 实测构成
| 场景 | 内存 |
|---|---|
| 干净 TUI 基线（无会话） | **354MB**（Effect/opentui/LLM SDK/Bun，功能必需） |
| 运行中（稳定态，无泄漏） | **~756MB** |
| 会话累积（scrollback 渲染树） | **~400MB**（@opentui native 保留每条目高亮数据，应用层无清理 API） |

### 评估结论
- 500MB 需削减 scrollback 400→~150MB（-63%），@opentui 无上限/清理 API
- **唯一途径是降级渲染**（牺牲语法高亮/精细 markdown），用户已确认

### 已实施（降级渲染换内存）
1. **scrollback 语法高亮默认关闭**（`ab240ed`）：resolveRunTheme 不生成 SyntaxStyle，条目不再持有 tree-sitter 高亮 spans
2. **markdown/code 降为纯文本**（`ee269ce`）：Code/MarkdownRenderable 改 TextRenderable，跳过 tree-sitter 解析
3. 均保留 `GYCCODE_SYNTAX_HIGHLIGHT=1` 恢复富渲染
4. 内存收益需**重启 TUI**（加载新 dist）后实测确认

---

## 优先级与状态汇总

| 问题 | 状态 | 提交 |
|---|---|---|
| [6] read/write 误拒 | ✅ 已修复 | 27ee45a |
| [5] DB 事件膨胀 | ✅ 已治本（Delta 不落库 + cleanup） | 9997d77 / 6d25c24 |
| [1] 流式渲染 CPU | ✅ 已节流（30ms） | 617a687 |
| [7] 内存 756MB | ✅ 已降级渲染（高亮/纯文本） | ab240ed / ee269ce |
| [3] 缓存闭环 | ✅ 已建立（db cache）+ 0% 根因确认 | 9d55434 |
| [2] 幻觉率 | ⏳ 待实施（prompt 审查） | — |
| [4] dist 体积 | ✅ 评估完成（209MB 合理） | — |

## 待办（后续）
1. 重启 TUI 实测降级渲染的内存收益（验证 756MB 降幅）
2. 幻觉率：审查 9 套 prompt 的幻觉防护段落
3. 缓存：换支持缓存模型后验证命中率