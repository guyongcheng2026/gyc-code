# AGENTS.md 长尾参考（低频但必读场景）

> 由 `AGENTS.md` 外移，保持主文件短小。改 build/推不动/查行数时按需读取本文件。

## 构建须知（build.mjs）

- 构建前自动再生：compose 技能 bundle（`.bundle/` → bundle.gen.ts）+ webapp 清单（→ opencode-web-ui.gen.ts）
- **splitting 默认必须关闭**（`GYCCODE_BUILD_SPLITTING=1` 才开）：开启改变模块初始化顺序，曾致 LayerNode 循环引用解析崩溃、dist 下 CLI/TUI 全链路瘫痪（dev 源码模式正常，仅 dist 复现）
- 产物布局固定 `dist/index.js` + `dist/worker.js`：bin/gyc、install.sh、多个脚本均按此定位，勿改入口命名
- 可用内存 <1.2GB 时 Bun 打包器可能 OOM panic（exit 3/9），build.mjs 父进程会自动以低内存模式重试一次；`GYCCODE_BUILD_LOW_MEM=1` 强制

## 直连 github.com 超时的 gh-proxy 两步走（fetch / push 均适用）

- 拉取：`git fetch https://gh-proxy.com/https://github.com/guyongcheng2026/gyc-code.git main:refs/remotes/origin/main` 后 `git merge --ff-only origin`（带镜像 URL 直接 pull 会报 Cannot fast-forward to multiple branches）。
- 推送：gh-proxy 只读免鉴权、**推须转发 github.com 凭据**——用 `git credential fill`（host=github.com）取凭据，经 `GIT_ASKPASS` 临时脚本提供（口令只进环境变量，不落盘不回显），加 `-c credential.helper=` 清空默认辅助器，向 `https://gh-proxy.com/https://github.com/guyongcheng2026/gyc-code.git` 执行 `push HEAD:main`（2026-09-24 实测通过；gh-proxy 单纯转发 Authorization，github.com 的 PAT 可直接用于该通道）。
- 推完按上一行 fetch 同步 `origin/main` 追踪引用，`git status` 应无 `[ahead]`。

## 行数口径

`bun scripts/linescan.mjs` 复测（代码包总量 = src 下 TS/TSX；人工维护核心 = 总量 − gen − 测试）。宣传口径用"约 18 万行人工维护核心代码"。

## 工具可见性三层机制（勿再叠加第四层）

按权威级排序，改动工具可见性时只动已有层：

1. **permission ruleset**（权威层，`agent.permission` + session 规则）——同时决定 tool schema 可见（`Permission.disabled`：整工具 `*:deny` 会从每轮请求裁掉）与运行时执行。agent 级裁剪先例：plan（`plan-tools.ts` 14 项）、explore（`agent.ts` 白名单）。
2. **user.tools**（config 层，`{tool: false}`）——仅关 schema，不影响 permission 执行面。
3. **experimental.primary_tools**（subagent 通道）——spawn 子代理时的白名单快捷方式，经 `subagent-permissions.ts` 合成 deny。

**约束**：不得新增并行的第四套可见性机制（历史评估 2026-09-24：三套已够用且职责清晰，profile 类配置若引入必须编译降级为第 1 层 ruleset）。已知风险观察项：explore 白名单含 `bash`（只读语义的执行面残留，探索类只读命令有价值，暂不裁，见真实滥用再议）。
