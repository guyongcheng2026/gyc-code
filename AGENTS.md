# gyc-code

自研编码智能体 CLI（Bun + TypeScript + effect v4 beta + OpenTUI）。仓库在 `D:\00MyAI\gyc-code`（不是 C:\gyc-code）；主开发环境 Windows / PowerShell 5.1。

## 铁律（永久，优先于默认行为）

- **称呼**：所有「用户」表述一律写作「谷总」，禁止“用户”一词。适用于对话回复、提交信息、代码注释、文档、计划、报告、子代理提示词（2026-09-12 起永久生效）。
- **界面、会话窗口、回复、日志、提示、错误信息等显示内容一律简体中文**（TUI/CLI 主界面）。代码标识符、命令名、路径除外——不随输入语言或 OS 语言变化。
- **任务收尾 4 步**（任何子任务结束、会话结束、commit 前自检，缺失即视为任务未完成）：① 总结（3-5 句：做了什么/结果/留下什么文件）② 归纳（可复用规律、踩坑、被验证或推翻的假设）③ 学习（沉淀到 docs/记忆/相关 SKILL）④ 进化（可改进的流程/配置/规则立即落地，否则记待办）。
- **编码**：新写/落盘文件一律 UTF-8 无 BOM；编辑既有文件保留其原 BOM；GBK 存量文件读取侧按 GB18030 兼容。pre-commit 跑 `scripts/check-mojibake.mjs --staged` 拦截 GBK 双重编码乱码，勿绕过。

## 命令

- 开发（源码直跑，改完即见效）：`bun run dev`
- 类型检查：`bunx tsc --noEmit`（根 tsconfig，**排除 src/webapp**；webapp 单独 `cd src/webapp && bun run typecheck`）
- 测试：`bun run test`（= `bun test --preload ./scripts/bun-solid-preload.ts --path-ignore-patterns=src/webapp`）
  - 单文件：`bun test src/路径/xx.test.ts --preload ./scripts/bun-solid-preload.ts`（preload 提供 Solid/JSX 变换，统一带上）
  - webapp 是另一套：`bun run test:web`（vitest + jsdom）。`bun test` 经 bunfig.toml 自动排除 src/webapp，直接扫会误报。
- 构建：`bun run build`（= `bun build.mjs`；`GYCCODE_SKIP_WEBAPP=1` 跳过 webapp 预构建）
- **标准验证顺序**：`bunx tsc --noEmit` → `bun run test`；对外发布再 `bun run build`。当前基线：0 类型错误、981 pass / 0 fail。
- 无 lint 脚本、无 CI workflow（`.github/` 不存在）。prettier/knip 在 devDependencies 但未挂脚本，勿臆造 lint 命令。

## 启动器与 dist 陷阱（必读）

`bin/gyc` **只要 `dist/index.js` 存在就优先跑它，不走源码**。只改 `src/` 后直接运行 `gyc` 会命中旧产物——“改了没生效”九成是这个（2026-09-24 实证：TUI 文案英文化在源码已生效、dist 是 8 天前的旧构建）。

- 要立即看源码改动：`bun run dev`；要让 `gyc` 生效：先 `bun run build` 再启动
- 全局 npm `gyc` 是指向本仓库的 Junction，同一份 dist，同样要重建
- 无 dist 时启动器自动回退 Bun 跑 TS 源码（仅开发场景）

## 构建须知（build.mjs）

- 构建前自动再生：compose 技能 bundle（`.bundle/` → bundle.gen.ts）+ webapp 清单（→ opencode-web-ui.gen.ts）
- **splitting 默认必须关闭**（`GYCCODE_BUILD_SPLITTING=1` 才开）：开启改变模块初始化顺序，曾致 LayerNode 循环引用解析崩溃、dist 下 CLI/TUI 全链路瘫痪（dev 源码模式正常，仅 dist 复现）
- 产物布局固定 `dist/index.js` + `dist/worker.js`：bin/gyc、install.sh、多个脚本均按此定位，勿改入口命名
- 可用内存 <1.2GB 时 Bun 打包器可能 OOM panic（exit 3/9），build.mjs 父进程会自动以低内存模式重试一次；`GYCCODE_BUILD_LOW_MEM=1` 强制

## 生成物（勿手改）

| 文件 | 生成方式 |
|---|---|
| `src/gyccode/skill/compose/bundle.gen.ts` | `node scripts/gen-compose-bundle.mjs`（build 自动跑）；源在 `.bundle/`，改技能改 `.bundle` 再重生 |
| `src/gyccode/server/generated/opencode-web-ui.gen.ts` | `scripts/build-webapp.mjs`（build 自动跑），勿手改 |
| `src/gyccode/command-registry.ts` | `bun run scripts/generate-command-registry.ts`；**新增/删除 `src/cli/cmd/*.ts` 命令后必须重生**，否则 `gyc --help` 与命令注册表不同步 |

注：`src/gyccode/cli-integration.test.ts` 会 spawn 真实 CLI（`GYCCODE_PURE=1`），断言需兼容中英文 locale（yargs 依 `LANG` 输出「命令：」或 `Commands:`，勿硬编码单语）。

## 架构速览

- **Bun workspaces**（根 package.json `workspaces`）：`src/{cli,codemode,core,effect-drizzle-sqlite,llm,protocol,schema,tui,ui,webapp}` 各是 `@gyccode/*` 包；`src/gyccode/` 是主包（CLI 入口 + session/provider/skill/memory/server），**不是** workspace 成员。
- **入口链**：`bin/gyc`（Node 启动器，优先 dist）→ `src/gyccode/index.ts`（yargs 主入口，命令惰性注册）→ TUI 走 `src/cli/cmd/tui.ts` + `src/tui/`；worker 在 `src/cli/tui/worker.ts`。
- **承继内核**：`src/{core,tui,llm,schema,protocol,codemode}` 来自 opencode 1.18（MIT，LICENSE）；自研层 `src/gyccode/` + 贡献者新增（LICENSE-gyc）。改内核目录时先读就近 `AGENTS.md`。
- **就近 AGENTS.md（先读再改）**：`src/core/tool/`（工具注册/权限/输出边界）、`src/gyccode/session/llm/`（AI SDK vs native 运行时选择，`GYCCODE_EXPERIMENTAL_NATIVE_LLM` 门控）、`src/gyccode/server/routes/instance/httpapi/`（Effect HttpApi 路由模式，禁 handler 内 `Effect.provide`）。
- **依赖豁免（勿“修复”）**：`effect 4.0.0-beta.83`、`drizzle-orm 1.0.0-rc.2` 是深耦合豁免项，版本已全量精确锁定（无 ^/~）；新增代码禁用 v4-only 不稳定 API（新 Schema API 先 REPL 验证）；不要尝试降级/升级这两个包。
- **运行时开关走环境变量**（`GYCCODE_*`），build.mjs 的 define 只注入版本号与构建目标——不要把行为开关固化进构建。

## 工作流同步约定

1. **提交即推送**：`.git/hooks/post-commit` 自动 `git push origin HEAD`，然后跑 `scripts/worklog-sync.mjs` 写 Obsidian 工作流水（`E:\谷勇成的知识库\2001.我的助手工具链\gyc-code-工作流水.md`）。无需手动 push；push / worklog 任一步失败均追加错误到 `.git/worklog-sync.log`，不阻塞提交（用 `git status` 的 `[ahead N]` 交叉核对是否漏推）。
2. **pre-commit 乱码防线**：`scripts/check-mojibake.mjs --staged` 检出 GBK 双重编码即拒绝提交（gen 产物与 `bundle.gen.ts` 豁免）。
3. **直连 github.com 超时的 gh-proxy 两步走（fetch / push 均适用）**：
   - 拉取：`git fetch https://gh-proxy.com/https://github.com/guyongcheng2026/gyc-code.git main:refs/remotes/origin/main` 后 `git merge --ff-only origin`（带镜像 URL 直接 pull 会报 Cannot fast-forward to multiple branches）。
   - 推送：gh-proxy 只读免鉴权、**推须转发 github.com 凭据**——用 `git credential fill`（host=github.com）取凭据，经 `GIT_ASKPASS` 临时脚本提供（口令只进环境变量，不落盘不回显），加 `-c credential.helper=` 清空默认辅助器，向 `https://gh-proxy.com/https://github.com/guyongcheng2026/gyc-code.git` 执行 `push HEAD:main`（2026-09-24 实测通过；gh-proxy 单纯转发 Authorization，github.com 的 PAT 可直接用于该通道）。
   - 推完按上一行 fetch 同步 `origin/main` 追踪引用，`git status` 应无 `[ahead]`。
4. 钩子脚本从仓库根执行（`node scripts/worklog-sync.mjs`）；脚本里中文路径一律 `\uXXXX` 转义保持 ASCII。
5. 人工写详细工作记录笔记也放 Obsidian 同目录（文件名前缀 `gyc-code-`），并提交推送 vault。

## 行数口径

`bun scripts/linescan.mjs` 复测（代码包总量 = src 下 TS/TSX；人工维护核心 = 总量 − gen − 测试）。宣传口径用“约 18 万行人工维护核心代码”。
