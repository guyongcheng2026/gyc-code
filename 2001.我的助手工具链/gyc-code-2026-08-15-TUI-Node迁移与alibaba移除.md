# gyc-code TUI Node 运行时迁移 + alibaba 提供商移除（2026-08-15）

## 背景
gyc TUI 内核"吃内存"：Bun 运行时单进程私有内存实测 **1.6GB**（系统内存仅 4GB，压力 90%）。此前已完成的 Node 运行时迁移（常驻省 40%：140MB vs 347MB）**未作用于 TUI**——`bin/gyc` 的"进程链扁平化"分支在 `tui`/`--mini`/`-i` 命令下强制 import `dist-bun`（Bun 目标），使 TUI 绕回 Bun 运行时。

## 诊断结论（全部实证）
1. **根因**：`bin/gyc` 为省 ~300MB 中间层内存，故意让 TUI 走 dist-bun（Bun）。Bun 常驻内存回收不稳定 → 1.6GB。
2. **关键推翻**：commit 4e66723 声称"OpenTUI 原生渲染仅支持 Bun（bun:ffi）"——但项目后来引入的 **koffi + @koromix/koffi-win32-x64 + win32-kernel.node.ts**（T1B 迁移）已解决 Node FFI。实测 **koffi 成功加载 opentui.dll**（symbols: cdecl,stdcall,fastcall,thiscall），**worker.js 在 worker_threads 下正常存活**——TUI 的 Node 兼容障碍已被先前迁移铺平。
3. **排除项**：TUI 侧 sync/data/history/stash 已有 LRU+上限；EventV2 全局 memoMap 单例只 build 一次；aisdk sdks Map 按模型有界；数据库仅 56MB 非元凶。

## 改动（4 个 commit）
1. **803e4a3** `perf: TUI 迁移 Node 运行时`：bin/gyc 删除 dist-bun 扁平化分支，tui/--mini/-i 统一走 node 目标 dist；build.mjs 移除 dist-bun 双构建，只构建 node 目标。
2. **a86344c** `chore: 移除 alibaba 提供商`：gen-models-snapshot 白名单删 alibaba/alibaba-cn，快照重生成（32→30 供应商 / 1427→1287 模型 / 814→722KB）；sync-models.mjs 加 DENYLIST 防回归；models-mirror/api.json 删 6 个 alibaba 键（含 4 个套餐型：token-plan×2、coding-plan×2）。
3. **8ea10f1** `chore: 清理 transform.ts`：删 alibaba cacheControl 块 + alibaba-cn enable_thinking 块；**保留通用 qwen 判断**（90+ 提供商含 qwen 模型，与 alibaba 无关）。
4. **7a2339a** `chore: 移除 @ai-sdk/alibaba external`：源码零引用（alibaba 走 openai-compatible），从 build.mjs + verify-external.mjs 清理。

## 验证结果
- **bun run test**：463 pass / 0 fail
- **node tsc --noEmit**：0 错误
- **bun run build**：成功，dist RUNTIME=node，dist-bun 已删除
- **node dist/index.js --help**：正常
- **node bin/gyc --help / bun bin/gyc --help**：均正常（Node 子进程接管）

## 部署状态
全局 gyc-code 是 **bun link Junction 指向项目目录** → 改动已直接作用于全局。当前 TUI 实例（PID 9008）仍是 Bun 旧进程（PrivateMB 已 1896MB），**重启后生效**（本会话无法自重启——会杀死自身进程树，属破坏性操作，留待用户退出后重开）。

## 归纳/经验
- **编译产物注释会"说谎"**：build.mjs / bin/gyc 的"OpenTUI 仅支持 Bun"注释是早期迁移中间状态的过时判断，被后来的 koffi 迁移推翻但注释未更新。改架构前应**实证验证**（加载 DLL、跑 worker）而非信注释。
- **koffi 是 Bun→Node 的关键桥**：`bun:ffi` → `koffi` 双实现模式（`*.bun.ts`/`*.node.ts` + 条件导出）可推广到其他 Bun 原生依赖。
- **生成文件走脚本**：models-dev-snapshot.ts（814KB 单行 JSON）是自动生成，改数据应从白名单脚本 + 源数据层面处理，勿手改。

## 待办/后续
- 重启 TUI 后验证内存收益（预期 1.6GB → 600-900MB）
- models-mirror/api.json 本地已删 alibaba，但它是 gitignore 的（不进 git），重新 `bun scripts/sync-models.mjs` 时 DENYLIST 会保持删除
- 可进一步：models-dev 惰性加载（无限 TTL 常驻）、TUI markdown 流式解析缓存（渲染 CPU 热点）
