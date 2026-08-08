# gyc-code 工作流水（自动同步）

> 每次 `git commit` 后由 `.githooks/post-commit` 自动追加
> 仓库：本地 `C:\Users\谷勇成\gyc-cli` / 用户 `guyongcheng2026/gyc-code`（gh-proxy）

## 提交诰

- [OK] 2026-08-08 [18fe331] feat: 新增 compose primary agent + 内置 compose skills（Tab 可切到 compose）与提示注入
  - [FILES] 54: scripts/gen-compose-bundle.mjs, src/gyccode/agent/agent.ts, src/gyccode/effect/runtime-flags.ts, src/gyccode/session/prompt/compose.txt, src/gyccode/session/reminders.ts, src/gyccode/skill/compose/.bundle/ask/SKILL.md ...

- [OK] 2026-08-08 [40791ba] chore: 代码改动后自动同步 Obsidian 知识库(vault 工作流水)与 GitHub 推送钩子
  - [FILES] 3: .githooks/post-commit, AGENTS.md, scripts/worklog-sync.mjs

- [OK] 2026-08-08 [47f0344] 修复 provider 凭据保存假成功并更新 TUI 组件
  - [FILES] 43: src/core/plugin/command.ts, src/gyccode/cli/cmd/run/footer.command.tsx, src/gyccode/cli/cmd/run/footer.prompt.tsx, src/gyccode/cli/cmd/run/footer.view.tsx, src/gyccode/command/index.ts, src/gyccode/tool/invalid.ts ...
