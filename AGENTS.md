# gyc-code

自研编码智能体 CLI（Bun + TypeScript + effect v4 beta + OpenTUI）。仓库在 `D:\00MyAI\gyc-code`（不是 C:\gyc-code）；主开发环境 Windows / PowerShell 5.1。

## 铁律（永久，优先于默认行为）

- **称呼**：所有「用户」表述一律写作「谷总」，禁止“用户”一词。适用于对话回复、提交信息、代码注释、文档、计划、报告、子代理提示词。
- **界面、会话窗口、回复、日志、提示、错误信息等显示内容一律简体中文**（TUI/CLI 主界面）。代码标识符、命令名、路径除外。
- **任务收尾 4 步**（子任务/会话结束、commit 前自检，缺失即未完成）：① 总结 ② 归纳 ③ 学习（沉淀 docs/记忆/SKILL）④ 进化（可改进项立即落地或记待办）。
- **编码**：新文件 UTF-8 无 BOM；既有文件保留原 BOM；GBK 存量按 GB18030 兼容读。pre-commit 跑 `scripts/check-mojibake.mjs --staged` 拦乱码，勿绕过。

## 命令

- 开发（源码直跑）：`bun run dev`；类型检查：`bunx tsc --noEmit`（排除 src/webapp；webapp 单独 `cd src/webapp && bun run typecheck`）
- 测试：`bun run test`（= `bun test --preload ./scripts/bun-solid-preload.ts --path-ignore-patterns=src/webapp`）；单文件同命令带路径。webapp 是 vitest：`bun run test:web`
- 构建：`bun run build`（= `bun build.mjs`；`GYCCODE_SKIP_WEBAPP=1` 跳过 webapp 预构建）
- **标准验证顺序**：`bunx tsc --noEmit` → `bun run test`；对外发布再 `bun run build`。无 lint 脚本、无 CI（勿臆造）。

## 启动器与 dist 陷阱（必读）

`bin/gyc` **只要 `dist/index.js` 存在就优先跑它，不走源码**——只改 `src/` 后直接 `gyc` 会命中旧产物（“改了没生效”九成是这个）。要看源码改动用 `bun run dev`；要让 `gyc` 生效先 `bun run build`。全局 npm `gyc` 是本仓库 Junction，同一份 dist。构建细节见 `docs/AGENTS-REFERENCES.md`。

## 生成物（勿手改）

- `src/gyccode/skill/compose/bundle.gen.ts` ← `node scripts/gen-compose-bundle.mjs`（build 自动跑）；源在 `.bundle/`
- `src/gyccode/server/generated/gyc-web-ui.gen.ts` ← `scripts/build-webapp.mjs`
- `src/gyccode/command-registry.ts` ← `bun run scripts/generate-command-registry.ts`；**增删 `src/cli/cmd/*.ts` 后必须重生**
- `cli-integration.test.ts` spawn 真实 CLI（`GYCCODE_PURE=1`），yargs 输出兼容中英文 locale，勿硬编码单语

## 架构速览

- Bun workspaces：`src/{cli,codemode,core,effect-drizzle-sqlite,llm,protocol,schema,tui,ui,webapp}`；`src/gyccode/` 是主包（非 workspace 成员）
- 入口链：`bin/gyc` → `src/gyccode/index.ts`（yargs 惰性注册）→ TUI `src/cli/cmd/tui.ts` + `src/tui/`；worker `src/cli/tui/worker.ts`
- 承继内核 `src/{core,tui,llm,schema,protocol,codemode}` 来自 opencode 1.18.32（MIT）；自研层 `src/gyccode/`。改内核前先读就近 `AGENTS.md`（`src/core/tool/`、`src/gyccode/session/llm/`、`src/gyccode/server/routes/instance/httpapi/`）
- 依赖豁免勿“修复”：`effect 4.0.0-beta.83`、`drizzle-orm 1.0.0-rc.2` 版本全锁定；禁 v4-only 不稳定 API；勿升降级
- 运行时开关走 `GYCCODE_*` 环境变量，不要把行为开关固化进构建 define

## 工作流同步约定

1. **提交即推送**：`.git/hooks/post-commit` 自动 push + `scripts/worklog-sync.mjs` 写 Obsidian（`D:\我的知识库\2001.我的助手工具链\gyc-code-工作流水.md`，vault 远程 gitee `wwkceldn/gu-yongchengs-knowledge-base`）。失败记 `.git/worklog-sync.log` 不阻塞（`git status` 的 `[ahead N]` 交叉核对）。
2. **pre-commit 乱码防线**：`check-mojibake.mjs --staged` 拒 GBK 双重编码（gen 产物豁免）。
3. 直连 github 超时走 gh-proxy 两步（fetch/push）：详见 `docs/AGENTS-REFERENCES.md`。
4. 钩子脚本从仓库根执行（`node scripts/worklog-sync.mjs`）；脚本内中文路径用 `\uXXXX` 转义。
5. 人工工作记录笔记放 Obsidian 同目录（前缀 `gyc-code-`），提交推送 vault。

## 操作手册同步（对外可见功能面）

- 手册交付件：`docs/gyccode操作手册.docx`（GB/T 9704 公文版式，78 页 21 章 102 表）。正文与排版分离：正文在 `scripts/manual_content_1.py`～`_7.py`，版式在 `scripts/manual_docx_style.py`，入口 `scripts/gen_manual_docx.py`。
- **凡改动下列功能面，必须同步更新手册正文并重新生成**：命令与选项（`src/cli/cmd/`、`command-registry.ts`）、内置工具与启用规则（`src/gyccode/tool/`）、快捷键（`src/tui/config/`）、配置项（`src/gyccode/config/`、`src/core/v1/config/`）、权限规则（`src/gyccode/permission/`）、Agent/Skill/MCP。
- 重新生成：`python scripts/gen_manual_docx.py`（需 python-docx）。改版式只动 `manual_docx_style.py`，改内容只动 `manual_content_*.py`。
- 漏同步由 `scripts/sync-manual.mjs` 兜底：post-commit 比较「功能面最近提交」与「手册源最近提交」，落后则在 `.git/manual-sync.log` 留一行并提示，fail-soft 不阻塞提交。
- 事实基准：手册以**源码 + `gyc --help` 实测**为准，与 `README.md` 冲突时以手册为准（已知差异列于手册第十四章）。
