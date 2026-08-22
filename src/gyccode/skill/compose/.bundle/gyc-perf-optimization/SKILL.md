---
name: gyc-perf-optimization
description: Use when gyc CLI 卡顿、CPU 持续高占用、内存虚高波动、温度过高或风扇噪音大；或需要诊断 TUI/会话性能热点并做无损优化
---

# gyc-cli 性能优化

## Overview

gyc 的性能热点几乎总在**流式渲染、帧循环、后台轮询、缺少缓存**四处。优化原则：**先测量定位、再无损优化、后验证对比**——绝不牺牲功能质量换取速度。

## 诊断（先测量，勿猜）

1. **进程实测**：`Get-Process -Id <pid>` 采样 CPU 增量与 WorkingSet，观察波动（GC 前后差大 = 高频分配）
2. **日志分析**：`gyccode.log`（`~/.local/share/gyccode/log`）统计高频 message、确认后台任务
3. **代码热点定位**：
   - 流式输出：`sync.tsx` 是否每 token 直接 append 导致 markdown streaming 对全文 tree-sitter WASM 重解析重高亮（O(n²)）
   - 帧循环：`app.tsx` targetFps、`bg-pulse.tsx` 动画渲染
   - 轮询：`setInterval` 高频检查（terminal-win32、autocomplete）
   - 缓存缺失：每次循环重复检索/转换

## 优化模式（全部无损）

### 1. 流式 O(n²) 节流
- `sync.tsx` 的 message.part.delta 用 **30ms 合并队列**（按 messageID:partID:field 累积，batch 批量写 store），渲染频率降一个数量级

### 2. 帧率与动画
- 渲染器 targetFps 60 降到 30（动画足够，CPU 减半）
- 动画组件（如 BgPulse）降帧并联动 animations_enabled 开关，关闭时零渲染
- 默认关闭动画/音效（animations_enabled 默认 false、attention sound 默认 false），用户可菜单开启

### 3. 轮询降频
- setInterval 100ms 改 1000ms、50ms 改 200ms（保持功能，开销降 80%）

### 4. 缓存
- 同 query 的重复计算（如记忆检索）加短 TTL LRU 缓存（30s）
- 确认既有缓存生效（provider getLanguage 按 model 缓存 SDK）

### 5. 日志轮转
- fileLogger 无限制会无限增长：加 10MB 上限 + 顺序写入（fs/promises appendFile 队列），运行中轮转

## 验证

- node tsc 0 错误
- bun run test 全绿
- bun run build 成功；冷启动计时低于 3.5s 达标
- 进程 CPU/内存采样对比（注意：无 TTY 后台跑 TUI 时 CPU 异常，需真实终端观察）

## Common Mistakes

- 无测量就改代码（先采样再动手）
- 过度优化低频路径（每轮一次的操作收益小，按 Simplicity 跳过）
- 依赖类型"裁减"想当然（如 tree-sitter wasm 是远程 URL 时不在 dist，前提不成立）
- 忘 touch 文件导致 bun tsc 用旧 mtime 缓存报假错
