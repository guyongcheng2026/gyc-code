@echo off
setlocal
cd /d "c:\Users\谷勇成\gyc-cli"
git add -A > commit.log 2>&1
git commit -m "修复: TUI文本选择复制flag条件反转 + CLI界面codex化 + 默认LLM统一 + P2收尾批次" -m "- TUI: app.tsx 选择复制键处理 flag 条件写反(默认恒return),恢复拖选后Ctrl+C复制/Esc清除
- CLI: 界面codex化(去?前缀/用户消息回显/轮次头dim/工具图标圈字母体系)
- CLI: 斜杠菜单与TUI严格一致(fuzzysort过滤+滚动窗口修复所选所见错位+Tab/Esc行为对齐+Ctrl+P面板)
- 默认LLM: 三端统一 opencode/deepseek-v4-flash-free(修正三段式错误配置+Zen key接入,catalog兜底)
- 修复: cron.ts Schema.Union可变参数崩溃(改数组形式),恢复CLI models/debug config
- web: 摘要/压缩必填模型参数(v1 summarize);vitest正确跑法固化;bunfig排除webapp误扫
- P2: /vim完整键绑定层(NORMAL/INSERT双模式)+9个辅助命令(add-dir/env/output-style/keybindings/security-review/ultraplan/bughunter/insights/advisor)+sidebar迁移DialogContextInfo" >> commit.log 2>&1
echo COMMIT_EXIT=%ERRORLEVEL% >> commit.log
