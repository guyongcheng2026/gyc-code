# AGENTS.md 长尾参考（低频但必读场景）

> 由 `AGENTS.md` 外移，保持主文件短小。改 build/推不动/查行数时按需读取本文件。

## 构建须知（build.mjs）

- 构建前自动再生：compose 技能 bundle（`.bundle/` → bundle.gen.ts）+ webapp 清单（→ opencode-web-ui.gen.ts）
- **splitting 默认必须关闭**（`GYCCODE_BUILD_SPLITTING=1` 才开）：开启改变模块初始化顺序，曾致 LayerNode 循环引用解析崩溃、dist 下 CLI/TUI 全链路瘫痪（dev 源码模式正常，仅 dist 复现）
- 产物布局固定 `dist/index.js` + `dist/worker.js`：bin/gyc、install.sh、多个脚本均按此定位，勿改入口命名
- 可用内存 <1.2GB 时 Bun 打包器可能 OOM panic（exit 3/9），build.mjs 父进程会自动以低内存模式重试一次；`GYCCODE_BUILD_LOW_MEM=1` 强制

## 直连 github.com 超时的代理两步走（fetch / push 均适用）

本机 `NO_PROXY` 含 `github.com,*.github.com`，curl 直连 api.github.com 会被出口策略拒（**403 而非超时**）——这是网络环境问题，**不要据此判定凭据失效**。git 走代理通道时认证头转发正常。

**两个代理的实测可用性（2026-10-02）**：`ghfast.top` fetch/push 均通；`gh-proxy.com` fetch 通但 push 报 `No anonymous write access`。**优先用 `ghfast.top`**（即本机 `GH_PROXY` 环境变量指向的那个），`gh-proxy.com` 仅作 fetch 备选。

- 拉取：`git fetch https://ghfast.top/https://github.com/guyongcheng2026/gyc-code.git main:refs/remotes/origin/main` 后 `git merge --ff-only origin`（带镜像 URL 直接 pull 会报 Cannot fast-forward to multiple branches）。
- 推送：**凭据 URL 内嵌是最省事且实测可用的一条**——`git credential fill`（host=github.com）取出 user/token，各自 `EscapeDataString` 后拼进代理 URL，加 `-c credential.helper=` 清空默认辅助器（2026-10-02 实测 `284f704..a20f0b1` 一次成功）。口令只在本条命令的进程内出现，不落盘；回显前务必过滤。
- **不要用 `GIT_ASKPASS` 或 `http.extraHeader`**：这两种方式对代理形态的嵌套 URL 不生效，git 不会触发询问而直接以匿名身份发请求（表现为 `No anonymous write access`）。
- **每次 shell 调用是独立进程**，`$env:X` 不跨调用；设了凭据环境变量必须在**同一条命令内**用掉。
- 推完按 fetch 那行同步 `origin/main`，`git status` 应无 `[ahead]`；再用 `git ls-remote <代理URL> refs/heads/main` 独立复核远端哈希（不依赖本地追踪引用）。

## 行数口径

`bun scripts/linescan.mjs` 复测（代码包总量 = src 下 TS/TSX；人工维护核心 = 总量 − gen − 测试）。宣传口径用"约 18 万行人工维护核心代码"。

## 工具可见性三层机制（勿再叠加第四层）

按权威级排序，改动工具可见性时只动已有层：

1. **permission ruleset**（权威层，`agent.permission` + session 规则）——同时决定 tool schema 可见（`Permission.disabled`：整工具 `*:deny` 会从每轮请求裁掉）与运行时执行。agent 级裁剪先例：plan（`plan-tools.ts` 14 项）、explore（`agent.ts` 白名单）。
2. **user.tools**（config 层，`{tool: false}`）——仅关 schema，不影响 permission 执行面。
3. **experimental.primary_tools**（subagent 通道）——spawn 子代理时的白名单快捷方式，经 `subagent-permissions.ts` 合成 deny。

**约束**：不得新增并行的第四套可见性机制（历史评估 2026-09-24：三套已够用且职责清晰，profile 类配置若引入必须编译降级为第 1 层 ruleset）。已知风险观察项：explore 白名单含 `bash`（只读语义的执行面残留，探索类只读命令有价值，暂不裁，见真实滥用再议）。

## opentui 原生句柄硬上限 65,535（TUI 崩溃第一现场）

opentui 0.5.6 原生句柄表上限 65,535（实测第 65,535 次 `createTextBuffer` 返回无效句柄 → 「打开会话即退出」）。单 `<text>` ≈ 3 句柄，带边框 `<box>` 再 +1。

- 消息条数由 `src/tui/routes/session/virtual-window.ts` 管（`VIRTUAL_WINDOW=40` / `VIRTUAL_MAX_WINDOW=600` / `VIRTUAL_COLLAPSED_SUMMARY_LIMIT=500`）；**单条内容的行数/字节由 `src/tui/component/limited-content.tsx` 管**（2000 行 / 512KB，超出折叠并显示折叠行数）。
- 改 TUI 渲染层时，凡新增 `<markdown>` / `<diff>` / `<code>` / `<text>` 挂载点，**一律走 `LimitedContent`**，不要直送全文。
- **原生内存不受 V8 堆上限约束**：`app.tsx` 内存守护只看 rss/heapRatio/freemem，句柄吃满物理内存时 heapRatio 仍可能正常，等 freemem 掉下去往往已晚一步（V8 C++ 层先 FatalOOM abort）。
- `globalHandleBudget` 已接线到 `LimitedContent` 节点挂载/卸载生命周期（`src/tui/component/limited-content.tsx:60-79`）：挂载期 `reserve`、文本变化与卸载时 `release`，`canRenderRich` 亦复用该占用。`handleBudgetPressure` 日志维度已就位。但预算仍为估算（`estimateContentHandles` 保守），收敛仍主要靠行数/字节硬上限。
- 完整问题清单与证据：`docs/compose/plans/2026-10-02-opentui-stability-long-session.md`

## opentui 补丁链（勿改 postinstall 串联方式）

`package.json` postinstall 跑四个 patch + hooks + 校验，**必须用 `;` / `|| true` 不短路串联**：patch 在「上游升级、原文不匹配」时 `exit(1)`，短路会中断 hooks 安装并让谷总拿到未打补丁的 opentui（TUI 直接崩且无提示指向真因）。
`node scripts/verify-opentui-patches.cjs` 是收尾校验（恒 exit 0，未生效只 WARN）。当前四项均 OK（solid 惰性 jsx / solid 孤儿空文本 / core node:ffi→koffi / core win32 尺寸轮询）。补丁含义见 `docs/compose/plans/2026-10-02-opentui-stability-long-session.md` 第四节对照表。

**升级 @opentui 后必做**：patch 锚点按 chunk 内容匹配，chunk 文件名随版本变化。升级后先跑 `node scripts/verify-opentui-patches.cjs`，WARN 即表示锚点已随上游改动失配，需照新原文更新 `scripts/apply-opentui-*.cjs` 的 `*_FROM` 常量（0.5.6→0.5.14 就改了 `sigwinchHandler` 的空值兜底与 `removeListener` 变量名）。

## 排查结论沉淀位置约定

长期排查/审计类只读结论落 `docs/compose/reports/`（含 `file:line` 证据与证据级别标注）；带修复动作的落 `docs/compose/plans/`。两者均只增不删——历史结论不因后续修复而改写，只在新增文档里声明已被推翻。
