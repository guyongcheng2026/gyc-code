---
feature: opencode-kernel-1.18.32
status: delivered
specs:
  - docs/compose/specs/2026-09-27-opencode-kernel-1.18.32-design.md
plans:
  - docs/compose/plans/2026-09-27-opencode-kernel-1.18.32.md
branch: main
commits: 未提交（改动位于工作区，待谷总确认后提交）
---

# opencode 内核升级至 v1.18.32 — 最终报告

## What Was Built

gyc-code 承继的 opencode 内核已从 **v1.18.26 全量对齐到 v1.18.32**（上游仓库 `anomalyco/opencode`，2026-09-21 发布）。本次改动覆盖内核映射目录 `src/{core,tui,llm,schema,protocol,codemode,server}` 与 `src/cli`、`src/gyccode` 对应位置，共 **32 个文件、+303 / −113 行**，全部为上游 hunk 的逐文件移植，本地化成果（去品牌、`GYCCODE_*` 开关、中文文案与注释、Node/Bun 双实现）完整保留。

升级带来四类实质变化：**ACP 会话恢复语义重构**（持久化 model/variant/mode 优先于历史推断，并新增 `config_option_update` 回推）、**模型能力与路由修正**（Bedrock ARN 直通与 `deepseek.r1` 前缀收窄、GPT 版本按 major/minor 过滤、GitLab provider 分级推理）、**健壮性修复**（SSE 取消失效不再吞异常、远程配置登录页错误可读化、错误路径退出码为 1）、**依赖对齐**（6 个 `@ai-sdk/*` / `gitlab-ai-provider` 版本随上游 bump）。

验证结果：`bunx tsc --noEmit` 零错误；`bun run test` **1025 pass / 0 fail / 9 skip（140 文件）**；`bun run dev --version` 冒烟正常。

## Architecture

内核以 vendored 源码形式承继，升级按「上游路径 → gyc 路径」映射逐文件移植：

| 上游 | gyc |
|---|---|
| `packages/core/src/**` | `src/core/**` |
| `packages/tui/src/**` | `src/tui/**` |
| `packages/opencode/src/{acp,provider,plugin,session,server}/**` | `src/gyccode/**` |
| `packages/opencode/src/cli/cmd/tui.ts` | `src/cli/cmd/tui.ts` |

关键落点：

- `src/gyccode/acp/service.ts`：新增 `restoreSession` / `restoreDurableModel` / `restoreModel` / `restoreVariant` / `restoreMode` / `hasModel` / `hasMode` / `sameModel` / `hasVariant` / `selectModelVariant` / `sendConfigOptionUpdate`；`loadSession`、`resumeSession`、`forkSession` 三个入口统一改为「先取 backing session，再合成恢复状态」。
- `src/gyccode/provider/provider.ts`：Bedrock `getModel` 对 `arn:` 前缀直通；`DEFAULT_HEADER_TIMEOUT_MS` / `DEFAULT_CHUNK_TIMEOUT_MS` 由 60s/120s 对齐为 **300_000**。
- `src/gyccode/provider/transform.variants.ts`：`reasoningEffort` 的 `gitlab-ai-provider` 分支按 `model.family` 返回 `reasoningEffort` / adaptive thinking。
- `src/gyccode/session/system.ts` + 新增 `src/gyccode/session/prompt/gpt-astra.txt`：`gpt-6` 走 ASTRA 提示词（品牌替换为 GycCode，无 BOM）。
- `src/core/aisdk.ts`、`src/core/npm.ts`、`src/core/filesystem/search.ts`、`src/core/plugin/provider/amazon-bedrock.ts`、`src/core/v1/config/provider.ts`：核心层修复与 schema 解耦。
- `src/tui/util/error.ts`：新增 `ConfigRemoteAuthError` 可读化（中文文案，与 `src/cli/error.ts` 同款）。

### Design Decisions

- **逐文件移植而非整目录覆盖**：gyc 内核已被深度改造（品牌、Node 运行时、文件拆分如 `transform.*.ts`），覆盖会丢本地化。实测仅 2 个文件与上游 1.18.26 逐字节一致，可整文件替换；其余逐个 hunk 手工合入。
- **测试仅源码**：gyc 从未 vendor 上游测试（`src` 下无 `test` 目录，测试与源码同目录），因此上游 15 个新测试文件不入库，验证依赖 gyc 既有 1025 个用例 + tsc。
- **不引入上游 SDK 补丁**：上游 1.18.32 新增 `@ai-sdk/openai@3.0.88.patch`（去除 serviceTier 能力校验），gyc 无 `patches/` 机制，且自研 `src/llm` 直构请求、vendored copilot 语言模型自带该逻辑，故不引入并登记为已知差异。
- **超时默认值改为对齐上游 300s**：谷总决策，取代本地 60s/120s 的有意调优。
- **TUI 排版统一**：上游把用户可见串的 `...` 改为 `…`；gyc 对应串已本地化为中文，同步把中文串的 `...` 改为 `…`；上游未触及的 gyc 自有文件（`dialog-history.tsx`、`dialog-memory.tsx`、`dialog-upgrade.tsx`）保持原样。

## Usage

无新增用户命令或配置项。可感知变化：

- ACP 客户端（如编辑器集成）恢复会话时，模型/变体/模式以**服务端持久化值**为准，历史消息仅作兜底；切换模型会主动回推 `config_option_update`。
- Bedrock 的 ARN 模型标识与 `us.deepseek.r1` 类 ID 不再被重复加区域前缀。
- 远程配置返回登录页（SSO 代理）时，CLI/TUI 会给出中文可读提示并提示 `gyccode auth login <url>`。
- 报错退出码为 1（原先可能为 0）。
- 默认请求超时放宽至 5 分钟（header/chunk）。

## Verification

| 项 | 命令 | 结果 |
|---|---|---|
| 类型检查 | `bunx tsc --noEmit` | 零错误（EXIT=0） |
| 全量测试 | `bun run test` | 1025 pass / 0 fail / 9 skip（140 文件，36.86s） |
| 冒烟 | `bun run dev --version` | `0.0.1`，无崩溃 |
| 上游锚点 | `git -C <upstream> rev-parse v1.18.26 v1.18.32` | `774cc7c191…` / `545f51d26c…` |

已知差异（不移植，须长期跟踪）：上游 `anthropicBlockBinding`（`blockBinding` + thinking-binding-controls，依赖 SDK 补丁）、上游 SDK 补丁、上游测试文件、`@ai-sdk/togetherai` bump。

## Journey Log

- [lesson] gyc 的 `provider/transform.ts` 已拆分为 `transform.{variants,message,shared}.ts`，上游同名文件的 hunk 必须按符号定位到拆分后的文件，不能按文件名直搬。
- [lesson] 比对本地与上游基线时必须先归一化 EOL/BOM，否则会得出「本地大改」的假偏差（实测 CRLF 差异曾把 6 行改动放大为 6+/6−）。
- [pivot] 上游对 TUI 只做 `...` → `…` 的排版修订，gyc 这些串已本地化为中文，故改为对中文串做对应排版调整，不做字符串级直搬。
- [lesson] 直连 github.com 克隆上游会超时，须走 gh-proxy（`https://gh-proxy.com/https://github.com/...`）。
- [lesson] `bun run dev --version` 的 stderr 会被 PowerShell 当成 NativeCommandError 着色，但退出码与输出正常，勿误判为失败。

## Source Materials

| File | Role | Notes |
|------|------|-------|
| `docs/compose/specs/2026-09-27-opencode-kernel-1.18.32-design.md` | 设计（已批准） | 范围、路线、冲突裁决规则 |
| `docs/compose/plans/2026-09-27-opencode-kernel-1.18.32.md` | 实施计划 | 11 个任务，含精确 hunk 与验证命令 |
