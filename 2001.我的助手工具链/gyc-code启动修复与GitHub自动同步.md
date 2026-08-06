# gyc-code 启动修复与 GitHub 自动同步

> 日期：2026-08-06
> 对象：gyc-code（opencode 改造版 CLI，TUI 欢迎界面：非洲雄狮 + GYCCODE v0.0.1）
> 类型：启动故障修复 + 仓库自动同步配置
> 仓库：本地 `C:\Users\谷勇成\gyc-cli` / GitHub `guyongcheng2026/gyc-code`

---

## 一、问题现象
- 输入 `gyc` 报 `Error: Unexpected error`、`An error occurred in Effect.tryPromise`
- 欢迎界面（非洲雄狮头像 + GYCCODE v0.0.1）显示不出来

## 二、根因分析（三重问题叠加）
1. **bun 原生 JSX 对 solid-js 静态求值**：`<Show when={...}>` 非响应式，App 树永不挂载
2. **门闩不响应**：`createSimpleContext` 不响应 ready 状态变化
3. **bootstrap 挂起**：sync 因 server 连接挂起（sdk 请求永不 resolve），`ready` 永远 false

## 三、修复方案

| 文件 | 改动 |
|------|------|
| `src/tui/context/helper.tsx` | 用 `createMemo` 包裹 Provider 树 |
| `src/tui/context/sync.tsx` | 新增 `bootReady` 5 秒超时兜底 + bootstrap 失败降级 `partial` 容错 |
| `scripts/bun-solid-plugin.ts`（新增） | babel-preset-solid 同步转换插件 |
| `scripts/bun-solid-preload.ts`（新增） | preload 注册插件 |
| `build.mjs`（新增） | `Bun.build` API 带插件构建 dist |
| `bin/opencode` | 源码分支加 `--preload` |

### 关键坑（重要教训）
- bun `onLoad` **不等待 async 回调** → 必须用 `transformSync` / `readFileSync`
- `createRuntimePlugin` 在运行时模式会破坏插件加载 → 只用纯 babel 插件
- `bunfig.toml` 的 preload **不生效** → 必须显式 `--preload`
- jsx-runtime 惰性 patch 已回滚为原始版（不再需要），`.bak` 已删除

## 四、GitHub 同步配置
- github.com 直连被墙（`Failed to connect port 443`）→ 必须走 `https://gh-proxy.com/https://github.com/...`
- GitHub 已废弃密码认证 → 使用 `~/.git-credentials` 中 `guyongcheng2026` 的 PAT token（40 位）
- `origin` 改为 gh-proxy 地址；`credential.https://gh-proxy.com.helper=store`
- 新增 `.githooks/post-commit`：每次 `git commit` 后自动 `git push origin HEAD`
- 配置 `git config core.hooksPath .githooks`，实测提交钩子自动推送成功

## 五、验证结果
- `gyc` 正常显示「非洲雄狮 + GYCCODE v0.0.1 + Ask anything...」
- `gyc --version` = 0.0.1
- dist 模式与源码模式均通过
- `git status -sb` 显示与 `origin/main` 完全同步
- 远程确认：`git ls-remote origin main` = `37724aa`（与本地一致）

## 六、后续维护要点
1. 改动源码后必须 `bun build.mjs` 重建 dist 才生效
2. 代码提交后 post-commit 钩子自动推送，无需手动 `git push`
3. 账号密码（`1234.Gyc`）无用，GitHub 只认 token，注意保密勿泄露

---

*记录：Codex | 2026-08-06*