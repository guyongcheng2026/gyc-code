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

- [OK] 2026-08-08 [73e30a1] perf: Bun --smol 启动参数 + SessionData dispose 释放 session 切换内存
  - [FILES] 3: bin/gyc, src/gyccode/cli/cmd/run/session-data.ts, src/gyccode/cli/cmd/run/stream.transport.ts

- [OK] 2026-08-08 [7022fb8] fix: Windows conhost 乱码——启动切换控制台输出代码页为 UTF-8（65001）
  - [FILES] 10: docs/GYCCODE-WORKLOG-2026-08-08.md, docs/compose/plans/2026-08-08-resource-optimization.md, src/codemode/tool-runtime.ts, src/core/database/database.ts, src/gyccode/index.ts, src/gyccode/tool/edit.ts ...

- [OK] 2026-08-08 [f5251f8] chore: phase 0 - remove 9 dead files (empty, stub, unused utils)
  - [FILES] 9: src/core/markdown.d.ts, src/core/util/array.ts, src/core/util/binary.ts, src/core/util/path.ts, src/core/util/retry.ts, src/gyccode/temporary.ts ...

- [OK] 2026-08-08 [43d9bef] feat: add shell security engine with 14 dangerous pattern classifications
  - [FILES] 2: src/gyccode/tool/shell.ts, src/gyccode/tool/shell/security.ts
