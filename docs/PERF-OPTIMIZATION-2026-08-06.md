# gyc-code 性能优化与启动修复工作记录

日期：2026-08-06
分支：main
GitHub：github.com/guyongcheng2026/gyc-code

## 一、问题背景

谷总要求全面排查 gyc-code（fork 自 opencode 的编码 CLI）性能问题，并解决 `gyc` 命令无法启动的问题。

## 二、启动问题修复（P0）

### 症状
1. PowerShell 运行 `gyc` 报 `ENOENT: uv_spawn 'sqlite3'`
2. `gyc --help` 无输出

### 根因
1. **db 命令占用 `$0` 默认位**：入口注册 `lazy("$0 [query]", ...)` 让 db 命令成为默认命令，无参数 `gyc` 触发 db 命令 → `spawn("sqlite3")` → 系统未装 sqlite3 CLI → ENOENT
2. **yargs 懒加载不兼容**：lazy() 的 async builder 不被 yargs 等待，`parse()` 静默失败 → --help 无输出

### 修复
1. `db [query]` 改为显式命令，`$0` 留给 TUI（`opencode [project]` 默认）
2. 入口恢复**同步 import**（与 opencode 原版一致），命令模块 handler 内保留 Effect.promise 懒加载重型模块

### 验证
- `gyc --help` → 完整命令列表 + logo ✅
- `gyc run --model deepseek/deepseek-chat "hi"` → `Hello! How can I help you today?` ✅
- Benchmark 20/20 保持 ✅

## 三、性能优化（P0/P1）

### 实测基线
| 指标 | 优化前 | 优化后 |
|------|--------|--------|
| 冷启动 --help（源码） | 8.9s | 4.0s（懒加载尝试）|
| 冷启动 --help（dist） | — | **3.5s** |
| run "hi" 全链路 | 77s | 41.7s（缓存热）|

### 关键动作
1. **bin/opencode 启动器改为优先 dist 产物**（存在则直接 `bun dist/index.js`，否则源码 `bun run --conditions=browser`）
2. 冷启动提速 61%（8.9s → 3.5s）

### run 链路分析（41-77s 构成）
- bootstrapping/instance 创建：~5.5s
- session 初始化（工具 init count=86）：~5.3s
- project copy refresh：~7.2s（最大单项，git worktree 对比）
- LLM 流本身：~5.2s（DeepSeek API 直连仅 1.4s，链路开销可接受）
- 结论：瓶颈是 opencode 架构固有初始化，深入优化需改 core 层，风险高、收益边际

## 四、验证命令

```bash
# 构建 dist
bun build src/opencode/index.ts --outdir dist --target=bun --format=esm --splitting --external "@opentui/core-*"

# 运行源码
bun run --conditions=browser src/opencode/index.ts --help

# Benchmark
bun test --timeout 60000 src/opencode/benchmark/benchmark.test.ts

# 全局命令
node bin/opencode --help
```

## 五、提交记录

- `1c50353` feat: auto-load API keys from ~/.codex/.env and project .env
- `78435da` fix: restore CLI startup (db $0 conflict, help output); launcher prefers dist bundle

## 六、后续建议（P2）

1. 跳过 project copy refresh（省 ~7.2s）——需评估对 MCP 文件访问的影响
2. 精简 bootstrapping 阶段非必需服务
3. 评估 run 的非 TUI 轻量路径（纯对话场景）

详见技能：gyc-code-ops
