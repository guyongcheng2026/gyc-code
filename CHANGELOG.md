# 更新日志

本项目遵循 [SemVer 2.0.0](https://semver.org/lang/zh-CN/)。

## [1.0.0] - 2026-11-07

首个正式版本。API 稳定，可对外承诺。

### 新增
- TUI 全模式 Vim 编辑：normal/visual(v/V)/operator-pending(dw/db/cw/cb)/字符查找(f/t/F/T)/数字前缀(3j)/yank-paste(yy/p)
- Effect v4 beta 内核 + 会话管理 + 技能系统（compose 模式）
- MCP 多服务器 + 多 provider（OpenAI/Anthropic/Google/xAI/NVIDIA 等），NVIDIA 免费模型优先排序
- 声明式插件生态：commands/skills/agents/MCP/hooks
- 性能基准脚本 `scripts/bench-cli.ts` + 验证脚本 `scripts/verify-cli.mjs`（`--version` 冷启动 <3.5s 达标线）
- 上游同步机制（`fork-upstream-sync` skill，`upstream-v*` tag 锚点）
- Ctrl+P 一键自动连接 provider
- Web UI（gyc-web）+ 账号计费
- 版本机制：SemVer MAJOR.MINOR.PATCH，`package.json` 为单一事实源，`GYCCODE_VERSION`/`GYCCODE_CHANNEL` 构建期注入

### 修复
- TUI 渲染稳定性：帧率去抖、生命周期闸门、句柄分账、事件错序
- 浅色主题反白、崩溃退出、可观测性丢失
- conditional-cache 路径不匹配致缓存失效 + 并发 body 独占
- CLI `/add-dir`、`gyc account` 命令路径断裂
- 命令注册表重生器不支持目录型命令
- 任务指令误判进画像层污染新会话
- composeVariant CRLF 致基线测试失败

### 变更
- 版本号 `0.0.1` → `1.0.0`（与实际成熟度对齐：776 commits、完整功能集、验证闭环就绪）
- `build.mjs` 补充 `GYCCODE_CHANNEL` 注入（env 读取，默认 `local`）

### 历史 tag（归档，不再使用阶段名命名）
- `v0.0.1` 初始原型
- `v1.0.0-phase8-completed` 阶段性里程碑
- `v1.18.21`、`v1.18.26` 对齐上游版本
- `upstream-v1.18.35`、`upstream-v1.19.3` 上游同步锚点
- `pre-full-replacement-baseline` 内核全替换前基线
