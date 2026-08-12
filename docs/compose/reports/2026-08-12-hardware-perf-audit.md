# 硬件性能审计报告：发热/噪音/幻觉/缓存/体积/存储 六问题深挖

> 日期：2026-08-12
> 本机硬件：Intel Core i5-5250U（2015 超低电压双核四线程，15W TDP，1.6GHz，最大睿频 2.7GHz）
> 结论先行：该 CPU 极低功耗，发热/噪音对 CPU 占用极其敏感；所有优化以"降 CPU 占用 + 降内存 + 降 IO"为核心目标
> 对标基准：Claude Code（空闲近 0 CPU、内存 <500MB、冷启动 <2s、会话数据按需保留）

---

## [1] 发热/噪音（CPU 高占用）— 已实测

### 实测
- 常驻 gyc CLI（`bun --smol dist/index.js`）运行 2.5h：累计 CPU 3565s
- 空闲态采样：**5.5% 单核**（4 逻辑线程）；**工作集 848MB**（内存高）
- 持续 CPU + 高内存 → 磁盘换页 + 风扇 → 发热/噪音

### 根因候选
1. **内存 848MB**：TUI 长会话累积（消息/part/事件在内存 + 缓存），GC 压力大
2. **空闲轮询**：bg-pulse 动画（帧率 12/30）、autocomplete interval、terminal-win32 1000ms 轮询
3. **每 token DB 写**：message.part.updated 每 token 持久化事件（见 [5]）→ IO + CPU

### 对标 Claude Code
- Claude Code 空闲时 TUI 零轮询（仅事件驱动重绘）；会话数据按需加载，内存有界

### 最佳方案（无损）
1. **TUI 空闲降帧**：bg-pulse 动画默认关闭（animations_enabled=false 时零渲染）；renderer targetFps 60→30（perf skill 已验证无损）
2. **轮询降频**：autocomplete/terminal-win32 的 interval 降频（100ms→1000ms），非活跃时暂停
3. **事件写入节流**：part.updated 批量写（30ms 合并队列），每 token 写 → 每帧写（降 IO 一个数量级）→ 同时解决 DB 膨胀与发热
4. **内存有界**：长会话缓存 LRU（已有 200 条 read-cache），增加 message/part 内存分页

## [2] 幻觉率高 — 待实施

### 现状
- 系统提示按模型分发（anthropic/default/beast/gemini/gpt/kimi/meta/codex/trinity 9 套），**无明确"知识边界/不确定时明说"约束的强化**
- 记忆注入已做会话级 30min 缓存（前缀稳定）

### 对标 Claude Code
- Claude Code 系统提示含强"不确定就说不确定"、工具结果精读、迭代验证约束

### 最佳方案
1. 审查 default/anthropic 等 prompt 的"幻觉防护"段落（不确定标注、工具结果验证、禁止臆造文件路径）
2. 关键事实类输出要求"引用证据（file:line/命令输出）"——与既有 review 纪律一致
3. 降低 small model（summary/记忆提取）对主对话的干扰（幻觉传染）

## [3] 缓存命中率待提高 — 部分已优化

### 现状
- 系统提示已缓存友好：记忆注入会话级 30min 缓存、environment 固定、skills/MCP 预算化
- `promptCacheKey`：session id 提取（openai promptCacheKey）
- **DB 未持久化 usage**，实际命中率无法观测（无数据支撑优化闭环）

### 对标 Claude Code
- Claude Code 的 prompt cache 依赖**系统提示字节稳定 + 消息前缀稳定**，并监控 cache read 比例

### 最佳方案
1. **持久化 usage.cacheReadInputTokens**（session/message 表已有字段但未写入）→ 建立命中率可观测闭环
2. 排查系统提示非稳定源：references 列表排序已 toSorted（稳定）；确认无每轮变化的时间戳/随机注入
3. 长对话前缀稳定：避免插入易变内容到历史前缀（如每轮不同的 system 补充）

## [4] CLI 启动包较大 — 实测结论：209MB 合理，不强行瘦身

### 实测
- **dist 209.87MB**：4097 chunks；23 个 >=1MB chunk（MD5 全唯一）；18 个 ~2.18MB chunk 含 effect 等核心库
- **冷启动 3.0s**（dist --help，达标 <3.5s）
- 构成：effect/solid/@opentui 等核心 + shiki 多语言 tree-sitter grammar（bash/js/markdown/powershell/typescript/zig）+ photon_rs wasm（图片，按需加载）

### 实验
- 把 effect/solid/shiki/tree-sitter 设 external：**dist 反增到 221MB**（bun `target:bun` 下 external 不适用）
- 结论：bun splitting+minify 已是合理配置，209MB 是这些大依赖的合理体积

### 对标 Claude Code
- Claude Code 是 npm 包（node_modules 数百 MB），CLI 核心 dist 小（~几十 MB）；gyc 把 shiki 高亮 + TUI 全打包进 dist

### 最佳方案
1. **接受现状**（3.0s 冷启动达标），不强行 external（已验证反效果）
2. 可选微优化：shiki 只打包实际高亮语言（裁剪 powershell/zig 等未用 grammar，省 ~3MB）；photon 按需已隔离
3. 长期：tree-sitter 高亮改轻量正则高亮（大幅减体积）——需功能权衡，记入路线图

## [5] 存储及数据库文件较大 — 根因确认

### 实测
- **gyccode-local.db 172.52MB + WAL 8.25MB**
- event 表 **101.27MB / 54336 行**（`message.part.updated` 35663 行 —— **每 token 一个持久化事件，data 快照式**）
- part 表 32.96MB / 13447 行；message 1.15MB
- **event 表无清理/归档机制**（core/event 仅 sql.ts，无 prune）

### 对标 Claude Code
- Claude Code 会话数据**按需保留**：旧消息压缩为摘要（compaction），历史有界；不持久化每 token 事件（实时流与持久化分离）

### 最佳方案
1. **写入侧节流（治本）**：`message.part.updated` 每 token 写 → 30ms 合并批量写（降 90% 事件量），实时用 `part.delta`（不落库）——同时解决 DB 膨胀 + IO + 发热
2. **清理机制（治标）**：已投影到 message/part 的 durable 事件，定期删除旧 aggregate（保留最近 N 天）+ VACUUM；需确认 history/replay 依赖
3. **WAL checkpoint**：定期 checkpoint 回收 WAL

## [6] read/write 命令不能正常使用 — 已修复 ✅

### 根因
- read 工具用 `FSUtil.normalizePath`（Windows 下 `\`→`/` + realpath）作缓存 key
- write/edit 用**原始路径**（`\`）查 `hasRead`/`invalidate` → **key 不匹配**
- Windows 上 read 后 write 同文件被误判 "File has not been read" → write 被拒

### 修复（已提交 27ee45a）
- ReadCache 内部统一 key 归一化（`FSUtil.normalizePath`），read/write/edit 自动一致
- 新增回归测试：反斜杠/正斜杠路径共享同一 key；tsc 0 错、7 pass

---

## 优先级建议（按本机硬件投入产出）

1. **P0 已交付**：read/write 修复（[6]）
2. **P1（治本，双收益）**：事件写入节流（[5] 治本 + [1] 降 IO/发热）
3. **P1**：TUI 空闲降帧 + 轮询降频（[1] 直接降 CPU/发热）
4. **P2**：usage 持久化建立缓存命中率闭环（[3]）
5. **P2**：event 清理机制 + VACUUM（[5] 治标，需评估 history 依赖）
6. **P3（路线图）**：shiki 裁剪、prompt 幻觉防护强化（[2]）