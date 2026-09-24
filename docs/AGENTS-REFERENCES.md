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
